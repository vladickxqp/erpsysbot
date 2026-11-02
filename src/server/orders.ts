/**
 * Orders: what a client ordered, line by line, and where it stands.
 *
 * The order's totals are stored with it (computed from its lines on every
 * save), so lists and reports add up stored numbers instead of recomputing.
 * An order becomes an invoice draft in one step (invoices.fromOrder).
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { clients, orderItems, orders } from "@/db/schema";
import { audit, type Via } from "./audit";
import { deductForOrder } from "./inventory";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { checkRates, lineNet, linesInput, totals, type Line } from "./money";
import { nextNumber } from "./numbers";
import { requirePermission } from "./permissions";

import { OPEN_STATUSES, ORDER_STATUSES, type OrderStatus } from "@/lib/domain";

export { OPEN_STATUSES, ORDER_STATUSES, type OrderStatus };

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v || null);

export const orderInput = z.object({
  clientId: z.string().uuid(),
  status: z.enum(ORDER_STATUSES).default("NEW"),
  title: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(5000)
    .nullish()
    .transform((v) => v || null),
  dueDate: isoDate,
  items: linesInput,
});
export type OrderInput = z.input<typeof orderInput>;

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;

export function lineRows(organizationId: string, lines: Line[]) {
  return lines.map((line, index) => ({
    organizationId,
    position: index + 1,
    productId: line.productId ?? null,
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
    discountPercent: String(line.discountPercent),
    vatRate: line.vatRate,
    netCents: lineNet(line),
  }));
}

/** A stored line (order or invoice) back as a Line. */
export type StoredLine = Pick<
  OrderItemRow,
  "productId" | "description" | "quantity" | "unit" | "unitPriceCents" | "discountPercent" | "vatRate"
>;

export function asLines(rows: StoredLine[]): Line[] {
  return rows.map((r) => ({
    productId: r.productId,
    description: r.description,
    quantity: Number(r.quantity),
    unit: r.unit,
    unitPriceCents: r.unitPriceCents,
    discountPercent: Number(r.discountPercent),
    vatRate: r.vatRate,
  }));
}

async function clientInCompany(tx: Tx, clientId: string) {
  const [row] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!row) throw new NotFoundError();
}

export async function createOrder(ctx: Context, raw: OrderInput, via: Via = "web"): Promise<OrderRow> {
  requirePermission(ctx.permissions, "orders.create");
  const input = orderInput.parse(raw);
  checkRates(input.items, ctx.organization);
  const sum = totals(input.items, ctx.organization.smallBusiness);
  const created = await withTenant(ctx.organization.id, async (tx) => {
    await clientInCompany(tx, input.clientId);
    const number = await nextNumber(tx, ctx.organization.id, "order");
    const [row] = await tx
      .insert(orders)
      .values({
        organizationId: ctx.organization.id,
        number,
        clientId: input.clientId,
        status: input.status,
        title: input.title,
        notes: input.notes,
        dueDate: input.dueDate,
        assignedUserId: ctx.user.userId,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
      })
      .returning();
    await tx.insert(orderItems).values(lineRows(ctx.organization.id, input.items).map((l) => ({ ...l, orderId: row.id })));
    await tx.update(clients).set({ lastInteractionAt: new Date() }).where(eq(clients.id, input.clientId));
    await audit(tx, ctx, "order.create", "order", row.id, { number, gross: sum.grossCents }, via);
    return row;
  });
  const { fireAutomations } = await import("./automations");
  await fireAutomations(ctx, "order.created", created.id);
  if (created.status === "COMPLETED") await fireAutomations(ctx, "order.completed", created.id);
  return created;
}

export async function updateOrder(ctx: Context, id: string, raw: OrderInput, via: Via = "web"): Promise<OrderRow> {
  requirePermission(ctx.permissions, "orders.update");
  const input = orderInput.parse(raw);
  checkRates(input.items, ctx.organization);
  const sum = totals(input.items, ctx.organization.smallBusiness);
  return withTenant(ctx.organization.id, async (tx) => {
    await clientInCompany(tx, input.clientId);
    const [row] = await tx
      .update(orders)
      .set({
        clientId: input.clientId,
        status: input.status,
        title: input.title,
        notes: input.notes,
        dueDate: input.dueDate,
        netCents: sum.netCents,
        vatCents: sum.vatCents,
        grossCents: sum.grossCents,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    await tx.delete(orderItems).where(eq(orderItems.orderId, id));
    await tx.insert(orderItems).values(lineRows(ctx.organization.id, input.items).map((l) => ({ ...l, orderId: id })));
    if (input.status === "COMPLETED") await deductForOrder(tx, ctx, id);
    await audit(tx, ctx, "order.update", "order", id, { gross: sum.grossCents }, via);
    return row;
  });
}

export async function setOrderStatus(ctx: Context, id: string, status: OrderStatus, via: Via = "web") {
  requirePermission(ctx.permissions, "orders.update");
  const updated = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    // Done: tracked products leave the stock — once, however often it is set to done.
    if (status === "COMPLETED") await deductForOrder(tx, ctx, id);
    await audit(tx, ctx, "order.status", "order", id, { status }, via);
    return row;
  });
  if (status === "COMPLETED") await (await import("./automations")).fireAutomations(ctx, "order.completed", id);
  return updated;
}

export async function deleteOrder(ctx: Context, id: string, via: Via = "web") {
  requirePermission(ctx.permissions, "orders.delete");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(orders).where(eq(orders.id, id)).returning({ number: orders.number });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "order.delete", "order", id, { number: row.number }, via);
  });
}

export async function duplicateOrder(ctx: Context, id: string): Promise<OrderRow> {
  const { order, items } = await getOrder(ctx, id);
  return createOrder(ctx, {
    clientId: order.clientId,
    status: "DRAFT",
    title: order.title,
    notes: order.notes,
    dueDate: null,
    items: asLines(items),
  });
}

export async function getOrder(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) throw new NotFoundError();
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.position));
    const [client] = await tx.select().from(clients).where(eq(clients.id, order.clientId)).limit(1);
    return { order, items, client, clientName: client ? displayName(client) : "—" };
  });
}

export type OrderQuery = { q?: string; status?: OrderStatus | "OPEN"; clientId?: string; page?: number; pageSize?: number };

export async function listOrders(ctx: Context, query: OrderQuery = {}) {
  requirePermission(ctx.permissions, "orders.read");
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const filters: SQL[] = [];
  if (query.status === "OPEN") filters.push(inArray(orders.status, OPEN_STATUSES));
  else if (query.status) filters.push(eq(orders.status, query.status));
  if (query.clientId) filters.push(eq(orders.clientId, query.clientId));
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const asNumber = Number.parseInt(q.replace(/\D/g, ""), 10);
    filters.push(
      or(
        ilike(orders.title, like),
        ilike(clients.companyName, like),
        ilike(clients.lastName, like),
        ilike(clients.firstName, like),
        ...(Number.isFinite(asNumber) ? [eq(orders.number, asNumber)] : []),
      )!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ order: orders, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(orders)
      .innerJoin(clients, eq(clients.id, orders.clientId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .innerJoin(clients, eq(clients.id, orders.clientId))
      .where(where);
    return { rows: rows.map((r) => ({ ...r.order, clientName: displayName(r.client) })), total, page, pageSize };
  });
}
