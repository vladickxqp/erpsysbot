/**
 * Direct shipping by the supplier (src/lib/dropship.ts for the rules).
 *
 * Confirming a customer order with such goods splits them by supplier into
 * supplier orders. Each is checked against its supplier's rules: it waits for
 * the customer's payment, then goes out on its own or waits for a person's
 * yes. Prices are taken from the offers when the supplier order is made and
 * checked again before anything is sent: nothing is bought at a price nobody
 * saw. What the supplier reports in stock is kept apart from the company's
 * own stock; what open supplier orders take of it is computed, never stored.
 *
 * Sending, the supplier's answers and the retry clock are in supplier-link.ts.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { withTenant, type Tx } from "@/db/tenant";
import { clients, orderEvents, orderItems, orders, organizations, products, productSuppliers, stores, supplierOrderItems, supplierOrders, supplierPriceHistory, suppliers } from "@/db/schema";
import { formatMoney } from "@/i18n";
import {
  AT_SUPPLIER,
  canDoSupplier,
  cleanRules,
  isAllowedUrl,
  linkState,
  OPEN,
  reasonsFor,
  RESERVING,
  SUBMIT_METHODS,
  type Reason,
  type SubmitMethod,
  type SupplierOrderAction,
  type SupplierOrderStatus,
} from "@/lib/dropship";
import { bestOffer } from "@/lib/pricing";
import { audit, type Via } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { mailAvailable } from "./mail";
import { companyLeads, notify } from "./notifications";
import { nextNumber } from "./numbers";
import { requirePermission } from "./permissions";
import { hint, seal, unseal } from "./secret-box";
import { appUrl } from "./settings";
import { deliverShipments, recordShipment } from "./shipments";

export class DropshipError extends Error {
  constructor(public readonly code: "STEP" | "SETUP") {
    super(code);
  }
}

/** Who acts: a person (with the context the audit needs) or the supplier's system / the clock. */
export type Actor = { organizationId: string; userId: string | null; ctx: Context | null; via: Via };

export const actorOf = (ctx: Context, via: Via = "web"): Actor => ({ organizationId: ctx.organization.id, userId: ctx.user.userId, ctx, via });

/** The company's name, currency and address book entry; the tenant role cannot read it, so it is read before. */
export type Company = { id: string; name: string; currency: string; email: string | null };

export async function companyOf(organizationId: string): Promise<Company> {
  const [org] = await getDb()
    .select({ id: organizations.id, name: organizations.name, legalName: organizations.legalName, currency: organizations.currency, email: organizations.email })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) throw new NotFoundError();
  return { id: org.id, name: org.legalName ?? org.name, currency: org.currency, email: org.email };
}

const newKey = () => `nx-${randomUUID()}`;
const newSecret = () => randomBytes(32).toString("base64url");

async function orderEvent(tx: Tx, actor: Actor, orderId: string, kind: string, data: Record<string, unknown>) {
  await tx.insert(orderEvents).values({ organizationId: actor.organizationId, orderId, kind, data, userId: actor.userId });
}

// --- A supplier's settings ----------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const dropshipInput = z.object({
  dropship: z.boolean(),
  submitMethod: z.enum(SUBMIT_METHODS),
  orderEmail: optionalText(200).refine((v) => v === null || z.string().email().safeParse(v).success, "email"),
  apiUrl: optionalText(500).refine((v) => v === null || isAllowedUrl(v), "url"),
  /** Left out or empty: the stored key stays. */
  apiKey: optionalText(1000),
  removeApiKey: z.boolean().default(false),
  processingDays: z.coerce.number().int().min(0).max(365).nullish().transform((v) => v ?? null),
  rules: z.object({
    autoBelowCents: z.coerce.number().int().min(0).max(100_000_000).nullish().transform((v) => v ?? null),
    minMarginPercent: z.coerce.number().min(-100).max(100).nullish().transform((v) => v ?? null),
    approveNewSupplier: z.boolean(),
    approvePriceChange: z.boolean(),
    approveUnknownStock: z.boolean(),
    requirePaid: z.boolean(),
  }),
});
export type DropshipInput = z.input<typeof dropshipInput>;

export async function saveDropshipSettings(ctx: Context, supplierId: string, raw: DropshipInput): Promise<void> {
  requirePermission(ctx.permissions, "inventory.manage");
  const input = dropshipInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).for("update");
    if (!current) throw new NotFoundError();
    const patch: Partial<typeof suppliers.$inferInsert> = {
      dropship: input.dropship,
      submitMethod: input.submitMethod,
      orderEmail: input.orderEmail,
      apiUrl: input.apiUrl,
      processingDays: input.processingDays,
      dropshipRules: input.rules,
    };
    if (input.removeApiKey) Object.assign(patch, { apiKey: null, apiKeyHint: null });
    else if (input.apiKey) Object.assign(patch, { apiKey: seal(input.apiKey), apiKeyHint: hint(input.apiKey) });
    // The secret that signs both ways exists once the supplier ships directly.
    if (input.dropship && !current.signingSecret) patch.signingSecret = seal(newSecret());
    await tx.update(suppliers).set(patch).where(eq(suppliers.id, supplierId));
    await audit(tx, ctx, "supplier.dropship", "supplier", supplierId, {
      dropship: input.dropship,
      method: input.submitMethod,
      ...(input.apiKey || input.removeApiKey ? { apiKey: input.removeApiKey ? "removed" : "changed" } : {}),
    });
  });
}

