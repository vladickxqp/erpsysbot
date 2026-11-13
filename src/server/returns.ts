/**
 * Returns: a buyer asks for one on their order page in the store, or the
 * company enters it. What may go back follows the products' rules (and
 * never less than the legal 14 days); the company then reviews, receives,
 * inspects (putting goods back on the shelf where it says so) and refunds
 * (src/server/refunds.ts). Goods that came straight from a supplier get a
 * supplier return of their own: the supplier's yes and its money are
 * tracked apart from the customer's.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { clients, orderEvents, orderItems, orders, organizations, products, refunds, returnEvents, returnItems, returns, stores, supplierOrderItems, supplierOrders, supplierReturns, suppliers } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { isLocale, MESSAGES, translator } from "@/i18n";
import {
  canMove,
  canMoveSupplier,
  CONDITIONS,
  lineGrossCents,
  MANUAL_STEPS,
  RESOLUTIONS,
  RETURN_REASONS,
  returnableUntil,
  SUPPLIER_PAID,
  SUPPLIER_RETURN_STATUSES,
  type ReturnStatus,
  type SupplierReturnStatus,
} from "@/lib/returns";
import { audit } from "./audit";
import { companyContext } from "./automations";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { bookMovement } from "./inventory";
import { mailAvailable, sendMail, takeMailBudget } from "./mail";
import { companyLeads, notify } from "./notifications";
import { nextNumber } from "./numbers";
import { requirePermission } from "./permissions";

export class ReturnError extends Error {
  constructor(public readonly code: "STEP" | "QUANTITY" | "WINDOW" | "NOT_SHIPPED" | "BUSY" | "NO_SUPPLIER" | "AMOUNT") {
    super(code);
  }
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const returnInput = z.object({
  lines: z
    .array(z.object({ orderItemId: z.string().uuid(), quantity: z.coerce.number().positive().max(100_000) }))
    .min(1)
    .max(50),
  reason: z.enum(RETURN_REASONS),
  resolution: z.enum(RESOLUTIONS).default("REFUND"),
  description: text(4000),
});
export type ReturnInput = z.input<typeof returnInput>;

export type ReturnableLine = {
  orderItemId: string;
  description: string;
  productId: string | null;
  variantId: string | null;
  quantity: number;
  /** What may still go back: bought minus what other returns took, unless they were rejected. */
  left: number;
  until: string | null;
  /** Within the product's rules and time; the company itself may take back more. */
  allowed: boolean;
  unitGrossCents: number;
};

/** The lines of an order as far as they may still be returned. */
async function returnableIn(tx: Tx, orderId: string, smallBusiness: boolean, now: Date): Promise<{ order: typeof orders.$inferSelect; lines: ReturnableLine[] }> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new NotFoundError();
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.position));
  const productIds = [...new Set(items.map((i) => i.productId).filter((v): v is string => !!v))];
  const rules = productIds.length
    ? new Map(
        (await tx.select({ id: products.id, returnable: products.returnable, returnDays: products.returnDays, kind: products.kind }).from(products).where(inArray(products.id, productIds))).map((p) => [p.id, p]),
      )
    : new Map();
  const taken = new Map<string, number>();
  const already = await tx
    .select({ orderItemId: returnItems.orderItemId, quantity: returnItems.quantity })
    .from(returnItems)
    .innerJoin(returns, eq(returns.id, returnItems.returnId))
    .where(and(eq(returns.orderId, orderId), ne(returns.status, "REJECTED")));
  for (const a of already) if (a.orderItemId) taken.set(a.orderItemId, (taken.get(a.orderItemId) ?? 0) + Number(a.quantity));
  const lines = items.map((i): ReturnableLine => {
    const product = i.productId ? rules.get(i.productId) : undefined;
    const quantity = Number(i.quantity);
    const left = Math.max(0, quantity - (taken.get(i.id) ?? 0));
    // Services are not sent back.
    const until = product && product.kind === "SERVICE" ? null : returnableUntil(product ?? null, order);
    return {
      orderItemId: i.id,
      description: i.description,
      productId: i.productId,
      variantId: i.variantId,
      quantity,
      left,
      until: until?.toISOString() ?? null,
      allowed: left > 0 && !!until && until >= now,
      unitGrossCents: lineGrossCents({ netCents: i.netCents, quantity, vatRate: i.vatRate }, 1, smallBusiness),
    };
  });
  return { order, lines };
}

