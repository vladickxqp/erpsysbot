/**
 * The catalogue around a product: categories, variants, pictures, what
 * suppliers offer it for, and what it earns. Products themselves are saved in
 * products.ts; stock moves only through inventory.ts.
 *
 * Supplier prices are kept with their history: a new price is recorded, not
 * slipped in, so margins and later orders can see that it changed.
 */
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  documents,
  organizations,
  productCategories,
  productImages,
  products,
  productSuppliers,
  productVariants,
  purchaseOrders,
  stockMovements,
  supplierPriceHistory,
  suppliers,
} from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { bestOffer, margins } from "@/lib/pricing";
import { choiceKey, cleanOptions, combinations, MAX_VARIANTS, variantSku, type VariantChoice, type VariantOption } from "@/lib/variants";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export class CatalogError extends Error {
  constructor(public readonly code: "NAME_TAKEN" | "CYCLE" | "SKU_TAKEN" | "NOT_IMAGE" | "TOO_MANY" | "HAS_STOCK" | "OFFER_TAKEN") {
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
const cents = z.coerce.number().int().min(0).max(100_000_000);

/** A unique index refused the row; the driver's error sits inside the query error as its cause. */
const isUnique = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string; cause?: unknown } | null;
  if (!err) return false;
  return err.code === "23505" || /duplicate key|unique constraint/i.test(String(err.message ?? "")) || (err.cause !== undefined && err.cause !== e && isUnique(err.cause));
};

// --- Categories -------------------------------------------------------------------------------

export type Category = typeof productCategories.$inferSelect;

export async function listCategories(ctx: Context) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx.select().from(productCategories).orderBy(asc(productCategories.position), asc(productCategories.name));
    const used = await tx.select({ id: products.categoryId, n: count() }).from(products).where(isNotNull(products.categoryId)).groupBy(products.categoryId);
    const counts = new Map(used.map((u) => [u.id, Number(u.n)]));
    return rows.map((c) => ({ ...c, products: counts.get(c.id) ?? 0 }));
  });
}

export const categoryInput = z.object({ name: z.string().trim().min(1).max(80), parentId: z.string().uuid().nullish().transform((v) => v || null) });

export async function saveCategory(ctx: Context, id: string | null, raw: z.input<typeof categoryInput>): Promise<Category> {
  requirePermission(ctx.permissions, "products.manage");
  const input = categoryInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    if (input.parentId) {
      // A category may not end up inside itself.
      let at: string | null = input.parentId;
      for (let depth = 0; at; depth++) {
        if (at === id || depth > 20) throw new CatalogError("CYCLE");
        const [parent]: { parentId: string | null }[] = await tx.select({ parentId: productCategories.parentId }).from(productCategories).where(eq(productCategories.id, at));
        if (!parent) throw new NotFoundError();
        at = parent.parentId;
      }
    }
    try {
      const [row] = id
        ? await tx.update(productCategories).set(input).where(eq(productCategories.id, id)).returning()
        : await tx.insert(productCategories).values({ ...input, organizationId: ctx.organization.id }).returning();
      if (!row) throw new NotFoundError();
      // The old text column follows, so lists that still read it stay right.
      if (id) await tx.update(products).set({ category: row.name }).where(eq(products.categoryId, row.id));
      await audit(tx, ctx, id ? "category.update" : "category.create", "category", row.id, { name: row.name });
      return row;
    } catch (e) {
      if (isUnique(e)) throw new CatalogError("NAME_TAKEN");
      throw e;
    }
  });
}

/** Its products keep everything but the category; its subcategories move up one level. */
export async function deleteCategory(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(productCategories).where(eq(productCategories.id, id));
    if (!row) throw new NotFoundError();
    await tx.update(productCategories).set({ parentId: row.parentId }).where(eq(productCategories.parentId, id));
    await tx.update(products).set({ categoryId: null, category: null }).where(eq(products.categoryId, id));
    await tx.delete(productCategories).where(eq(productCategories.id, id));
    await audit(tx, ctx, "category.delete", "category", id, { name: row.name });
  });
}

/** A category by name at the top level, made when it is missing (imports). */
export async function categoryByName(tx: Tx, organizationId: string, name: string): Promise<string> {
  const clean = name.trim().slice(0, 80);
  const [known] = await tx
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(isNull(productCategories.parentId), sql`lower(${productCategories.name}) = lower(${clean})`))
    .limit(1);
  if (known) return known.id;
  const [row] = await tx.insert(productCategories).values({ organizationId, name: clean }).returning({ id: productCategories.id });
  return row.id;
}