/** The secret the supplier signs its messages with; shown to the company's managers only, on request. */
export async function signingSecret(ctx: Context, supplierId: string, renew = false): Promise<string> {
  requirePermission(ctx.permissions, "inventory.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select({ secret: suppliers.signingSecret }).from(suppliers).where(eq(suppliers.id, supplierId)).for("update");
    if (!row) throw new NotFoundError();
    let secret = unseal(row.secret);
    if (renew || !secret) {
      secret = newSecret();
      await tx.update(suppliers).set({ signingSecret: seal(secret) }).where(eq(suppliers.id, supplierId));
    }
    await audit(tx, ctx, renew ? "supplier.secret_renew" : "supplier.secret_show", "supplier", supplierId);
    return secret;
  });
}

export function callbackUrl(supplierId: string): string | null {
  const base = appUrl();
  return base ? `${base}/api/suppliers/${supplierId}/events` : null;
}

export async function getDropshipSettings(ctx: Context, supplierId: string) {
  requirePermission(ctx.permissions, "orders.read");
  const [s] = await withTenant(ctx.organization.id, (tx) => tx.select().from(suppliers).where(eq(suppliers.id, supplierId)));
  if (!s) throw new NotFoundError();
  return {
    dropship: s.dropship,
    submitMethod: s.submitMethod as SubmitMethod,
    orderEmail: s.orderEmail,
    apiUrl: s.apiUrl,
    apiKeyHint: s.apiKeyHint,
    hasSecret: !!s.signingSecret,
    processingDays: s.processingDays,
    rules: cleanRules(s.dropshipRules),
    state: linkState({ ...s, submitMethod: s.submitMethod as SubmitMethod, mailReady: mailAvailable() }),
    lastSubmitAt: s.lastSubmitAt,
    lastError: s.lastError,
    callbackUrl: callbackUrl(s.id),
  };
}

// --- Which supplier ships what --------------------------------------------------------------------

type Offer = typeof productSuppliers.$inferSelect;
type SupplierRow = typeof suppliers.$inferSelect;

/** The offer a line is bought from: one for its variant before one for the whole product, the preferred one, then the cheapest. */
export function chooseOffer<T extends Pick<Offer, "productId" | "variantId" | "preferred" | "purchasePriceCents" | "shippingCostCents">>(offers: readonly T[], productId: string, variantId: string | null): T | null {
  const own = offers.filter((o) => o.productId === productId);
  const exact = variantId ? own.filter((o) => o.variantId === variantId) : [];
  const pool = exact.length ? exact : own.filter((o) => o.variantId === null);
  if (!pool.length) return null;
  const preferred = pool.filter((o) => o.preferred);
  return bestOffer(preferred.length ? preferred : pool);
}

/** Offers of suppliers that ship directly and are active. */
async function dropshipOffers(tx: Tx, productIds: string[]): Promise<{ offer: Offer; supplier: SupplierRow }[]> {
  if (!productIds.length) return [];
  return tx
    .select({ offer: productSuppliers, supplier: suppliers })
    .from(productSuppliers)
    .innerJoin(suppliers, eq(suppliers.id, productSuppliers.supplierId))
    .where(and(inArray(productSuppliers.productId, productIds), eq(suppliers.dropship, true), eq(suppliers.status, "ACTIVE")));
}

/** What supplier orders not yet with the supplier take of each offer's reported stock. */
async function reservedByOffer(tx: Tx, offerIds: string[], exceptId?: string): Promise<Map<string, number>> {
  if (!offerIds.length) return new Map();
  const rows = await tx
    .select({ offerId: supplierOrderItems.offerId, quantity: sql<string>`sum(${supplierOrderItems.quantity})` })
    .from(supplierOrderItems)
    .innerJoin(supplierOrders, eq(supplierOrders.id, supplierOrderItems.supplierOrderId))
    .where(and(inArray(supplierOrderItems.offerId, offerIds), inArray(supplierOrders.status, RESERVING), exceptId ? ne(supplierOrders.id, exceptId) : undefined))
    .groupBy(supplierOrderItems.offerId);
  return new Map(rows.map((r) => [r.offerId!, Number(r.quantity)]));
}

/**
 * What may still be sold of goods the supplier ships, per product and variant:
 * the supplier's reported stock less what open supplier orders take; null when
 * the supplier reported nothing (unknown, not "none").
 */
export async function dropshipAvailable(tx: Tx, productIds: string[]): Promise<(productId: string, variantId: string | null) => number | null> {
  const offers = await dropshipOffers(tx, productIds);
  const reserved = await reservedByOffer(tx, offers.map((o) => o.offer.id));
  const list = offers.map((o) => o.offer);
  return (productId, variantId) => {
    const offer = chooseOffer(list, productId, variantId);
    if (!offer || offer.supplierStock === null) return null;
    return Math.max(0, Number(offer.supplierStock) - (reserved.get(offer.id) ?? 0));
  };
}

