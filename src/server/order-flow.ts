/**
 * Sold orders on their way: confirming holds the goods, shipping takes them
 * out of stock, delivering completes the order. Payment runs alongside.
 *
 * What is held is never stored as a number that could drift: it is the sum of
 * the lines of every order between confirmed and shipped, computed when asked.
 * Every step is written to the order's history (order_events) and the audit log.
 */
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { orderEvents, orderItems, orders, products, productVariants, supplierOrders } from "@/db/schema";
import { canDo, CHANNELS, FULFILLMENT_AFTER, HOLDING, STATUS_AFTER, type Fulfillment, type OrderAction, type Payment } from "@/lib/order-flow";
import { choiceLabel } from "@/lib/variants";
import { audit, type Via } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { actorOf, afterPayment, cancelSupplierOrdersOf, companyOf, createSupplierOrders, followUp, openSupplierOrders, ownGoodsCount, planDropship } from "./dropship";
import { deductForOrder } from "./inventory";
import { requirePermission } from "./permissions";
import { deliverShipments, recordShipment } from "./shipments";

export class OrderFlowError extends Error {
  constructor(
    public readonly code: "STEP" | "SHORT" | "EMPTY" | "LOCKED" | "NO_SUPPLIER" | "SUPPLIER_OPEN" | "AT_SUPPLIER",
    public readonly lines: { description: string; needed: number; available: number }[] = [],
  ) {
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

export const shippingInput = z.object({
  channel: z.enum(CHANNELS).default("MANUAL"),
  externalRef: text(120),
  shipName: text(200),
  shipStreet: text(200),
  shipPostalCode: text(20),
  shipCity: text(120),
  shipCountry: z
    .string()
    .trim()
    .toUpperCase()
    .length(2)
    .nullish()
    .transform((v) => v || null),
});
export type ShippingInput = z.input<typeof shippingInput>;

export const actionInput = z.object({
  /** Confirm although not everything is in stock (sold ahead, ordered from the supplier). */
  allowShort: z.boolean().default(false),
  carrier: text(80),
  trackingNumber: text(120),
  note: text(1000),
});
export type ActionInput = z.input<typeof actionInput>;

type Holding = { productId: string; variantId: string | null; quantity: number };

/** What the orders between confirmed and shipped hold, per product and variant; one order can be left out. */
export async function heldStock(tx: Tx, productIds: string[], exceptOrderId?: string): Promise<Holding[]> {
  if (!productIds.length) return [];
  const rows = await tx
    .select({ productId: orderItems.productId, variantId: orderItems.variantId, quantity: sql<string>`sum(${orderItems.quantity})` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        inArray(orders.fulfillmentStatus, HOLDING),
        inArray(orderItems.productId, productIds),
        exceptOrderId ? ne(orders.id, exceptOrderId) : undefined,
      ),
    )
    .groupBy(orderItems.productId, orderItems.variantId);
  return rows.map((r) => ({ productId: r.productId!, variantId: r.variantId, quantity: Number(r.quantity) }));
}

/** What open orders hold of one product, in all and per variant. */
export async function heldForProduct(ctx: Context, productId: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await heldStock(tx, [productId]);
    return {
      total: rows.reduce((sum, r) => sum + r.quantity, 0),
      byVariant: Object.fromEntries(rows.filter((r) => r.variantId).map((r) => [r.variantId!, r.quantity])) as Record<string, number>,
    };
  });
}

/** Each tracked line of the order next to what is in stock and what other orders already hold. */
export async function availability(tx: Tx, orderId: string) {
  const lines = await tx
    .select({
      id: orderItems.id,
      description: orderItems.description,
      productId: orderItems.productId,
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
      productStock: products.stockQuantity,
      variantStock: productVariants.stockQuantity,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.productId), eq(products.trackStock, true), eq(products.fulfillment, "STOCK")))
    .orderBy(asc(orderItems.position));
  const held = await heldStock(tx, [...new Set(lines.map((l) => l.productId!))], orderId);
  // Several lines of one order can take from the same stock.
  const taken = new Map<string, number>();
  return lines.map((line) => {
    const key = `${line.productId}:${line.variantId ?? ""}`;
    const stock = Number(line.variantId ? line.variantStock ?? 0 : line.productStock);
    const others = held
      .filter((h) => h.productId === line.productId && (line.variantId ? h.variantId === line.variantId : true))
      .reduce((sum, h) => sum + h.quantity, 0);
    const before = taken.get(key) ?? 0;
    const needed = Number(line.quantity);
    taken.set(key, before + needed);
    const available = Math.round((stock - others - before) * 1000) / 1000;
    return { id: line.id, description: line.description.split("\n")[0], productId: line.productId!, variantId: line.variantId, needed, stock, held: others, available, enough: available >= needed };
  });
}

