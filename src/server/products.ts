/**
 * Products and services: what a company sells, with a net price and a VAT
 * rate. Lines on orders and invoices may start from one and are then copied:
 * changing a price later never changes an order or an invoice.
 */
import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { productCategories, products } from "@/db/schema";
import { audit, type Via } from "./audit";
import type { Context } from "./context";
import { NotFoundError } from "./clients";
import { checkRates, taxRate } from "./money";
import { requirePermission } from "./permissions";

export type Product = typeof products.$inferSelect;

export const productInput = z.object({
  kind: z.enum(["PRODUCT", "SERVICE"]).default("SERVICE"),
  name: z.string().trim().min(1).max(200),
  sku: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null),
  unit: z.string().trim().min(1).max(20).default("Stk"),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  vatRate: taxRate,
  active: z.boolean().default(true),
  category: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => v || null),
  barcode: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  purchasePriceCents: z.coerce.number().int().min(0).max(100_000_000).nullish(),
  trackStock: z.boolean().default(false),
  /** Stored as numeric; the stock itself changes only through stock movements. */
  minStock: z.coerce
    .number()
    .min(0)
    .max(1_000_000)
    .nullish()
    .transform((v) => (v == null ? null : String(v))),
  // Left out by a caller, these stay as they are; null empties them.
  categoryId: z.string().uuid().nullable().optional(),
  weightGrams: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  lengthMm: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  widthMm: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  heightMm: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  attributes: z
    .record(z.string().trim().min(1).max(40), z.string().trim().max(200))
    .refine((a) => Object.keys(a).length <= 30, "attributes")
    .optional(),
  shippingCostCents: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
  otherCostCents: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
  returnable: z.boolean().optional(),
  returnDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  shippingNote: z.string().trim().max(500).nullable().optional(),
});
export type ProductInput = z.input<typeof productInput>;

export async function listProducts(ctx: Context, opts: { q?: string; activeOnly?: boolean } = {}) {
  requirePermission(ctx.permissions, "orders.read");
  const filters: SQL[] = [];
  if (opts.activeOnly) filters.push(eq(products.active, true));
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(products.name, like), ilike(products.sku, like))!);
  }
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(products)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(products.name)),
  );
}

export async function saveProduct(ctx: Context, raw: ProductInput, id?: string, via: Via = "web"): Promise<Product> {
  requirePermission(ctx.permissions, "products.manage");
  const input = productInput.parse(raw);
  checkRates([input], ctx.organization, () => ["vatRate"]);
  return withTenant(ctx.organization.id, async (tx) => {
    // The category's name is kept on the product too, for lists that read only that.
    if (input.categoryId) {
      const [category] = await tx.select({ name: productCategories.name }).from(productCategories).where(eq(productCategories.id, input.categoryId));
      if (!category) throw new NotFoundError();
      input.category = category.name;
    } else if (input.categoryId === null) input.category = null;
    if (id) {
      const [row] = await tx
        .update(products)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
      if (!row) throw new NotFoundError();
      await audit(tx, ctx, "product.update", "product", id, undefined, via);
      return row;
    }
    const [row] = await tx
      .insert(products)
      .values({ ...input, organizationId: ctx.organization.id })
      .returning();
    await audit(tx, ctx, "product.create", "product", row.id, { name: row.name }, via);
    return row;
  });
}

export async function deleteProduct(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "product.delete", "product", id);
  });
}