export async function returnableLines(ctx: Context, orderId: string, now = new Date()): Promise<ReturnableLine[]> {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => (await returnableIn(tx, orderId, ctx.organization.smallBusiness, now)).lines);
}

async function event(tx: Tx, organizationId: string, returnId: string, kind: string, userId: string | null, data: Record<string, unknown> = {}) {
  await tx.insert(returnEvents).values({ organizationId, returnId, kind, data, userId });
}

type Actor = { organizationId: string; userId: string | null; ctx: Context };

/** A return in the caller's transaction: lines checked against what may go back; the buyer is held to the rules, the company is not. */
async function createIn(tx: Tx, actor: Actor, orderId: string, input: z.output<typeof returnInput>, channel: "shop" | "manual", now: Date, photoIds: string[] = []) {
  const { order, lines } = await returnableIn(tx, orderId, actor.ctx.organization.smallBusiness, now);
  if (!order.shippedAt) throw new ReturnError("NOT_SHIPPED");
  const wanted = new Map<string, number>();
  for (const l of input.lines) wanted.set(l.orderItemId, (wanted.get(l.orderItemId) ?? 0) + l.quantity);
  let refundCents = 0;
  const chosen: { line: ReturnableLine; quantity: number }[] = [];
  for (const [orderItemId, quantity] of wanted) {
    const line = lines.find((l) => l.orderItemId === orderItemId);
    if (!line || quantity > line.left + 1e-9) throw new ReturnError("QUANTITY");
    if (channel === "shop" && !line.allowed) throw new ReturnError("WINDOW");
    chosen.push({ line, quantity });
    refundCents += line.unitGrossCents * quantity;
  }
  const number = await nextNumber(tx, actor.organizationId, "return");
  const status: ReturnStatus = channel === "manual" ? "APPROVED" : "REQUESTED";
  const [row] = await tx
    .insert(returns)
    .values({
      organizationId: actor.organizationId,
      number,
      orderId,
      clientId: order.clientId,
      status,
      reason: input.reason,
      resolution: input.resolution,
      description: input.description,
      photoIds,
      channel,
      refundCents: Math.round(refundCents),
      createdBy: actor.userId,
      decidedAt: status === "APPROVED" ? now : null,
    })
    .returning();
  await tx.insert(returnItems).values(
    chosen.map(({ line, quantity }) => ({
      organizationId: actor.organizationId,
      returnId: row.id,
      orderItemId: line.orderItemId,
      productId: line.productId,
      variantId: line.variantId,
      description: line.description,
      quantity: String(quantity),
    })),
  );
  await event(tx, actor.organizationId, row.id, channel === "shop" ? "requested" : "created", actor.userId, { lines: chosen.length });
  await tx.insert(orderEvents).values({ organizationId: actor.organizationId, orderId, kind: "returned", data: { number, channel }, userId: actor.userId });
  await audit(tx, actor.ctx, "return.create", "return", row.id, { number, order: order.number, channel }, channel === "shop" ? "shop" : "web");
  return row;
}

/** The company enters a return (e.g. a call or a parcel at the door); it starts approved. */
export async function createReturn(ctx: Context, orderId: string, raw: ReturnInput): Promise<{ id: string; number: number }> {
  requirePermission(ctx.permissions, "orders.update");
  const input = returnInput.parse(raw);
  const row = await withTenant(ctx.organization.id, (tx) => createIn(tx, { organizationId: ctx.organization.id, userId: ctx.user.userId, ctx }, orderId, input, "manual", new Date()));
  return { id: row.id, number: row.number };
}

/** Requests per order and hour, held in memory. */
const recent = new Map<string, number[]>();
function takeSlot(key: string, perHour = 5): boolean {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= perHour) return false;
  list.push(now);
  recent.set(key, list);
  if (recent.size > 5000) for (const k of [...recent.keys()].slice(0, 1000)) recent.delete(k);
  return true;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type BuyerPhoto = { name: string; bytes: Uint8Array };

/**
 * The buyer asks for a return on their order page (the token is their key):
 * within the rules, with photos where they help. The company hears of it.
 */
