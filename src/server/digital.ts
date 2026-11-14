/**
 * Digital goods: products that deliver themselves once the order is paid —
 * a code, an account, a licence, a link. Each sale takes entries of its
 * own from the product's pool (kept encrypted, src/server/secret-box.ts);
 * goods every buyer gets alike (a download, a guide) are "shared" and
 * deliver just the product's note. The buyer finds them on the order page.
 *
 * What is left to sell is the pool less what open orders hold. A paid
 * order whose entries ran out is told to the company and served as soon as
 * the pool is filled again, oldest first. An order of digital goods only is
 * done the moment everything is delivered.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { clients, digitalItems, orderEvents, orderItems, orders, products, productVariants, stores } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { isLocale, MESSAGES, translator, type Locale } from "@/i18n";
import { HOLDING } from "@/lib/order-flow";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { mailAvailable, sendMail, takeMailBudget } from "./mail";
import { companyLeads, notify } from "./notifications";
import { heldStock } from "./order-flow";
import { requirePermission } from "./permissions";
import { seal, unseal } from "./secret-box";

export class DigitalError extends Error {
  constructor(public readonly code: "NOT_DIGITAL" | "EMPTY" | "TOO_MANY" | "SOLD") {
    super(code);
  }
}

const MAX_ENTRY = 4000;
const MAX_BATCH = 500;

/** "ABCD-1234-EFGH" → "ABC•••GH": enough to tell entries apart, not enough to use one. */
export const maskOf = (content: string) => (content.length >= 8 ? `${content.slice(0, 3)}•••${content.slice(-2)}` : "•••");

async function digitalProduct(tx: Tx, productId: string) {
  const [p] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!p) throw new NotFoundError();
  if (p.fulfillment !== "DIGITAL") throw new DigitalError("NOT_DIGITAL");
  return p;
}

const sameVariant = (variantId: string | null) => (variantId ? eq(digitalItems.variantId, variantId) : isNull(digitalItems.variantId));

// --- The pool ----------------------------------------------------------------------------------

export type DigitalOverview = {
  shared: boolean;
  note: string;
  available: number;
  sold: number;
  /** Entries paid orders still wait for. */
  waiting: number;
  items: { id: string; variantId: string | null; status: string; mask: string; orderId: string | null; orderNumber: number | null; soldAt: Date | null; createdAt: Date }[];
};

export async function digitalOverview(ctx: Context, productId: string): Promise<DigitalOverview> {
  requirePermission(ctx.permissions, "products.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const p = await digitalProduct(tx, productId);
    const counts = await tx
      .select({ status: digitalItems.status, n: sql<number>`count(*)::int` })
      .from(digitalItems)
      .where(eq(digitalItems.productId, productId))
      .groupBy(digitalItems.status);
    const rows = await tx
      .select({ item: digitalItems, orderNumber: orders.number })
      .from(digitalItems)
      .leftJoin(orders, eq(orders.id, digitalItems.orderId))
      .where(eq(digitalItems.productId, productId))
      .orderBy(asc(digitalItems.status), desc(digitalItems.createdAt))
      .limit(300);
    const n = (status: string) => Number(counts.find((c) => c.status === status)?.n ?? 0);
    return {
      shared: p.digitalShared,
      note: p.digitalNote ?? "",
      available: n("AVAILABLE"),
      sold: n("SOLD"),
      waiting: p.digitalShared ? 0 : (await waitingLines(tx, productId)).reduce((sum, l) => sum + l.missing, 0),
      items: rows.map(({ item, orderNumber }) => ({
        id: item.id,
        variantId: item.variantId,
        status: item.status,
        mask: maskOf(unseal(item.content) ?? ""),
        orderId: item.orderId,
        orderNumber,
        soldAt: item.soldAt,
        createdAt: item.createdAt,
      })),
    };
  });
}

const settingsInput = z.object({ shared: z.boolean(), note: z.string().trim().max(4000) });