type PlanLine = { item: typeof orderItems.$inferSelect; offer: Offer; sku: string | null };
export type DropshipPlan = { groups: { supplier: SupplierRow; lines: PlanLine[] }[]; missing: { description: string }[]; ownGoods: number };

/** The order's goods the supplier ships, by supplier; lines no supplier can ship; how many lines come from the company's own stock. */
export async function planDropship(tx: Tx, orderId: string): Promise<DropshipPlan> {
  const lines = await tx
    .select({ item: orderItems, fulfillment: products.fulfillment, kind: products.kind, sku: products.sku })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.position));
  const goods = lines.filter((l) => l.kind === "PRODUCT");
  const drop = goods.filter((l) => l.fulfillment === "DROPSHIP");
  const plan: DropshipPlan = { groups: [], missing: [], ownGoods: goods.length - drop.length };
  if (!drop.length) return plan;
  const offers = await dropshipOffers(tx, [...new Set(drop.map((l) => l.item.productId!))]);
  for (const line of drop) {
    const offer = chooseOffer(offers.map((o) => o.offer), line.item.productId!, line.item.variantId);
    if (!offer) {
      plan.missing.push({ description: line.item.description.split("\n")[0] });
      continue;
    }
    const supplier = offers.find((o) => o.offer.id === offer.id)!.supplier;
    const group = plan.groups.find((g) => g.supplier.id === supplier.id);
    const entry = { item: line.item, offer, sku: offer.supplierSku ?? line.sku };
    if (group) group.lines.push(entry);
    else plan.groups.push({ supplier, lines: [entry] });
  }
  return plan;
}

const lineCost = (quantity: number, unit: number, shipping: number) => Math.round(quantity * (unit + shipping));

/** One supplier order per supplier, each checked against its rules right away; returns their ids. */
export async function createSupplierOrders(tx: Tx, actor: Actor, company: Company, orderId: string, plan: DropshipPlan): Promise<string[]> {
  const ids: string[] = [];
  for (const group of plan.groups) {
    const number = await nextNumber(tx, actor.organizationId, "supplier_order");
    const costCents = group.lines.reduce((s, l) => s + lineCost(Number(l.item.quantity), l.offer.purchasePriceCents, l.offer.shippingCostCents ?? 0), 0);
    const saleCents = group.lines.reduce((s, l) => s + l.item.netCents, 0);
    const [so] = await tx
      .insert(supplierOrders)
      .values({
        organizationId: actor.organizationId,
        number,
        orderId,
        supplierId: group.supplier.id,
        status: "WAITING",
        method: group.supplier.submitMethod,
        currency: group.lines[0].offer.currency,
        costCents,
        saleCents,
        idempotencyKey: newKey(),
      })
      .returning();
    await tx.insert(supplierOrderItems).values(
      group.lines.map((l) => ({
        organizationId: actor.organizationId,
        supplierOrderId: so.id,
        orderItemId: l.item.id,
        productId: l.item.productId!,
        variantId: l.item.variantId,
        offerId: l.offer.id,
        supplierSku: l.sku,
        description: l.item.description.split("\n")[0].slice(0, 300),
        quantity: l.item.quantity,
        unitCostCents: l.offer.purchasePriceCents,
        shippingCostCents: l.offer.shippingCostCents ?? 0,
        saleCents: l.item.netCents,
      })),
    );
    await orderEvent(tx, actor, orderId, "supplier.created", { supplierOrderId: so.id, number, supplier: group.supplier.name });
    if (actor.ctx) await audit(tx, actor.ctx, "supplier_order.create", "supplier_order", so.id, { number, order: orderId, cost: costCents }, actor.via);
    await evaluate(tx, company, so.id);
    ids.push(so.id);
  }
  if (plan.missing.length) await orderEvent(tx, actor, orderId, "supplier.missing", { lines: plan.missing.map((m) => m.description) });
  return ids;
}

// --- The rules ------------------------------------------------------------------------------------

/**
 * Checks a supplier order that is not with the supplier yet against its
 * supplier's rules and the prices as they are now; returns where it stands.
 * A yes given before holds, unless a price changed since.
 */