async function lockedOrder(tx: Tx, id: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!order) throw new NotFoundError();
  return order;
}

async function event(tx: Tx, ctx: Context, orderId: string, kind: string, data: Record<string, unknown> = {}) {
  await tx.insert(orderEvents).values({ organizationId: ctx.organization.id, orderId, kind, data, userId: ctx.user.userId });
}

/** One step of the order; returns the order as it is afterwards. */
export async function runOrderAction(ctx: Context, id: string, action: OrderAction, raw: ActionInput = {}, via: Via = "web") {
  requirePermission(ctx.permissions, "orders.update");
  const input = actionInput.parse(raw);
  const company = action === "confirm" ? await companyOf(ctx.organization.id) : null;
  const done = await withTenant(ctx.organization.id, async (tx) => {
    const order = await lockedOrder(tx, id);
    let dropOnly = false;
    const state = { fulfillment: order.fulfillmentStatus as Fulfillment, payment: order.paymentStatus as Payment };
    if (!canDo(action, state)) throw new OrderFlowError("STEP");
    const now = new Date();
    const patch: Partial<typeof orders.$inferInsert> = { updatedAt: now };
    const data: Record<string, unknown> = {};
    if (action === "confirm") {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(orderItems).where(eq(orderItems.orderId, id));
      if (!Number(n)) throw new OrderFlowError("EMPTY");
      const short = (await availability(tx, id)).filter((l) => !l.enough);
      if (short.length && !input.allowShort) throw new OrderFlowError("SHORT", short.map((l) => ({ description: l.description, needed: l.needed, available: l.available })));
      if (short.length) data.short = short.map((l) => ({ line: l.id, needed: l.needed, available: l.available }));
      patch.confirmedAt = now;
      // Goods a supplier ships go to supplier orders; an order of only such goods waits with the suppliers.
      const plan = await planDropship(tx, id);
      if (plan.missing.length) throw new OrderFlowError("NO_SUPPLIER", plan.missing.map((m) => ({ description: m.description, needed: 0, available: 0 })));
      if (plan.groups.length) {
        data.supplierOrders = (await createSupplierOrders(tx, actorOf(ctx, via), company!, id, plan)).length;
        dropOnly = plan.ownGoods === 0;
      }
    }
    if (action === "ship" && (await openSupplierOrders(tx, id)) > 0) throw new OrderFlowError("SUPPLIER_OPEN");
    if (action === "ship") {
      patch.shippedAt = now;
      patch.carrier = input.carrier;
      patch.trackingNumber = input.trackingNumber;
      data.carrier = input.carrier;
      data.trackingNumber = input.trackingNumber;
      // Out of the warehouse: out of the stock, once.
      data.booked = await deductForOrder(tx, ctx, id);
      await recordShipment(tx, { organizationId: ctx.organization.id, orderId: id, carrier: input.carrier, trackingNumber: input.trackingNumber, userId: ctx.user.userId, source: "manual", at: now });
    }
    if (action === "deliver") {
      patch.deliveredAt = now;
      await deliverShipments(tx, { organizationId: ctx.organization.id, orderId: id }, ctx.user.userId, "manual", now);
      await deductForOrder(tx, ctx, id);
    }
    if (action === "cancel") {
      // What is with a supplier is cancelled there first; the rest goes with the order.
      if (!(await cancelSupplierOrdersOf(tx, actorOf(ctx, via), id))) throw new OrderFlowError("AT_SUPPLIER");
      patch.cancelledAt = now;
    }
    if (action === "markPaid") {
      patch.paymentStatus = "PAID";
      patch.paidAt = now;
    }
    if (action === "markUnpaid") {
      patch.paymentStatus = "UNPAID";
      patch.paidAt = null;
    }
    if (action === "refund") patch.paymentStatus = "REFUNDED";
    if (action in FULFILLMENT_AFTER) patch.fulfillmentStatus = FULFILLMENT_AFTER[action as keyof typeof FULFILLMENT_AFTER];
    if (dropOnly) patch.fulfillmentStatus = "AT_SUPPLIER";
    if (STATUS_AFTER[action]) patch.status = STATUS_AFTER[action];
    if (input.note) data.note = input.note;
    const [row] = await tx.update(orders).set(patch).where(eq(orders.id, id)).returning();
    await event(tx, ctx, id, action, data);
    await audit(tx, ctx, `order.${action}`, "order", id, { from: state, ...(data.booked !== undefined ? { booked: data.booked } : {}) }, via);
    return row;
  });
  if (action === "deliver") await (await import("./automations")).fireAutomations(ctx, "order.completed", id);
  const later = (e: unknown) => console.error("dropship: follow-up failed", e instanceof Error ? e.message : e);
  if (action === "confirm") await followUp(ctx.organization.id, { orderId: id }).catch(later);
  if (action === "markPaid") await afterPayment(ctx.organization.id, id).catch(later);
  // Digital goods go out the moment the order is paid.
  if (action === "markPaid") await (await import("./digital")).deliverDigital(ctx.organization.id, id).catch((e) => console.error("digital: delivery failed", e instanceof Error ? e.message : e));
  return done;
}

