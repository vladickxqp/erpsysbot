/**
 * Inventory: stock per product, changed only by stock movements.
 *
 * Every booking runs in the caller's transaction and is idempotent through a
 * dedupe key: an order completed twice, or a delivery received twice, books
 * once. Stock follows from the bookings (stock_quantity is their running sum).
 */
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { orderItems, products, purchaseOrderItems, purchaseOrders, stockMovements, suppliers } from "@/db/schema";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { nextNumber } from "./numbers";
import { requirePermission } from "./permissions";

export type MovementType = "PURCHASE" | "SALE" | "RETURN" | "ADJUSTMENT" | "TRANSFER";

export class InventoryError extends Error {
  constructor(public readonly code: "NOT_TRACKED" | "NOT_DRAFT" | "NOT_ORDERED" | "EMPTY") {
    super(code);
  }
}

/** Books a movement once per dedupe key; returns whether it was booked now. */
export async function bookMovement(
  tx: Tx,
  ctx: Pick<Context, "organization" | "user">,
  m: { productId: string; type: MovementType; quantity: number; dedupeKey?: string | null; note?: string | null },
): Promise<boolean> {
  if (!m.quantity) return false;
  const inserted = await tx
    .insert(stockMovements)
    .values({
      organizationId: ctx.organization.id,
      productId: m.productId,
      type: m.type,
      quantity: String(m.quantity),
      dedupeKey: m.dedupeKey ?? null,
      note: m.note ?? null,
      createdBy: ctx.user.userId,
    })
    .onConflictDoNothing()
    .returning({ id: stockMovements.id });
  if (!inserted.length) return false;
  await tx
    .update(products)
    .set({ stockQuantity: sql`${products.stockQuantity} + ${String(m.quantity)}::numeric`, updatedAt: new Date() })
    .where(eq(products.id, m.productId));
  return true;
}

/** An order is done: its tracked products leave the stock (once). */
export async function deductForOrder(tx: Tx, ctx: Pick<Context, "organization" | "user">, orderId: string): Promise<number> {
  const lines = await tx
    .select({ id: orderItems.id, productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.productId), eq(products.trackStock, true)));
  let booked = 0;
  for (const line of lines) {
    if (await bookMovement(tx, ctx, { productId: line.productId!, type: "SALE", quantity: -Number(line.quantity), dedupeKey: `order:${orderId}:${line.id}` })) booked++;
  }
  return booked;
}

const adjustInput = z.object({
  /** The counted stock; the difference is booked. */
  counted: z.coerce.number().min(-1_000_000).max(1_000_000),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
});

export async function adjustStock(ctx: Context, productId: string, raw: z.input<typeof adjustInput>): Promise<void> {
  requirePermission(ctx.permissions, "inventory.manage");
  const input = adjustInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product) throw new NotFoundError();
    if (!product.trackStock) throw new InventoryError("NOT_TRACKED");
    const delta = Math.round((input.counted - Number(product.stockQuantity)) * 1000) / 1000;
    await bookMovement(tx, ctx, { productId, type: "ADJUSTMENT", quantity: delta, note: input.note });
    await audit(tx, ctx, "stock.adjust", "product", productId, { from: Number(product.stockQuantity), to: input.counted });
  });
}

export async function listMovements(ctx: Context, productId: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, (tx) =>
    tx.select().from(stockMovements).where(eq(stockMovements.productId, productId)).orderBy(desc(stockMovements.createdAt)).limit(200),
  );
}

/** Tracked products at or below their minimum. */
export async function lowStock(ctx: Context) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: products.id, name: products.name, unit: products.unit, stock: products.stockQuantity, min: products.minStock })
      .from(products)
      .where(and(eq(products.trackStock, true), eq(products.active, true), isNotNull(products.minStock), sql`${products.stockQuantity} <= ${products.minStock}`))
      .orderBy(asc(products.name)),
  );
}

// --- Suppliers --------------------------------------------------------------------------------

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const supplierInput = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: optional(120),
  email: optional(200),
  phone: optional(40),
  street: optional(160),
  postalCode: optional(20),
  city: optional(100),
  country: z.string().trim().toUpperCase().length(2).default("DE"),
  notes: optional(5000),
});
export type SupplierInput = z.input<typeof supplierInput>;

export async function saveSupplier(ctx: Context, id: string | null, raw: SupplierInput) {
  requirePermission(ctx.permissions, "inventory.manage");
  const input = supplierInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [row] = await tx.update(suppliers).set(input).where(eq(suppliers.id, id)).returning();
      if (!row) throw new NotFoundError();
      return row;
    }
    const [row] = await tx.insert(suppliers).values({ ...input, organizationId: ctx.organization.id }).returning();
    return row;
  });
}