export async function evaluate(tx: Tx, company: Company, id: string): Promise<SupplierOrderStatus> {
  const [so] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, id)).for("update");
  if (!so) throw new NotFoundError();
  const status = so.status as SupplierOrderStatus;
  if (status !== "WAITING" && status !== "APPROVAL" && status !== "READY") return status;
  const [order] = await tx.select().from(orders).where(eq(orders.id, so.orderId));
  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, so.supplierId));
  const rules = cleanRules(supplier.dropshipRules);
  const set = async (patch: Partial<typeof supplierOrders.$inferInsert>) => {
    await tx.update(supplierOrders).set({ ...patch, updatedAt: new Date() }).where(eq(supplierOrders.id, id));
    return (patch.status ?? status) as SupplierOrderStatus;
  };
  if (order.fulfillmentStatus === "CANCELLED") return set({ status: "CANCELLED", cancelledAt: new Date() });
  if (rules.requirePaid && order.paymentStatus !== "PAID") return set({ status: "WAITING", reasons: [] });

  const items = await tx.select().from(supplierOrderItems).where(eq(supplierOrderItems.supplierOrderId, id));
  const offerIds = items.map((i) => i.offerId).filter((v): v is string => !!v);
  const offers = offerIds.length ? await tx.select().from(productSuppliers).where(inArray(productSuppliers.id, offerIds)) : [];
  let moved = false;
  let flagged = false;
  for (const item of items) {
    const offer = offers.find((o) => o.id === item.offerId);
    if (!offer) continue;
    if (offer.priceChangedAt) flagged = true;
    if (offer.purchasePriceCents !== item.unitCostCents || (offer.shippingCostCents ?? 0) !== item.shippingCostCents) {
      // The supplier order follows the offer, so what is sent is what is shown, and asks again when it changed.
      moved = true;
      item.unitCostCents = offer.purchasePriceCents;
      item.shippingCostCents = offer.shippingCostCents ?? 0;
      await tx.update(supplierOrderItems).set({ unitCostCents: item.unitCostCents, shippingCostCents: item.shippingCostCents }).where(eq(supplierOrderItems.id, item.id));
    }
  }
  const costCents = items.reduce((s, i) => s + lineCost(Number(i.quantity), i.unitCostCents, i.shippingCostCents), 0);
  const saleCents = items.reduce((s, i) => s + i.saleCents, 0);

  if (so.approvedAt && !(moved && rules.approvePriceChange)) return set({ status: "READY", reasons: [], costCents, saleCents });

  const reserved = await reservedByOffer(tx, offerIds, id);
  const [{ done }] = await tx
    .select({ done: sql<number>`count(*)::int` })
    .from(supplierOrders)
    .where(and(eq(supplierOrders.supplierId, so.supplierId), inArray(supplierOrders.status, ["CONFIRMED", "SHIPPED", "DELIVERED"])));
  const reasons: Reason[] = reasonsFor({
    rules,
    costCents,
    marginPercent: so.currency === company.currency && saleCents > 0 ? Math.round(((saleCents - costCents) / saleCents) * 1000) / 10 : null,
    doneOrders: Number(done),
    priceChanged: moved || flagged,
    stock: items.map((i) => {
      const offer = offers.find((o) => o.id === i.offerId);
      return { reported: offer?.supplierStock == null ? null : Number(offer.supplierStock) - (reserved.get(offer.id) ?? 0), needed: Number(i.quantity) };
    }),
    addressComplete: !!(order.shipName && order.shipStreet && order.shipPostalCode && order.shipCity && order.shipCountry),
  });
  return set({ status: reasons.length ? "APPROVAL" : "READY", reasons, costCents, saleCents, approvedAt: null, approvedBy: null });
}

// --- What happens after a change ----------------------------------------------------------------

type Followed = { id: string; number: number; status: SupplierOrderStatus; method: SubmitMethod; reasons: string[]; supplier: string; orderNumber: number; orderId: string; lastError: string | null };

async function followed(organizationId: string, where: { orderId?: string; ids?: string[] }): Promise<Followed[]> {
  return withTenant(organizationId, async (tx) => {
    const rows = await tx
      .select({ so: supplierOrders, supplier: suppliers.name, orderNumber: orders.number })
      .from(supplierOrders)
      .innerJoin(suppliers, eq(suppliers.id, supplierOrders.supplierId))
      .innerJoin(orders, eq(orders.id, supplierOrders.orderId))
      .where(where.orderId ? eq(supplierOrders.orderId, where.orderId) : inArray(supplierOrders.id, where.ids?.length ? where.ids : ["00000000-0000-0000-0000-000000000000"]));
    return rows.map((r) => ({
      id: r.so.id,
      number: r.so.number,
      status: r.so.status as SupplierOrderStatus,
      method: r.so.method as SubmitMethod,
      reasons: r.so.reasons,
      supplier: r.supplier,
      orderNumber: r.orderNumber,
      orderId: r.so.orderId,
      lastError: r.so.lastError,
    }));
  });
}

async function tell(organizationId: string, so: Followed, kind: string, category: "approval" | "assigned" | "failure") {
  await notify(organizationId, await companyLeads(organizationId), {
    category,
    kind,
    vars: { number: so.number, order: so.orderNumber, supplier: so.supplier },
    href: `/app/orders/${so.orderId}`,
    entity: "supplier_order",
    entityId: so.id,
    priority: category === "failure" ? 2 : 1,
    // One note per state the supplier order reaches, however often this runs.
    dedupeKey: `supplier-order:${so.id}:${so.status}:${so.reasons.join(",")}`,
  }).catch((e) => console.error("dropship: notify failed", e instanceof Error ? e.message : e));
}