export async function requestReturn(store: { id: string; organizationId: string; preview: boolean }, token: string, raw: ReturnInput, photos: BuyerPhoto[] = [], now = new Date()): Promise<{ number: number }> {
  if (store.preview) throw new ReturnError("BUSY");
  const input = returnInput.parse(raw);
  if (!takeSlot(`${store.id}:${tokenHash(token)}`)) throw new ReturnError("BUSY");
  const ctx = await companyContext(store.organizationId);
  if (!ctx) throw new ReturnError("BUSY");
  const [order] = await withTenant(store.organizationId, (tx) =>
    tx
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(and(eq(orders.customerTokenHash, tokenHash(token)), eq(orders.storeId, store.id))),
  );
  if (!order) throw new NotFoundError();
  // Photos become the company's documents; without the documents module the request goes without them.
  const photoIds: string[] = [];
  if (photos.length && ctx.permissions.has("documents.manage")) {
    const { storeDocument } = await import("./documents");
    for (const photo of photos.slice(0, 3)) {
      const doc = await storeDocument(ctx, photo, { category: "Retoure", clientId: undefined }).catch(() => null);
      if (doc && doc.mimeType.startsWith("image/")) photoIds.push(doc.id);
    }
  }
  const row = await withTenant(store.organizationId, (tx) => createIn(tx, { organizationId: store.organizationId, userId: null, ctx }, order.id, input, "shop", now, photoIds));
  await notify(store.organizationId, await companyLeads(store.organizationId), {
    category: "update",
    kind: "returnRequested",
    vars: { number: row.number, order: order.number },
    href: `/app/returns/${row.id}`,
    entity: "return",
    entityId: row.id,
    dedupeKey: `return-requested:${row.id}`,
  }).catch((e) => console.error("returns: notify failed", e instanceof Error ? e.message : e));
  await mailBuyer(store.organizationId, row.id, "requested").catch((e) => console.error("returns: mail failed", e instanceof Error ? e.message : e));
  return { number: row.number };
}

// --- Reading ------------------------------------------------------------------------------------------

export type ReturnRow = {
  id: string;
  number: number;
  status: ReturnStatus;
  orderId: string;
  orderNumber: number;
  client: string;
  reason: string;
  channel: string;
  refundCents: number;
  createdAt: string;
};

export type ReturnFilter = "open" | "refund" | "closed" | "all";