// --- The catalogue list -----------------------------------------------------------------------

export const CATALOG_SORTS = ["name", "sku", "price", "stock", "created"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
export const CATALOG_STATUS = ["active", "inactive", "imported"] as const;

export async function listCatalog(
  ctx: Context,
  query: { q?: string; categoryId?: string; status?: (typeof CATALOG_STATUS)[number]; sort?: CatalogSort; dir?: "asc" | "desc"; page?: number; pageSize?: number } = {},
) {
  requirePermission(ctx.permissions, "orders.read");
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const filters: SQL[] = [];
  if (query.status === "active") filters.push(eq(products.active, true));
  if (query.status === "inactive") filters.push(eq(products.active, false));
  if (query.status === "imported") filters.push(isNotNull(products.importId), eq(products.active, false));
  if (query.categoryId) filters.push(eq(products.categoryId, query.categoryId));
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(
      or(
        ilike(products.name, like),
        ilike(products.sku, like),
        ilike(products.barcode, like),
        sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and (v.sku ilike ${like} or v.barcode ilike ${like}))`,
      )!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;
  const column = { name: sql`lower(${products.name})`, sku: sql`${products.sku}`, price: sql`${products.priceCents}`, stock: sql`${products.stockQuantity}`, created: sql`${products.createdAt}` }[query.sort ?? "name"];
  const order = query.dir === "desc" ? sql`${column} desc nulls last` : sql`${column} asc nulls last`;
  const org = await feesOf(ctx.organization.id);
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({
        product: products,
        categoryName: productCategories.name,
        variants: sql<number>`(select count(*)::int from product_variants v where v.product_id = ${products.id})`,
        imageId: sql<string | null>`(select i.document_id from product_images i where i.product_id = ${products.id} order by i.position, i.created_at limit 1)`,
        // The same offer the product page calls the best: cheapest with its shipping, preferred on a tie.
        bestPurchase: sql<number | null>`(select s.purchase_price_cents from product_suppliers s where s.product_id = ${products.id} and s.variant_id is null and s.currency = ${ctx.organization.currency} order by s.purchase_price_cents + coalesce(s.shipping_cost_cents, 0), s.preferred desc limit 1)`,
        bestShipping: sql<number | null>`(select s.shipping_cost_cents from product_suppliers s where s.product_id = ${products.id} and s.variant_id is null and s.currency = ${ctx.organization.currency} order by s.purchase_price_cents + coalesce(s.shipping_cost_cents, 0), s.preferred desc limit 1)`,
      })
      .from(products)
      .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(where)
      .orderBy(order, asc(products.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await tx.select({ total: count() }).from(products).where(where);
    return {
      rows: rows.map(({ product: p, categoryName, variants, imageId, bestPurchase, bestShipping }) => ({
        ...p,
        categoryName,
        variants: Number(variants),
        imageId,
        margins: margins({
          priceCents: p.priceCents,
          purchaseCents: p.purchasePriceCents ?? (bestPurchase === null ? null : Number(bestPurchase)),
          shippingCents: p.shippingCostCents ?? (p.purchasePriceCents === null && bestShipping !== null ? Number(bestShipping) : null),
          otherCents: p.otherCostCents,
          feePercent: org.feePercent,
          feeFixedCents: org.feeFixedCents,
          vatRate: ctx.organization.smallBusiness ? 0 : p.vatRate,
        }),
      })),
      total: Number(total),
      page,
      pageSize,
    };
  });
}

async function feesOf(organizationId: string) {
  const [org] = await getDb()
    .select({ feePercent: organizations.paymentFeePercent, feeFixedCents: organizations.paymentFeeFixedCents })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return { feePercent: Number(org?.feePercent ?? 0), feeFixedCents: Number(org?.feeFixedCents ?? 0) };
}

// --- One product ------------------------------------------------------------------------------

export async function getProductDetail(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "orders.read");
  const fees = await feesOf(ctx.organization.id);
  return withTenant(ctx.organization.id, async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    if (!product) throw new NotFoundError();
    const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.position), asc(productVariants.createdAt));
    const images = await tx
      .select({ id: productImages.id, documentId: productImages.documentId, position: productImages.position, alt: productImages.alt, name: documents.name })
      .from(productImages)
      .innerJoin(documents, eq(documents.id, productImages.documentId))
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.position), asc(productImages.createdAt));
    const offers = await tx
      .select({ offer: productSuppliers, supplier: { id: suppliers.id, name: suppliers.name, country: suppliers.country, status: suppliers.status, deliveryDays: suppliers.deliveryDays } })
      .from(productSuppliers)
      .innerJoin(suppliers, eq(suppliers.id, productSuppliers.supplierId))
      .where(eq(productSuppliers.productId, id))
      .orderBy(asc(productSuppliers.purchasePriceCents));
    const history = offers.length
      ? await tx
          .select()
          .from(supplierPriceHistory)
          .where(inArray(supplierPriceHistory.productSupplierId, offers.map((o) => o.offer.id)))
          .orderBy(desc(supplierPriceHistory.recordedAt))
      : [];
    const movements = await tx.select().from(stockMovements).where(eq(stockMovements.productId, id)).orderBy(desc(stockMovements.createdAt)).limit(100);
    const vatRate = ctx.organization.smallBusiness ? 0 : product.vatRate;
    // Only offers in the company's currency can stand next to its prices; others are listed, not counted.
    const own = (o: (typeof offers)[number]) => o.offer.currency === ctx.organization.currency;
    const baseOffers = offers.filter((o) => o.offer.variantId === null && own(o)).map((o) => o.offer);
    const best = bestOffer(baseOffers);
    const purchase = product.purchasePriceCents ?? best?.purchasePriceCents ?? null;
    const shipping = product.shippingCostCents ?? (best && product.purchasePriceCents === null ? best.shippingCostCents : null);
    const marginOf = (price: number, buy: number | null) =>
      margins({ priceCents: price, purchaseCents: buy, shippingCents: shipping, otherCents: product.otherCostCents, feePercent: fees.feePercent, feeFixedCents: fees.feeFixedCents, vatRate });
    return {
      product,
      variants: variants.map((v) => {
        const mine = bestOffer(offers.filter((o) => o.offer.variantId === v.id && own(o)).map((o) => o.offer));
        return { ...v, margins: marginOf(v.priceCents ?? product.priceCents, v.purchasePriceCents ?? mine?.purchasePriceCents ?? purchase) };
      }),
      images,
      offers: offers.map((o) => ({
        ...o.offer,
        supplier: o.supplier,
        history: history.filter((h) => h.productSupplierId === o.offer.id).slice(0, 10),
      })),
      bestOfferId: best?.id ?? null,
      movements,
      margins: marginOf(product.priceCents, purchase),
      fees,
    };
  });
}

// --- Variants ---------------------------------------------------------------------------------

const optionSchema = z.array(z.object({ name: z.string(), values: z.array(z.string()) })).max(10);

/**
 * Sets the product's options and makes a variant for every combination that
 * has none. A combination that is no longer offered keeps its variant when
 * stock or bookings hang on it (switched off); otherwise it goes.
 */
export async function saveVariantOptions(ctx: Context, productId: string, raw: VariantOption[]) {
  requirePermission(ctx.permissions, "products.manage");
  const options = cleanOptions(optionSchema.parse(raw));
  const wanted = combinations(options);
  if (wanted.length >= MAX_VARIANTS) throw new CatalogError("TOO_MANY");
  return withTenant(ctx.organization.id, async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
    if (!product) throw new NotFoundError();
    const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, productId));
    const keys = new Set(wanted.map(choiceKey));
    let position = 0;
    let created = 0;
    for (const choice of wanted) {
      position++;
      const key = choiceKey(choice);
      const known = existing.find((v) => v.optionsKey === key);
      if (known) {
        await tx.update(productVariants).set({ position, active: true, updatedAt: new Date() }).where(eq(productVariants.id, known.id));
        continue;
      }
      let sku = variantSku(product.sku, choice, options);
      // A suggested SKU that is taken stays empty: the person names it.
      if (sku) {
        const [taken] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku)).limit(1);
        if (taken) sku = null;
      }
      await tx.insert(productVariants).values({ organizationId: ctx.organization.id, productId, options: choice, optionsKey: key, sku, position });
      created++;
    }
    let removed = 0;
    for (const variant of existing.filter((v) => !keys.has(v.optionsKey))) {
      const [booked] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.variantId, variant.id)).limit(1);
      if (booked || Number(variant.stockQuantity) !== 0) {
        await tx.update(productVariants).set({ active: false, updatedAt: new Date() }).where(eq(productVariants.id, variant.id));
      } else {
        await tx.delete(productVariants).where(eq(productVariants.id, variant.id));
        removed++;
      }
    }
    await tx.update(products).set({ variantOptions: options, updatedAt: new Date() }).where(eq(products.id, productId));
    await audit(tx, ctx, "product.variants", "product", productId, { options: options.length, created, removed });
    return { created, removed, variants: wanted.length };
  });
}

export const variantInput = z.object({
  sku: text(60),
  barcode: text(60),
  priceCents: cents.nullish().transform((v) => (v === undefined ? null : v)),
  purchasePriceCents: cents.nullish().transform((v) => (v === undefined ? null : v)),
  minStock: z.coerce
    .number()
    .min(0)
    .max(1_000_000)
    .nullish()
    .transform((v) => (v == null ? null : String(v))),
  active: z.boolean().default(true),
});

export async function saveVariant(ctx: Context, id: string, raw: z.input<typeof variantInput>) {
  requirePermission(ctx.permissions, "products.manage");
  const input = variantInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    try {
      const [row] = await tx.update(productVariants).set({ ...input, updatedAt: new Date() }).where(eq(productVariants.id, id)).returning();
      if (!row) throw new NotFoundError();
      await audit(tx, ctx, "variant.update", "product", row.productId, { variant: id });
      return row;
    } catch (e) {
      if (isUnique(e)) throw new CatalogError("SKU_TAKEN");
      throw e;
    }
  });
}

export const variantLabel = (choice: unknown) => Object.values((choice ?? {}) as VariantChoice).join(" / ");

// --- Pictures ---------------------------------------------------------------------------------

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function addProductImage(ctx: Context, productId: string, documentId: string): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId));
    const [doc] = await tx.select({ mimeType: documents.mimeType }).from(documents).where(eq(documents.id, documentId));
    if (!product || !doc) throw new NotFoundError();
    if (!IMAGE_TYPES.includes(doc.mimeType)) throw new CatalogError("NOT_IMAGE");
    const [{ last }] = await tx.select({ last: sql<number>`coalesce(max(${productImages.position}), 0)::int` }).from(productImages).where(eq(productImages.productId, productId));
    await tx
      .insert(productImages)
      .values({ organizationId: ctx.organization.id, productId, documentId, position: Number(last) + 1 })
      .onConflictDoNothing();
    await audit(tx, ctx, "product.image", "product", productId, { document: documentId });
  });
}

/** The picture leaves the product; the file stays in the documents. */
export async function removeProductImage(ctx: Context, imageId: string): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(productImages).where(eq(productImages.id, imageId)).returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "product.image_remove", "product", row.productId, { document: row.documentId });
  });
}

/** Moves a picture one place up (it becomes the first one at the top). */
export async function moveProductImage(ctx: Context, imageId: string, direction: "up" | "down"): Promise<void> {
  requirePermission(ctx.permissions, "products.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [image] = await tx.select().from(productImages).where(eq(productImages.id, imageId));
    if (!image) throw new NotFoundError();
    const all = await tx.select().from(productImages).where(eq(productImages.productId, image.productId)).orderBy(asc(productImages.position), asc(productImages.createdAt));
    const at = all.findIndex((i) => i.id === imageId);
    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= all.length) return;
    [all[at], all[to]] = [all[to], all[at]];
    for (const [index, item] of all.entries()) await tx.update(productImages).set({ position: index + 1 }).where(eq(productImages.id, item.id));
  });
}

// --- What suppliers offer -----------------------------------------------------------------------

export const offerInput = z.object({
  supplierId: z.string().uuid(),
  variantId: z.string().uuid().nullish().transform((v) => v || null),
  supplierSku: text(80),
  purchasePriceCents: cents,
  currency: z.string().trim().toUpperCase().length(3).nullish(),
  minOrderQty: z.coerce
    .number()
    .positive()
    .max(1_000_000)
    .nullish()
    .transform((v) => (v == null ? null : String(v))),
  leadTimeDays: z.coerce.number().int().min(0).max(365).nullish().transform((v) => v ?? null),
  shippingCostCents: cents.nullish().transform((v) => v ?? null),
  preferred: z.boolean().default(false),
  notes: text(1000),
  /** What the supplier reports in stock; left out: stays, null: no report. */
  supplierStock: z.coerce
    .number()
    .min(0)
    .max(1_000_000_000)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null ? null : String(v))),
});
export type OfferInput = z.input<typeof offerInput>;

/** Saves an offer; a price that differs from the last one goes into its history. */
export async function saveOffer(ctx: Context, productId: string, id: string | null, raw: OfferInput) {
  requirePermission(ctx.permissions, "inventory.manage");
  const input = offerInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId));
    const [supplier] = await tx.select({ id: suppliers.id, currency: suppliers.currency }).from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!product || !supplier) throw new NotFoundError();
    if (input.variantId) {
      const [variant] = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.id, input.variantId), eq(productVariants.productId, productId)));
      if (!variant) throw new NotFoundError();
    }
    const currency = input.currency ?? supplier.currency ?? ctx.organization.currency;
    const before = id ? (await tx.select().from(productSuppliers).where(and(eq(productSuppliers.id, id), eq(productSuppliers.productId, productId))))[0] : null;
    if (id && !before) throw new NotFoundError();
    if (input.preferred) {
      await tx
        .update(productSuppliers)
        .set({ preferred: false })
        .where(and(eq(productSuppliers.productId, productId), input.variantId ? eq(productSuppliers.variantId, input.variantId) : isNull(productSuppliers.variantId), id ? ne(productSuppliers.id, id) : undefined));
    }
    try {
      const values = { ...input, currency, ...(input.supplierStock !== undefined ? { stockReportedAt: input.supplierStock === null ? null : new Date() } : {}) };
      const [row] = id
        ? await tx.update(productSuppliers).set({ ...values, updatedAt: new Date() }).where(eq(productSuppliers.id, id)).returning()
        : await tx.insert(productSuppliers).values({ ...values, organizationId: ctx.organization.id, productId }).returning();
      if (!before || before.purchasePriceCents !== row.purchasePriceCents || before.currency !== row.currency) {
        await tx.insert(supplierPriceHistory).values({ organizationId: ctx.organization.id, productSupplierId: row.id, purchasePriceCents: row.purchasePriceCents, currency: row.currency });
      }
      await audit(tx, ctx, id ? "offer.update" : "offer.create", "product", productId, {
        supplier: input.supplierId,
        price: row.purchasePriceCents,
        ...(before && before.purchasePriceCents !== row.purchasePriceCents ? { from: before.purchasePriceCents } : {}),
      });
      return row;
    } catch (e) {
      if (isUnique(e)) throw new CatalogError("OFFER_TAKEN");
      throw e;
    }
  });
}

export async function deleteOffer(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "inventory.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(productSuppliers).where(eq(productSuppliers.id, id)).returning();
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "offer.delete", "product", row.productId, { supplier: row.supplierId });
  });
}

// --- One supplier -------------------------------------------------------------------------------

/** Below this many received orders, punctuality says little: shown as limited data. */
export const ENOUGH_ORDERS = 3;

export async function getSupplierDetail(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
    if (!supplier) throw new NotFoundError();
    const offers = await tx
      .select({ offer: productSuppliers, product: { id: products.id, name: products.name, sku: products.sku }, variantOptions: productVariants.options })
      .from(productSuppliers)
      .innerJoin(products, eq(products.id, productSuppliers.productId))
      .leftJoin(productVariants, eq(productVariants.id, productSuppliers.variantId))
      .where(eq(productSuppliers.supplierId, id))
      .orderBy(asc(products.name));
    const orders = await tx
      .select({ status: purchaseOrders.status, orderedAt: purchaseOrders.orderedAt, receivedAt: purchaseOrders.receivedAt, expectedOn: purchaseOrders.expectedOn, totalCents: purchaseOrders.totalCents })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.supplierId, id));
    const received = orders.filter((o) => o.status === "RECEIVED" && o.orderedAt && o.receivedAt);
    const days = received.map((o) => (o.receivedAt!.getTime() - o.orderedAt!.getTime()) / 86_400_000);
    const withPromise = received.filter((o) => o.expectedOn);
    const onTime = withPromise.filter((o) => o.receivedAt!.toISOString().slice(0, 10) <= o.expectedOn!);
    return {
      supplier,
      offers: offers.map((o) => ({ ...o.offer, product: o.product, variant: o.variantOptions ? variantLabel(o.variantOptions) : null })),
      performance: {
        orders: orders.length,
        received: received.length,
        spentCents: received.reduce((sum, o) => sum + o.totalCents, 0),
        averageDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
        onTimePercent: withPromise.length ? Math.round((onTime.length / withPromise.length) * 100) : null,
        limited: received.length < ENOUGH_ORDERS,
      },
    };
  });
}

// --- The company's payment fees -----------------------------------------------------------------

export const feeInput = z.object({ paymentFeePercent: z.coerce.number().min(0).max(30), paymentFeeFixedCents: cents.max(10_000) });

export async function saveCommerceSettings(ctx: Context, raw: z.input<typeof feeInput>): Promise<void> {
  requirePermission(ctx.permissions, "settings.manage");
  const input = feeInput.parse(raw);
  await getDb().update(organizations).set(input).where(eq(organizations.id, ctx.organization.id));
  await withTenant(ctx.organization.id, (tx) => audit(tx, ctx, "company.fees", "organization", ctx.organization.id, input));
}