/** Tells people what waits for them and sends what may go out; run after the transaction that changed things. */
export async function followUp(organizationId: string, where: { orderId?: string; ids?: string[] }): Promise<void> {
  for (const so of await followed(organizationId, where)) {
    if (so.status === "APPROVAL") await tell(organizationId, so, "supplierApproval", "approval");
    else if (so.status === "READY" && so.method === "MANUAL") await tell(organizationId, so, "supplierReady", "assigned");
    else if (so.status === "READY") await (await import("./supplier-link")).submitSupplierOrder(organizationId, so.id);
    else if (so.status === "FAILED") await tell(organizationId, so, "supplierFailed", "failure");
    else if (so.status === "REJECTED") await tell(organizationId, so, "supplierRejected", "failure");
    else if (so.status === "OUT_OF_STOCK") await tell(organizationId, so, "supplierOutOfStock", "failure");
  }
}

/** The customer paid: what waited for it is checked again. */
export async function afterPayment(organizationId: string, orderId: string): Promise<void> {
  const company = await companyOf(organizationId);
  const ids = await withTenant(organizationId, async (tx) => {
    const waiting = await tx.select({ id: supplierOrders.id }).from(supplierOrders).where(and(eq(supplierOrders.orderId, orderId), eq(supplierOrders.status, "WAITING")));
    for (const w of waiting) await evaluate(tx, company, w.id);
    return waiting.map((w) => w.id);
  });
  if (ids.length) await followUp(organizationId, { ids });
}

// --- Supplier orders and the customer order -------------------------------------------------------

/** Lines of the order that come from the company's own stock: those the warehouse ships. */
export async function ownGoodsCount(tx: Tx, orderId: string): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.orderId, orderId), eq(products.kind, "PRODUCT"), eq(products.fulfillment, "STOCK")));
  return Number(n);
}

/** Supplier orders of a customer order that are not finished yet. */
export async function openSupplierOrders(tx: Tx, orderId: string): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(supplierOrders)
    .where(and(eq(supplierOrders.orderId, orderId), inArray(supplierOrders.status, OPEN)));
  return Number(n);
}

/**
 * The customer order is cancelled: supplier orders not with the supplier yet
 * go with it. False when one is with the supplier: that needs the supplier's
 * cancellation first, and nothing is changed.
 */
export async function cancelSupplierOrdersOf(tx: Tx, actor: Actor, orderId: string): Promise<boolean> {
  const list = await tx.select().from(supplierOrders).where(and(eq(supplierOrders.orderId, orderId), ne(supplierOrders.status, "CANCELLED")));
  if (list.some((s) => AT_SUPPLIER.includes(s.status as SupplierOrderStatus))) return false;
  const now = new Date();
  for (const so of list) {
    await tx.update(supplierOrders).set({ status: "CANCELLED", cancelledAt: now, nextAttemptAt: null, updatedAt: now }).where(eq(supplierOrders.id, so.id));
    await orderEvent(tx, actor, orderId, "supplier.cancel", { supplierOrderId: so.id, number: so.number });
  }
  return true;
}

/**
 * An order whose goods all come from suppliers follows them: shipped when the
 * last of them shipped, delivered when the last arrived. Orders with goods from
 * the company's own stock are shipped by the warehouse, as before.
 */