/** How the product delivers: entries of its own for each sale, or the same note for everyone. */
export async function saveDigitalSettings(ctx: Context, productId: string, raw: z.input<typeof settingsInput>): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  const input = settingsInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    await digitalProduct(tx, productId);
    await tx
      .update(products)
      .set({ digitalShared: input.shared, digitalNote: input.note || null, updatedAt: new Date() })
      .where(eq(products.id, productId));
    await audit(tx, ctx, "product.update", "product", productId, { digital: input.shared ? "shared" : "unique" });
  });
  // Orders that waited for entries wait no longer when everyone gets the same.
  if (input.shared) await deliverWaiting(ctx.organization.id, productId);
}

const addInput = z.object({ variantId: z.string().uuid().nullish(), text: z.string().max(MAX_ENTRY * MAX_BATCH) });

/** New entries, one per line; the same line twice is taken once. Orders that waited are served at once. */
export async function addDigitalItems(ctx: Context, productId: string, raw: z.input<typeof addInput>): Promise<{ added: number; delivered: number }> {
  requirePermission(ctx.permissions, "products.manage");
  const input = addInput.parse(raw);
  const entries = [...new Set(input.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
  if (!entries.length) throw new DigitalError("EMPTY");
  if (entries.length > MAX_BATCH || entries.some((e) => e.length > MAX_ENTRY)) throw new DigitalError("TOO_MANY");
  await withTenant(ctx.organization.id, async (tx) => {
    await digitalProduct(tx, productId);
    const variantId = input.variantId ?? null;
    if (variantId) {
      const [variant] = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)));
      if (!variant) throw new NotFoundError();
    }
    await tx.insert(digitalItems).values(entries.map((content) => ({ organizationId: ctx.organization.id, productId, variantId, content: seal(content) })));
    await audit(tx, ctx, "product.update", "product", productId, { digitalAdded: entries.length });
  });
  return { added: entries.length, delivered: await deliverWaiting(ctx.organization.id, productId) };
}

/** An entry in full, for the person who looks after the product; each look is on record. */
export async function revealDigitalItem(ctx: Context, id: string): Promise<string> {
  requirePermission(ctx.permissions, "products.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [item] = await tx.select().from(digitalItems).where(eq(digitalItems.id, id)).limit(1);
    if (!item) throw new NotFoundError();
    await audit(tx, ctx, "product.update", "product", item.productId, { digitalRevealed: id });
    return unseal(item.content) ?? "";
  });
}

/** An entry not sold yet is taken out of the pool; a sold one stays with its order. */
export async function deleteDigitalItem(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [item] = await tx.select().from(digitalItems).where(eq(digitalItems.id, id)).for("update");
    if (!item) throw new NotFoundError();
    if (item.status !== "AVAILABLE") throw new DigitalError("SOLD");
    await tx.delete(digitalItems).where(eq(digitalItems.id, id));
    await audit(tx, ctx, "product.update", "product", item.productId, { digitalRemoved: 1 });
  });
}

// --- What is left to sell ----------------------------------------------------------------------

/**
 * What a shop may still sell of digital products: null for shared goods
 * (never out), otherwise the pool less what open orders hold and have not
 * been given yet. Products that are not digital are not answered (null).
 */
export async function digitalAvailable(tx: Tx, productIds: string[]): Promise<(productId: string, variantId: string | null) => number | null> {
  if (!productIds.length) return () => null;
  const unique = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, productIds), eq(products.fulfillment, "DIGITAL"), eq(products.digitalShared, false)));
  const ids = unique.map((p) => p.id);
  if (!ids.length) return () => null;
  const pool = await tx
    .select({ productId: digitalItems.productId, variantId: digitalItems.variantId, n: sql<number>`count(*)::int` })
    .from(digitalItems)
    .where(and(inArray(digitalItems.productId, ids), eq(digitalItems.status, "AVAILABLE")))
    .groupBy(digitalItems.productId, digitalItems.variantId);
  const held = await heldStock(tx, ids);
  // Entries already given to orders that are still open are no longer in the pool: they must not count twice.
  const given = await tx
    .select({ productId: digitalItems.productId, variantId: digitalItems.variantId, n: sql<number>`count(*)::int` })
    .from(digitalItems)
    .innerJoin(orders, eq(orders.id, digitalItems.orderId))
    .where(and(inArray(digitalItems.productId, ids), eq(digitalItems.status, "SOLD"), inArray(orders.fulfillmentStatus, HOLDING)))
    .groupBy(digitalItems.productId, digitalItems.variantId);
  const of = (rows: { productId: string; variantId: string | null; n?: number; quantity?: number }[], productId: string, variantId: string | null) =>
    rows.filter((r) => r.productId === productId && (r.variantId ?? null) === variantId).reduce((sum, r) => sum + Number(r.n ?? r.quantity ?? 0), 0);
  return (productId, variantId) => {
    if (!ids.includes(productId)) return null;
    return Math.max(0, of(pool, productId, variantId) - Math.max(0, of(held, productId, variantId) - of(given, productId, variantId)));
  };
}