export async function listReturns(ctx: Context, filter: ReturnFilter = "open"): Promise<ReturnRow[]> {
  requirePermission(ctx.permissions, "orders.read");
  const where =
    filter === "open"
      ? inArray(returns.status, ["REQUESTED", "UNDER_REVIEW", "APPROVED", "LABEL_PENDING", "SHIPPED", "RECEIVED", "INSPECTION", "REFUND_PENDING"])
      : filter === "refund"
        ? inArray(returns.status, ["RECEIVED", "INSPECTION", "REFUND_PENDING"])
        : filter === "closed"
          ? inArray(returns.status, ["REJECTED", "REFUNDED", "CLOSED"])
          : undefined;
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ r: returns, orderNumber: orders.number, client: clients })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .leftJoin(clients, eq(clients.id, returns.clientId))
      .where(where)
      .orderBy(desc(returns.createdAt))
      .limit(300),
  );
  return rows.map(({ r, orderNumber, client }) => ({
    id: r.id,
    number: r.number,
    status: r.status as ReturnStatus,
    orderId: r.orderId,
    orderNumber,
    client: client ? displayName(client) : "—",
    reason: r.reason,
    channel: r.channel,
    refundCents: r.refundCents,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The returns of one order, for its page. */
export async function returnsOfOrder(ctx: Context, orderId: string): Promise<{ id: string; number: number; status: ReturnStatus }[]> {
  requirePermission(ctx.permissions, "orders.read");
  const rows = await withTenant(ctx.organization.id, (tx) => tx.select({ id: returns.id, number: returns.number, status: returns.status }).from(returns).where(eq(returns.orderId, orderId)).orderBy(asc(returns.createdAt)));
  return rows.map((r) => ({ ...r, status: r.status as ReturnStatus }));
}

export async function returnCounts(ctx: Context): Promise<{ open: number; refund: number }> {
  requirePermission(ctx.permissions, "orders.read");
  const rows = await withTenant(ctx.organization.id, (tx) => tx.select({ status: returns.status, n: sql<number>`count(*)::int` }).from(returns).groupBy(returns.status));
  const n = (statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + Number(r.n), 0);
  return { open: n(["REQUESTED", "UNDER_REVIEW"]), refund: n(["RECEIVED", "INSPECTION", "REFUND_PENDING"]) };
}

export async function getReturn(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [found] = await tx.select({ r: returns, order: orders, client: clients }).from(returns).innerJoin(orders, eq(orders.id, returns.orderId)).leftJoin(clients, eq(clients.id, returns.clientId)).where(eq(returns.id, id));
    if (!found) throw new NotFoundError();
    const items = await tx.select().from(returnItems).where(eq(returnItems.returnId, id));
    const events = await tx.select().from(returnEvents).where(eq(returnEvents.returnId, id)).orderBy(desc(returnEvents.createdAt));
    const supplier = await tx
      .select({ s: supplierReturns, name: suppliers.name, conditions: suppliers.returnConditions, number: supplierOrders.number })
      .from(supplierReturns)
      .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
      .leftJoin(supplierOrders, eq(supplierOrders.id, supplierReturns.supplierOrderId))
      .where(eq(supplierReturns.returnId, id))
      .orderBy(asc(supplierReturns.createdAt));
    const money = await tx.select().from(refunds).where(eq(refunds.orderId, found.order.id)).orderBy(desc(refunds.createdAt));
    // Goods of this return that came from a supplier: they may get a supplier return.
    const fromSupplier = items.length
      ? await tx
          .select({ orderItemId: supplierOrderItems.orderItemId })
          .from(supplierOrderItems)
          .innerJoin(supplierOrders, eq(supplierOrders.id, supplierOrderItems.supplierOrderId))
          .where(and(inArray(supplierOrderItems.orderItemId, items.map((i) => i.orderItemId).filter((v): v is string => !!v)), ne(supplierOrders.status, "CANCELLED")))
      : [];
    return {
      ret: found.r,
      order: found.order,
      client: found.client ? displayName(found.client) : null,
      items,
      events,
      supplierReturns: supplier,
      refunds: money,
      canSupplierReturn: fromSupplier.length > 0 && supplier.length === 0,
    };
  });
}

// --- Steps ----------------------------------------------------------------------------------------------

export const stepInput = z.object({
  note: text(2000),
  /** On receiving or inspecting: each line's condition and how much goes back on the shelf. */
  inspection: z
    .array(z.object({ itemId: z.string().uuid(), condition: z.enum(CONDITIONS), restock: z.coerce.number().min(0).max(100_000) }))
    .max(50)
    .default([]),
});
export type StepInput = z.input<typeof stepInput>;

/** One step of a return; REFUNDED comes from the refunds themselves. */
export async function moveReturn(ctx: Context, id: string, to: ReturnStatus, raw: StepInput = {}): Promise<void> {
  requirePermission(ctx.permissions, "orders.update");
  if (!MANUAL_STEPS.includes(to)) throw new ReturnError("STEP");
  const input = stepInput.parse(raw);
  const now = new Date();
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(returns).where(eq(returns.id, id)).for("update");
    if (!row) throw new NotFoundError();
    const from = row.status as ReturnStatus;
    if (!canMove(from, to)) throw new ReturnError("STEP");
    const patch: Partial<typeof returns.$inferInsert> = { status: to, updatedAt: now };
    if (to === "APPROVED" || to === "REJECTED") patch.decidedAt = now;
    if (to === "RECEIVED") patch.receivedAt = now;
    if (to === "CLOSED") patch.closedAt = now;
    if (input.inspection.length) {
      const items = await tx.select().from(returnItems).where(eq(returnItems.returnId, id));
      for (const line of input.inspection) {
        const item = items.find((i) => i.id === line.itemId);
        if (!item) throw new NotFoundError();
        const restock = Math.min(line.restock, Number(item.quantity));
        await tx.update(returnItems).set({ condition: line.condition, restocked: String(restock) }).where(eq(returnItems.id, item.id));
        // Back on the shelf, once per line; only products that keep stock.
        if (restock > 0 && item.productId) {
          const [product] = await tx.select({ trackStock: products.trackStock }).from(products).where(eq(products.id, item.productId));
          if (product?.trackStock) await bookMovement(tx, ctx, { productId: item.productId, variantId: item.variantId, type: "RETURN", quantity: restock, dedupeKey: `return:${id}:${item.id}`, note: `R-${row.number}` });
        }
      }
    }
    await tx.update(returns).set(patch).where(eq(returns.id, id));
    await event(tx, ctx.organization.id, id, to, ctx.user.userId, { from, ...(input.note ? { note: input.note } : {}), ...(input.inspection.length ? { inspected: input.inspection.length } : {}) });
    await audit(tx, ctx, "return.step", "return", id, { from, to, number: row.number });
  });
  if (to === "APPROVED" || to === "REJECTED") await mailBuyer(ctx.organization.id, id, to === "APPROVED" ? "approved" : "rejected").catch((e) => console.error("returns: mail failed", e instanceof Error ? e.message : e));
}