async function syncCustomerOrder(tx: Tx, actor: Actor, orderId: string): Promise<"shipped" | "delivered" | null> {
  const list = await tx.select().from(supplierOrders).where(and(eq(supplierOrders.orderId, orderId), ne(supplierOrders.status, "CANCELLED")));
  if (!list.length || (await ownGoodsCount(tx, orderId)) > 0) return null;
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  const now = new Date();
  if (order.fulfillmentStatus === "AT_SUPPLIER" && list.every((s) => s.status === "SHIPPED" || s.status === "DELIVERED")) {
    const first = list.find((s) => s.trackingNumber || s.carrier);
    await tx
      .update(orders)
      .set({
        fulfillmentStatus: "SHIPPED",
        status: "IN_PROGRESS",
        shippedAt: now,
        carrier: order.carrier ?? first?.carrier ?? null,
        trackingNumber: order.trackingNumber ?? first?.trackingNumber ?? null,
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));
    await orderEvent(tx, actor, orderId, "shipBySupplier", { carrier: first?.carrier ?? null, trackingNumber: first?.trackingNumber ?? null });
    if (actor.ctx) await audit(tx, actor.ctx, "order.ship", "order", orderId, { bySupplier: true }, actor.via);
    return "shipped";
  }
  if (order.fulfillmentStatus === "SHIPPED" && list.every((s) => s.status === "DELIVERED")) {
    await tx.update(orders).set({ fulfillmentStatus: "DELIVERED", status: "COMPLETED", deliveredAt: now, updatedAt: now }).where(eq(orders.id, orderId));
    await orderEvent(tx, actor, orderId, "deliverBySupplier", {});
    if (actor.ctx) await audit(tx, actor.ctx, "order.deliver", "order", orderId, { bySupplier: true }, actor.via);
    return "delivered";
  }
  return null;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const supplierActionInput = z.object({
  externalRef: text(120),
  carrier: text(80),
  trackingNumber: text(120),
  note: text(1000),
});
export type SupplierActionInput = z.input<typeof supplierActionInput>;

export type ActionResult = { id: string; orderId: string; status: SupplierOrderStatus; order: "shipped" | "delivered" | null };

/** One step of a supplier order, by a person or the supplier's system, inside the caller's transaction. */
export async function applySupplierAction(
  tx: Tx,
  actor: Actor,
  company: Company,
  id: string,
  action: SupplierOrderAction,
  raw: SupplierActionInput = {},
): Promise<ActionResult> {
  const input = supplierActionInput.parse(raw);
  const [so] = await tx.select().from(supplierOrders).where(eq(supplierOrders.id, id)).for("update");
  if (!so) throw new NotFoundError();
  const from = so.status as SupplierOrderStatus;
  if (!canDoSupplier(action, from, so.method as SubmitMethod)) throw new DropshipError("STEP");
  const now = new Date();
  const patch: Partial<typeof supplierOrders.$inferInsert> = { updatedAt: now };
  const data: Record<string, unknown> = { supplierOrderId: id, number: so.number };
  if (action === "approve") {
    Object.assign(patch, { status: "READY", approvedAt: now, approvedBy: actor.userId, reasons: [] });
    // Saying yes to the order is saying yes to the prices in it.
    const offerIds = (await tx.select({ offerId: supplierOrderItems.offerId }).from(supplierOrderItems).where(eq(supplierOrderItems.supplierOrderId, id))).map((r) => r.offerId).filter((v): v is string => !!v);
    if (offerIds.length) await tx.update(productSuppliers).set({ priceChangedAt: null }).where(inArray(productSuppliers.id, offerIds));
    data.reasons = so.reasons;
  }
  if (action === "send") Object.assign(patch, { status: "READY", attempts: 0, nextAttemptAt: null, lastError: null });
  if (action === "markSubmitted") Object.assign(patch, { status: "SUBMITTED", submittedAt: now, nextAttemptAt: null, lastError: null, externalRef: input.externalRef ?? so.externalRef });
  if (action === "confirm") Object.assign(patch, { status: "CONFIRMED", confirmedAt: now, externalRef: input.externalRef ?? so.externalRef });
  if (action === "reject" || action === "outOfStock") patch.status = action === "reject" ? "REJECTED" : "OUT_OF_STOCK";
  if (action === "ship") Object.assign(patch, { status: "SHIPPED", shippedAt: now, carrier: input.carrier ?? so.carrier, trackingNumber: input.trackingNumber ?? so.trackingNumber });
  if (action === "deliver") Object.assign(patch, { status: "DELIVERED", deliveredAt: now });
  if (action === "retry") {
    Object.assign(patch, { status: "APPROVAL", approvedAt: null, approvedBy: null, attempts: 0, nextAttemptAt: null, lastError: null });
    // After the supplier said no, asking again is a new order there: a new key, so it is not taken for the old one.
    if (from === "REJECTED" || from === "OUT_OF_STOCK") Object.assign(patch, { idempotencyKey: newKey(), externalRef: null, submittedAt: null, confirmedAt: null });
  }
  if (action === "cancel") Object.assign(patch, { status: "CANCELLED", cancelledAt: now, nextAttemptAt: null });
  for (const key of ["externalRef", "carrier", "trackingNumber", "note"] as const) if (input[key]) data[key] = input[key];
  await tx.update(supplierOrders).set(patch).where(eq(supplierOrders.id, id));
  // The supplier's parcel is a shipment of the customer's order.
  if (action === "ship") await recordShipment(tx, { organizationId: so.organizationId, orderId: so.orderId, supplierOrderId: id, carrier: patch.carrier ?? null, trackingNumber: patch.trackingNumber ?? null, userId: actor.userId, source: "supplier", at: now });
  if (action === "deliver") await deliverShipments(tx, { organizationId: so.organizationId, supplierOrderId: id }, actor.userId, "supplier", now);
  await orderEvent(tx, actor, so.orderId, `supplier.${action}`, data);
  if (actor.ctx) await audit(tx, actor.ctx, `supplier_order.${action}`, "supplier_order", id, { from, number: so.number }, actor.via);
  const status = action === "retry" ? await evaluate(tx, company, id) : ((patch.status ?? from) as SupplierOrderStatus);
  return { id, orderId: so.orderId, status, order: await syncCustomerOrder(tx, actor, so.orderId) };
}

/** After a step: people told, what may go out sent, the buyer told about the shipment, automations for a finished order. */
export async function afterAction(organizationId: string, result: ActionResult): Promise<void> {
  await followUp(organizationId, { ids: [result.id] });
  if (result.order === "shipped") await mailBuyerShipped(organizationId, result.orderId).catch((e) => console.error("dropship: buyer mail failed", e instanceof Error ? e.message : e));
  if (result.order === "delivered") {
    const { companyContext, fireAutomations } = await import("./automations");
    const ctx = await companyContext(organizationId);
    if (ctx) await fireAutomations(ctx, "order.completed", result.orderId).catch((e) => console.error("dropship: automations failed", e instanceof Error ? e.message : e));
  }
}

export async function runSupplierAction(ctx: Context, id: string, action: SupplierOrderAction, raw: SupplierActionInput = {}): Promise<ActionResult> {
  requirePermission(ctx.permissions, "inventory.manage");
  const company = await companyOf(ctx.organization.id);
  const result = await withTenant(ctx.organization.id, (tx) => applySupplierAction(tx, actorOf(ctx), company, id, action, raw));
  await afterAction(ctx.organization.id, result);
  return result;
}

/** A shop order that left the supplier: the buyer gets the tracking, in the store's language. */
async function mailBuyerShipped(organizationId: string, orderId: string): Promise<void> {
  const row = await withTenant(organizationId, async (tx) => {
    const [o] = await tx
      .select({ order: orders, email: clients.email, slug: stores.slug })
      .from(orders)
      .innerJoin(clients, eq(clients.id, orders.clientId))
      .leftJoin(stores, eq(stores.id, orders.storeId))
      .where(eq(orders.id, orderId));
    return o;
  });
  if (!row?.slug || !row.email || row.order.channel !== "SHOP") return;
  const { findStore, mailBuyer } = await import("./storefront");
  const store = await findStore(row.slug);
  if (store) await mailBuyer(store, row.email, "shipped", { number: row.order.number, grossCents: row.order.grossCents, carrier: row.order.carrier, trackingNumber: row.order.trackingNumber });
}

// --- Prices ----------------------------------------------------------------------------------------

export type PriceChange = { offerId: string; productId: string; product: string; supplier: string; fromCents: number; toCents: number; currency: string; marginPercent: number | null };

/**
 * The supplier's price for an offer changed: kept in the history, marked until
 * someone confirms it, and returned so people can be told with the margin it
 * leaves. Customer prices and orders already made stay as they are.
 */
export async function recordSupplierPrice(tx: Tx, offerId: string, priceCents: number): Promise<PriceChange | null> {
  const [row] = await tx
    .select({ offer: productSuppliers, product: products, supplier: suppliers.name })
    .from(productSuppliers)
    .innerJoin(products, eq(products.id, productSuppliers.productId))
    .innerJoin(suppliers, eq(suppliers.id, productSuppliers.supplierId))
    .where(eq(productSuppliers.id, offerId))
    .for("update", { of: productSuppliers });
  if (!row || row.offer.purchasePriceCents === priceCents) return null;
  const now = new Date();
  await tx
    .update(productSuppliers)
    .set({ purchasePriceCents: priceCents, previousPriceCents: row.offer.purchasePriceCents, priceChangedAt: now, updatedAt: now })
    .where(eq(productSuppliers.id, offerId));
  await tx.insert(supplierPriceHistory).values({ organizationId: row.offer.organizationId, productSupplierId: offerId, purchasePriceCents: priceCents, currency: row.offer.currency });
  const sale = row.product.priceCents;
  const cost = priceCents + (row.offer.shippingCostCents ?? 0);
  return {
    offerId,
    productId: row.product.id,
    product: row.product.name,
    supplier: row.supplier,
    fromCents: row.offer.purchasePriceCents,
    toCents: priceCents,
    currency: row.offer.currency,
    marginPercent: sale > 0 ? Math.round(((sale - cost) / sale) * 1000) / 10 : null,
  };
}

export async function tellPriceChange(organizationId: string, change: PriceChange): Promise<void> {
  const money = (c: number) => formatMoney(c, "de", { country: "DE", currency: change.currency });
  await notify(organizationId, await companyLeads(organizationId), {
    category: "approval",
    kind: "supplierPrice",
    vars: { supplier: change.supplier, product: change.product, from: money(change.fromCents), to: money(change.toCents), margin: change.marginPercent === null ? "–" : `${change.marginPercent} %` },
    href: `/app/products/${change.productId}`,
    entity: "product",
    entityId: change.productId,
    priority: 1,
    dedupeKey: `supplier-price:${change.offerId}:${change.toCents}`,
  }).catch((e) => console.error("dropship: notify failed", e instanceof Error ? e.message : e));
}

/** Someone looked at the new price: orders may go out at it again without asking. */
export async function acknowledgePrice(ctx: Context, offerId: string): Promise<void> {
  requirePermission(ctx.permissions, "inventory.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.update(productSuppliers).set({ priceChangedAt: null }).where(eq(productSuppliers.id, offerId)).returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "offer.price_ok", "product", row.productId, { offer: offerId, price: row.purchasePriceCents });
  });
}