// --- Delivering --------------------------------------------------------------------------------

/** Lines of paid orders that still lack entries of this product, oldest order first. */
async function waitingLines(tx: Tx, productId: string): Promise<{ orderId: string; missing: number }[]> {
  const rows = await tx
    .select({
      orderId: orders.id,
      quantity: orderItems.quantity,
      given: sql<number>`(select count(*)::int from digital_items d where d.order_item_id = order_items.id)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.productId, productId), eq(orders.paymentStatus, "PAID"), sql`${orders.fulfillmentStatus} <> 'CANCELLED'`))
    .orderBy(asc(orders.paidAt), asc(orders.createdAt));
  return rows.map((r) => ({ orderId: r.orderId, missing: Math.ceil(Number(r.quantity)) - Number(r.given) })).filter((r) => r.missing > 0);
}

export type Delivery = { delivered: number; missing: number; completed: boolean };

/**
 * Gives a paid order its digital goods: entries from the pool for each
 * line that still lacks some. An order made of digital goods only is
 * delivered and done once nothing is missing. Safe to call again: what was
 * given stays given.
 */
export async function deliverDigital(organizationId: string, orderId: string): Promise<Delivery> {
  const nothing: Delivery = { delivered: 0, missing: 0, completed: false };
  const result = await withTenant(organizationId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.paymentStatus !== "PAID" || order.fulfillmentStatus === "CANCELLED") return null;
    const lines = await tx
      .select({ id: orderItems.id, productId: orderItems.productId, variantId: orderItems.variantId, quantity: orderItems.quantity, description: orderItems.description, fulfillment: products.fulfillment, shared: products.digitalShared })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, orderId));
    const digital = lines.filter((l) => l.fulfillment === "DIGITAL");
    if (!digital.length) return null;
    const now = new Date();
    let delivered = 0;
    const short: string[] = [];
    let missing = 0;
    for (const line of digital) {
      if (line.shared) continue;
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(digitalItems).where(eq(digitalItems.orderItemId, line.id));
      const need = Math.ceil(Number(line.quantity)) - Number(n);
      if (need <= 0) continue;
      // Two orders paid at the same moment take different entries.
      const picked = await tx
        .select({ id: digitalItems.id })
        .from(digitalItems)
        .where(and(eq(digitalItems.productId, line.productId!), sameVariant(line.variantId), eq(digitalItems.status, "AVAILABLE")))
        .orderBy(asc(digitalItems.createdAt), asc(digitalItems.id))
        .limit(need)
        .for("update", { skipLocked: true });
      if (picked.length) {
        await tx
          .update(digitalItems)
          .set({ status: "SOLD", orderId, orderItemId: line.id, soldAt: now })
          .where(inArray(digitalItems.id, picked.map((p) => p.id)));
        delivered += picked.length;
      }
      if (picked.length < need) {
        missing += need - picked.length;
        short.push(line.description.split("\n")[0]);
      }
    }
    const completed = !missing && lines.every((l) => l.fulfillment === "DIGITAL") && order.fulfillmentStatus !== "DELIVERED";
    if (completed) {
      await tx.update(orders).set({ fulfillmentStatus: "DELIVERED", status: "COMPLETED", deliveredAt: now, updatedAt: now }).where(eq(orders.id, orderId));
      await tx.insert(orderEvents).values({ organizationId, orderId, kind: "deliver", data: { digital: true }, userId: null });
    }
    const [buyer] = await tx
      .select({ email: clients.email, slug: stores.slug, storeName: stores.name, locale: stores.locale })
      .from(clients)
      .leftJoin(stores, eq(stores.id, order.storeId ?? sql`null`))
      .where(eq(clients.id, order.clientId))
      .limit(1);
    return { delivered, missing, completed, short, number: order.number, reference: order.externalRef ?? String(order.number), buyer };
  });
  if (!result) return nothing;

  const later = (what: string) => (e: unknown) => console.error(`digital: ${what} failed`, e instanceof Error ? e.message : e);
  const { companyContext, fireAutomations } = await import("./automations");
  const ctx = result.missing || result.completed ? await companyContext(organizationId) : null;
  if (result.missing) {
    // The company fills the pool; the order is served by itself then.
    const words = translator(MESSAGES[ctx && isLocale(ctx.organization.locale) ? ctx.organization.locale : "de"]);
    await notify(organizationId, await companyLeads(organizationId), {
      category: "update",
      kind: "automation",
      vars: { message: words("digital.short", { order: `#${result.number}`, count: String(result.missing), product: result.short.join(", ") }) },
      href: `/app/orders/${orderId}`,
      entity: "order",
      entityId: orderId,
      priority: 2,
      dedupeKey: `digital-short:${orderId}:${result.missing}`,
    }).catch(later("notify"));
  }
  if ((result.delivered || result.completed) && result.buyer?.email && result.buyer.slug && mailAvailable() && takeMailBudget(organizationId)) {
    const locale: Locale = isLocale(result.buyer.locale) ? result.buyer.locale : "de";
    const t = translator(MESSAGES[locale]);
    await sendMail({
      to: result.buyer.email,
      subject: t("digital.mail.subject", { number: result.reference, store: result.buyer.storeName ?? "" }),
      text: [t("digital.mail.body", { number: result.reference }), "", result.buyer.storeName ?? ""].join("\n"),
    }).catch(later("mail"));
  }
  if (result.completed && ctx) await fireAutomations(ctx, "order.completed", orderId).catch(later("automations"));
  return { delivered: result.delivered, missing: result.missing, completed: result.completed };
}