export const detailsInput = z.object({
  note: text(4000),
  refundCents: z.coerce.number().int().min(0).max(100_000_000),
});

/** The company's own note and the amount it plans to refund. */
export async function saveReturnDetails(ctx: Context, id: string, raw: z.input<typeof detailsInput>): Promise<void> {
  requirePermission(ctx.permissions, "orders.update");
  const input = detailsInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select({ id: returns.id, orderId: returns.orderId }).from(returns).where(eq(returns.id, id));
    if (!row) throw new NotFoundError();
    const [order] = await tx.select({ gross: orders.grossCents }).from(orders).where(eq(orders.id, row.orderId));
    if (input.refundCents > (order?.gross ?? 0)) throw new ReturnError("AMOUNT");
    await tx.update(returns).set({ note: input.note, refundCents: input.refundCents, updatedAt: new Date() }).where(eq(returns.id, id));
    await audit(tx, ctx, "return.update", "return", id, { refundCents: input.refundCents });
  });
}

// --- The supplier's side ------------------------------------------------------------------------------

/** Supplier returns for the goods of a return that came straight from suppliers: one per supplier order. */
export async function openSupplierReturns(ctx: Context, id: string): Promise<number> {
  requirePermission(ctx.permissions, "orders.update");
  return withTenant(ctx.organization.id, async (tx) => {
    const items = await tx.select().from(returnItems).where(eq(returnItems.returnId, id));
    const ids = items.map((i) => i.orderItemId).filter((v): v is string => !!v);
    if (!ids.length) throw new ReturnError("NO_SUPPLIER");
    const lines = await tx
      .select({ item: supplierOrderItems, so: supplierOrders })
      .from(supplierOrderItems)
      .innerJoin(supplierOrders, eq(supplierOrders.id, supplierOrderItems.supplierOrderId))
      .where(and(inArray(supplierOrderItems.orderItemId, ids), ne(supplierOrders.status, "CANCELLED")));
    if (!lines.length) throw new ReturnError("NO_SUPPLIER");
    const existing = new Set((await tx.select({ so: supplierReturns.supplierOrderId }).from(supplierReturns).where(eq(supplierReturns.returnId, id))).map((r) => r.so));
    const bySo = new Map<string, { so: typeof supplierOrders.$inferSelect; cents: number }>();
    for (const { item, so } of lines) {
      if (existing.has(so.id)) continue;
      const returned = Number(items.find((i) => i.orderItemId === item.orderItemId)?.quantity ?? 0);
      const quantity = Math.min(returned, Number(item.quantity));
      const entry = bySo.get(so.id) ?? { so, cents: 0 };
      entry.cents += Math.round(item.unitCostCents * quantity);
      bySo.set(so.id, entry);
    }
    for (const { so, cents } of bySo.values()) {
      await tx.insert(supplierReturns).values({ organizationId: ctx.organization.id, returnId: id, supplierId: so.supplierId, supplierOrderId: so.id, expectedCents: cents, currency: so.currency });
    }
    if (bySo.size) await event(tx, ctx.organization.id, id, "supplierReturn", ctx.user.userId, { count: bySo.size });
    await audit(tx, ctx, "return.supplier_open", "return", id, { count: bySo.size });
    return bySo.size;
  });
}