/** What a supplier reports in stock, by hand; null: no report. */
export async function setSupplierStock(ctx: Context, offerId: string, quantity: number | null): Promise<void> {
  requirePermission(ctx.permissions, "inventory.manage");
  const value = z.number().min(0).max(1_000_000_000).nullable().parse(quantity);
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(productSuppliers)
      .set({ supplierStock: value === null ? null : String(value), stockReportedAt: value === null ? null : new Date() })
      .where(eq(productSuppliers.id, offerId))
      .returning();
    if (!row) throw new NotFoundError();
  });
}

// --- Lists -----------------------------------------------------------------------------------------

export type SupplierOrderView = {
  id: string;
  number: number;
  status: SupplierOrderStatus;
  method: SubmitMethod;
  reasons: string[];
  supplierId: string;
  supplier: string;
  orderId: string;
  orderNumber: number;
  client: string;
  costCents: number;
  saleCents: number;
  currency: string;
  externalRef: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  items: { id: string; description: string; supplierSku: string | null; quantity: number; unitCostCents: number; shippingCostCents: number }[];
};

async function views(tx: Tx, where: ReturnType<typeof and>, limit = 200): Promise<SupplierOrderView[]> {
  const rows = await tx
    .select({ so: supplierOrders, supplier: suppliers.name, orderNumber: orders.number, company: clients.companyName, first: clients.firstName, last: clients.lastName })
    .from(supplierOrders)
    .innerJoin(suppliers, eq(suppliers.id, supplierOrders.supplierId))
    .innerJoin(orders, eq(orders.id, supplierOrders.orderId))
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(where)
    .orderBy(desc(supplierOrders.createdAt))
    .limit(limit);
  const items = rows.length ? await tx.select().from(supplierOrderItems).where(inArray(supplierOrderItems.supplierOrderId, rows.map((r) => r.so.id))) : [];
  return rows.map(({ so, ...r }) => ({
    id: so.id,
    number: so.number,
    status: so.status as SupplierOrderStatus,
    method: so.method as SubmitMethod,
    reasons: so.reasons,
    supplierId: so.supplierId,
    supplier: r.supplier,
    orderId: so.orderId,
    orderNumber: r.orderNumber,
    client: r.company || [r.first, r.last].filter(Boolean).join(" "),
    costCents: so.costCents,
    saleCents: so.saleCents,
    currency: so.currency,
    externalRef: so.externalRef,
    carrier: so.carrier,
    trackingNumber: so.trackingNumber,
    attempts: so.attempts,
    nextAttemptAt: so.nextAttemptAt?.toISOString() ?? null,
    lastError: so.lastError,
    createdAt: so.createdAt.toISOString(),
    items: items
      .filter((i) => i.supplierOrderId === so.id)
      .map((i) => ({ id: i.id, description: i.description, supplierSku: i.supplierSku, quantity: Number(i.quantity), unitCostCents: i.unitCostCents, shippingCostCents: i.shippingCostCents })),
  }));
}