export async function listSuppliers(ctx: Context) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, (tx) => tx.select().from(suppliers).orderBy(asc(suppliers.name)));
}

// --- Purchase orders --------------------------------------------------------------------------

export const purchaseInput = z.object({
  supplierId: z.string().uuid(),
  notes: optional(5000),
  expectedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v || null),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().positive().max(1_000_000), unitCostCents: z.coerce.number().int().min(0).max(100_000_000) }))
    .min(1)
    .max(200),
});
export type PurchaseInput = z.input<typeof purchaseInput>;

async function writeItems(tx: Tx, orgId: string, poId: string, items: z.output<typeof purchaseInput>["items"]) {
  await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, poId));
  await tx.insert(purchaseOrderItems).values(
    items.map((item, index) => ({
      organizationId: orgId,
      purchaseOrderId: poId,
      productId: item.productId,
      position: index + 1,
      quantity: String(item.quantity),
      unitCostCents: item.unitCostCents,
    })),
  );
  return items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitCostCents), 0);
}

export async function savePurchaseOrder(ctx: Context, id: string | null, raw: PurchaseInput) {
  requirePermission(ctx.permissions, "inventory.manage");
  const input = purchaseInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw new NotFoundError();
    const known = await tx.select({ id: products.id }).from(products);
    if (input.items.some((i) => !known.some((k) => k.id === i.productId))) throw new NotFoundError();
    if (id) {
      const [current] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
      if (!current) throw new NotFoundError();
      if (current.status !== "DRAFT") throw new InventoryError("NOT_DRAFT");
      const total = await writeItems(tx, ctx.organization.id, id, input.items);
      const [row] = await tx
        .update(purchaseOrders)
        .set({ supplierId: input.supplierId, notes: input.notes, expectedOn: input.expectedOn, totalCents: total, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, id))
        .returning();
      return row;
    }
    const number = await nextNumber(tx, ctx.organization.id, "purchase");
    const [row] = await tx
      .insert(purchaseOrders)
      .values({ organizationId: ctx.organization.id, number, supplierId: input.supplierId, notes: input.notes, expectedOn: input.expectedOn })
      .returning();
    const total = await writeItems(tx, ctx.organization.id, row.id, input.items);
    const [withTotal] = await tx.update(purchaseOrders).set({ totalCents: total }).where(eq(purchaseOrders.id, row.id)).returning();
    await audit(tx, ctx, "purchase.create", "purchase_order", row.id, { number, total });
    return withTotal;
  });
}

export async function setPurchaseStatus(ctx: Context, id: string, status: "ORDERED" | "CANCELLED") {
  requirePermission(ctx.permissions, "inventory.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!current) throw new NotFoundError();
    if (current.status === "RECEIVED" || current.status === "CANCELLED") throw new InventoryError("NOT_DRAFT");
    const [row] = await tx
      .update(purchaseOrders)
      .set({ status, orderedAt: status === "ORDERED" ? new Date() : current.orderedAt, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    await audit(tx, ctx, `purchase.${status.toLowerCase()}`, "purchase_order", id, {});
    return row;
  });
}

/** Goods arrived: every line goes into stock (once) and updates the product's purchase price. */
export async function receivePurchaseOrder(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "inventory.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!current) throw new NotFoundError();
    if (current.status !== "ORDERED" && current.status !== "DRAFT") throw new InventoryError("NOT_ORDERED");
    const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
    if (!items.length) throw new InventoryError("EMPTY");
    for (const item of items) {
      await tx.update(products).set({ trackStock: true, purchasePriceCents: item.unitCostCents }).where(eq(products.id, item.productId));
      await bookMovement(tx, ctx, { productId: item.productId, type: "PURCHASE", quantity: Number(item.quantity), dedupeKey: `po:${id}:${item.id}`, note: `#${current.number}` });
    }
    const [row] = await tx.update(purchaseOrders).set({ status: "RECEIVED", receivedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrders.id, id)).returning();
    await audit(tx, ctx, "purchase.receive", "purchase_order", id, { number: current.number });
    return row;
  });
}

export async function listPurchaseOrders(ctx: Context) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ po: purchaseOrders, supplier: suppliers.name })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.po, supplierName: r.supplier }));
  });
}

export async function getPurchaseOrder(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!po) throw new NotFoundError();
    const items = await tx
      .select({ item: purchaseOrderItems, name: products.name, unit: products.unit })
      .from(purchaseOrderItems)
      .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
      .where(eq(purchaseOrderItems.purchaseOrderId, id))
      .orderBy(asc(purchaseOrderItems.position));
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
    return { po, supplier, items: items.map((i) => ({ ...i.item, name: i.name, unit: i.unit })) };
  });
}