/** Serves the paid orders that wait for this product, oldest first; returns how many entries went out. */
export async function deliverWaiting(organizationId: string, productId: string): Promise<number> {
  const waiting = await withTenant(organizationId, (tx) => waitingLines(tx, productId));
  let delivered = 0;
  for (const orderId of [...new Set(waiting.map((w) => w.orderId))]) delivered += (await deliverDigital(organizationId, orderId)).delivered;
  return delivered;
}

// --- What the buyer and the company see ------------------------------------------------------------

export type DigitalLine = { description: string; quantity: number; note: string | null; shared: boolean; entries: string[]; missing: number };

/** The digital goods of an order in full, once it is paid: for the buyer's order page (the page's token is the key). */
export async function digitalOfOrder(organizationId: string, orderId: string): Promise<DigitalLine[]> {
  return withTenant(organizationId, async (tx) => {
    const [order] = await tx.select({ payment: orders.paymentStatus, fulfillment: orders.fulfillmentStatus }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order || order.payment !== "PAID" || order.fulfillment === "CANCELLED") return [];
    const lines = await tx
      .select({ id: orderItems.id, description: orderItems.description, quantity: orderItems.quantity, note: products.digitalNote, shared: products.digitalShared })
      .from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(and(eq(orderItems.orderId, orderId), eq(products.fulfillment, "DIGITAL")))
      .orderBy(asc(orderItems.position));
    if (!lines.length) return [];
    const items = await tx.select().from(digitalItems).where(eq(digitalItems.orderId, orderId)).orderBy(asc(digitalItems.soldAt), asc(digitalItems.id));
    return lines.map((l) => {
      const entries = items.filter((i) => i.orderItemId === l.id).map((i) => unseal(i.content) ?? "");
      const quantity = Math.ceil(Number(l.quantity));
      return { description: l.description.split("\n")[0], quantity, note: l.note, shared: l.shared, entries, missing: l.shared ? 0 : Math.max(0, quantity - entries.length) };
    });
  });
}