/** Where it comes from and where it goes. */
export async function saveShipping(ctx: Context, id: string, raw: ShippingInput) {
  requirePermission(ctx.permissions, "orders.update");
  const input = shippingInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const order = await lockedOrder(tx, id);
    // Once it left the warehouse, the address it was sent to stays as it was.
    const sent = order.fulfillmentStatus === "SHIPPED" || order.fulfillmentStatus === "DELIVERED";
    const changes = sent ? { channel: input.channel, externalRef: input.externalRef } : input;
    const [row] = await tx
      .update(orders)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    await event(tx, ctx, id, "shipping", { address: !sent });
    await audit(tx, ctx, "order.shipping", "order", id);
    return row;
  });
}

/** Lines of an order whose goods are held or sent stay as they are. */
export async function assertLinesOpen(tx: Tx, id: string) {
  const [order] = await tx.select({ fulfillment: orders.fulfillmentStatus }).from(orders).where(eq(orders.id, id));
  if (!order) throw new NotFoundError();
  if (order.fulfillment !== "UNFULFILLED" && order.fulfillment !== "CANCELLED") throw new OrderFlowError("LOCKED");
}

/** A variant on a line must belong to the line's product. */
export async function assertVariants(tx: Tx, lines: { productId?: string | null; variantId?: string | null }[]) {
  const wanted = lines.filter((l) => l.variantId);
  if (!wanted.length) return;
  if (wanted.some((l) => !l.productId)) throw new NotFoundError();
  const found = await tx
    .select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, wanted.map((l) => l.variantId!)));
  for (const line of wanted) if (!found.some((v) => v.id === line.variantId && v.productId === line.productId)) throw new NotFoundError();
}

/** The order's history and what its goods look like now, for the order page. */
export async function getOrderFlow(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id));
    if (!order) throw new NotFoundError();
    const events = await tx.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(desc(orderEvents.createdAt)).limit(100);
    const lines = order.fulfillmentStatus === "UNFULFILLED" || HOLDING.includes(order.fulfillmentStatus as Fulfillment) ? await availability(tx, id) : [];
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(supplierOrders).where(eq(supplierOrders.orderId, id));
    // Goods only from suppliers: the order shows the suppliers' steps.
    const dropOnly = Number(n) > 0 && (await ownGoodsCount(tx, id)) === 0;
    return { order, events, lines, dropOnly };
  });
}

/** Products and their variants as lines can take them. */
export async function lineProducts(ctx: Context) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const list = await tx.select().from(products).where(eq(products.active, true)).orderBy(asc(products.name));
    const variants = list.length
      ? await tx
          .select()
          .from(productVariants)
          .where(and(eq(productVariants.active, true), inArray(productVariants.productId, list.map((p) => p.id))))
          .orderBy(asc(productVariants.position))
      : [];
    return list.flatMap((p) => {
      const base = { id: p.id, variantId: null as string | null, name: p.name, unit: p.unit, priceCents: p.priceCents, vatRate: p.vatRate, description: p.description };
      const own = variants.filter((v) => v.productId === p.id);
      if (!own.length) return [base];
      const options = (p.variantOptions ?? []) as { name: string; values: string[] }[];
      return own.map((v) => ({ ...base, variantId: v.id, name: `${p.name} / ${choiceLabel(v.options as Record<string, string>, options)}`, priceCents: v.priceCents ?? p.priceCents }));
    });
  });
}

/** How many orders wait at each step, for the list's filters. */
export async function flowCounts(ctx: Context) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ fulfillment: orders.fulfillmentStatus, payment: orders.paymentStatus, n: sql<number>`count(*)::int` })
      .from(orders)
      .groupBy(orders.fulfillmentStatus, orders.paymentStatus);
    const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((s, r) => s + Number(r.n), 0);
    return {
      toShip: count((r) => HOLDING.includes(r.fulfillment as Fulfillment)),
      shipped: count((r) => r.fulfillment === "SHIPPED"),
      unpaid: count((r) => r.payment === "UNPAID" && r.fulfillment !== "UNFULFILLED" && r.fulfillment !== "CANCELLED"),
    };
  });
}