export async function supplierOrdersOf(ctx: Context, orderId: string): Promise<SupplierOrderView[]> {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, (tx) => views(tx, and(eq(supplierOrders.orderId, orderId))));
}

/** What needs a person: a yes, an order by hand, a failure, the supplier's no. */
export const ATTENTION: SupplierOrderStatus[] = ["APPROVAL", "FAILED", "REJECTED", "OUT_OF_STOCK"];
export const SUPPLIER_FILTERS = ["attention", "open", "all"] as const;
export type SupplierFilter = (typeof SUPPLIER_FILTERS)[number];

const attention = () => sql`(${supplierOrders.status} in ('APPROVAL', 'FAILED', 'REJECTED', 'OUT_OF_STOCK') or (${supplierOrders.status} = 'READY' and ${supplierOrders.method} = 'MANUAL'))`;

export async function listSupplierOrders(ctx: Context, filter: SupplierFilter = "attention"): Promise<SupplierOrderView[]> {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, (tx) =>
    views(tx, filter === "attention" ? and(attention()) : filter === "open" ? and(inArray(supplierOrders.status, OPEN)) : and(sql`true`)),
  );
}

export async function supplierOrderCounts(ctx: Context): Promise<{ attention: number; open: number }> {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .select({
        attention: sql<number>`count(*) filter (where ${attention()})::int`,
        open: sql<number>`count(*) filter (where ${inArray(supplierOrders.status, OPEN)})::int`,
      })
      .from(supplierOrders);
    return { attention: Number(row?.attention ?? 0), open: Number(row?.open ?? 0) };
  });
}

/**
 * A product the supplier ships, per offer: what the supplier reported (and
 * when), what open supplier orders take of it, how many customer orders wait
 * for it. Never mixed with the company's own stock.
 */
export async function dropshipOverview(ctx: Context, productId: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const offers = await tx
      .select({ offer: productSuppliers, supplier: suppliers.name, dropship: suppliers.dropship })
      .from(productSuppliers)
      .innerJoin(suppliers, eq(suppliers.id, productSuppliers.supplierId))
      .where(eq(productSuppliers.productId, productId));
    const reserved = await reservedByOffer(tx, offers.map((o) => o.offer.id));
    const waiting = await tx
      .select({ offerId: supplierOrderItems.offerId, n: sql<number>`count(distinct ${supplierOrders.orderId})::int` })
      .from(supplierOrderItems)
      .innerJoin(supplierOrders, eq(supplierOrders.id, supplierOrderItems.supplierOrderId))
      .where(and(eq(supplierOrderItems.productId, productId), inArray(supplierOrders.status, OPEN)))
      .groupBy(supplierOrderItems.offerId);
    return offers.map((o) => {
      const reported = o.offer.supplierStock === null ? null : Number(o.offer.supplierStock);
      const held = reserved.get(o.offer.id) ?? 0;
      return {
        offerId: o.offer.id,
        supplier: o.supplier,
        dropship: o.dropship,
        reported,
        reportedAt: o.offer.stockReportedAt?.toISOString() ?? null,
        reserved: held,
        openOrders: Number(waiting.find((w) => w.offerId === o.offer.id)?.n ?? 0),
        available: reported === null ? null : Math.max(0, reported - held),
      };
    });
  });
}