export const supplierStepInput = z.object({
  settledCents: z.coerce.number().int().min(0).max(100_000_000).nullish().transform((v) => v ?? null),
  reference: text(200),
  note: text(2000),
});

/** A step of the supplier's side; paid back or made good always says how much. */
export async function moveSupplierReturn(ctx: Context, id: string, to: SupplierReturnStatus, raw: z.input<typeof supplierStepInput> = {}): Promise<void> {
  requirePermission(ctx.permissions, "orders.update");
  if (!(SUPPLIER_RETURN_STATUSES as readonly string[]).includes(to)) throw new ReturnError("STEP");
  const input = supplierStepInput.parse(raw);
  const now = new Date();
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, id)).for("update");
    if (!row) throw new NotFoundError();
    const from = row.status as SupplierReturnStatus;
    if (!canMoveSupplier(from, to)) throw new ReturnError("STEP");
    if (SUPPLIER_PAID.includes(to) && input.settledCents === null) throw new ReturnError("AMOUNT");
    await tx
      .update(supplierReturns)
      .set({
        status: to,
        ...(SUPPLIER_PAID.includes(to) ? { settledCents: input.settledCents, settledAt: now } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.note ? { note: input.note } : {}),
        updatedAt: now,
      })
      .where(eq(supplierReturns.id, id));
    await event(tx, ctx.organization.id, row.returnId, `supplier.${to}`, ctx.user.userId, { supplierReturnId: id, ...(input.settledCents !== null ? { settledCents: input.settledCents } : {}) });
    await audit(tx, ctx, "supplier_return.step", "return", row.returnId, { from, to, settledCents: input.settledCents });
  });
}

// --- The buyer -------------------------------------------------------------------------------------------

export type BuyerReturn = { number: number; status: ReturnStatus; createdAt: string };

/** The returns of a buyer's order, for their order page. */
export async function returnsForBuyer(organizationId: string, orderId: string): Promise<BuyerReturn[]> {
  const rows = await withTenant(organizationId, (tx) => tx.select({ number: returns.number, status: returns.status, createdAt: returns.createdAt }).from(returns).where(eq(returns.orderId, orderId)).orderBy(asc(returns.createdAt)));
  return rows.map((r) => ({ number: r.number, status: r.status as ReturnStatus, createdAt: r.createdAt.toISOString() }));
}

/** What the buyer may still send back of their order: lines within the rules. */
export async function buyerReturnable(organizationId: string, orderId: string, smallBusiness: boolean, now = new Date()): Promise<ReturnableLine[]> {
  return withTenant(organizationId, async (tx) => (await returnableIn(tx, orderId, smallBusiness, now)).lines.filter((l) => l.allowed));
}

/** A mail to the buyer of a store order about their return, in the store's language; nothing without mail. */
export async function mailBuyer(organizationId: string, returnId: string, kind: "requested" | "approved" | "rejected" | "refunded", amount?: string): Promise<void> {
  if (!mailAvailable() || !takeMailBudget(organizationId)) return;
  const [row] = await withTenant(organizationId, (tx) =>
    tx
      .select({ number: returns.number, orderNumber: orders.number, storeId: orders.storeId, email: clients.email })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .leftJoin(clients, eq(clients.id, returns.clientId))
      .where(eq(returns.id, returnId)),
  );
  if (!row?.storeId || !row.email) return;
  const [found] = await getDb().select({ store: stores, org: organizations }).from(stores).innerJoin(organizations, eq(organizations.id, stores.organizationId)).where(eq(stores.id, row.storeId));
  if (!found) return;
  const locale = isLocale(found.store.locale) ? found.store.locale : "de";
  const t = translator(MESSAGES[locale]);
  const vars = { number: row.number, order: row.orderNumber, store: found.store.name, amount: amount ?? "" };
  await sendMail({
    to: row.email,
    subject: t(`aftersales.mail.${kind}Subject`, vars),
    text: [t(`aftersales.mail.${kind}Body`, vars), "", found.org.legalName ?? found.org.name].join("\n"),
    replyTo: found.store.contactEmail ?? found.org.email ?? undefined,
  });
}
