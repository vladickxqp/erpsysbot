/**
 * The public side of a store: what a visitor sees and buys, without an
 * account. A store is reached by its address (slug); unpublished stores only
 * by the company's own people (preview). Every price, every quantity and
 * every total is worked out here from the company's records — never taken
 * from the browser. An order reserves its goods at once; whether it is paid
 * comes only from the payment provider's verified message
 * (src/server/shop-payments.ts) or from the company marking it.
 */
import { createHash, randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { clients, documents, orderEvents, orderItems, orders, organizations, productCategories, productImages, products, productVariants, stores } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { formatMoney, isLocale, MESSAGES, translator, type Locale } from "@/i18n";
import { allowedRates } from "@/lib/countries";
import { withDependents } from "@/lib/modules";
import { sectionImages, siteModule, type Section, type SiteKind, type SitePage, type Theme } from "@/lib/site";
import { grossCents, MAX_CART_LINES, MAX_QUANTITY, netOfGross, shippingCents, type Design, type Pages, type PaymentMethod, type ShippingOption } from "@/lib/store";
import { choiceLabel, type VariantChoice, type VariantOption } from "@/lib/variants";
import { audit } from "./audit";
import { companyContext } from "./automations";
import { companyOf, createSupplierOrders, dropshipAvailable, followUp, planDropship } from "./dropship";
import type { Context } from "./context";
import { uploadDir } from "./documents";
import { mailAvailable, sendMail, takeMailBudget } from "./mail";
import { totals, type Line } from "./money";
import { companyLeads, notify } from "./notifications";
import { nextNumber } from "./numbers";
import { heldStock } from "./order-flow";
import { isSuspended } from "./platform";
import { appUrl } from "./settings";
import { lineRows } from "./orders";
import { contentOf, viewOf, visibleProductFilter, withChildren, type StoreRow } from "./stores";

export class StorefrontError extends Error {
  constructor(
    public readonly code: "EMPTY" | "GONE" | "SHORT" | "SHIPPING" | "PAYMENT" | "COUNTRY" | "BUSY" | "CLOSED",
    public readonly lines: { name: string; available: number }[] = [],
  ) {
    super(code);
  }
}

export type Company = {
  name: string;
  legalName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  vatId: string | null;
  taxNumber: string | null;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
};

export type PublicStore = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  /** The company's own people see edits that are not published yet. */
  draft: boolean;
  /** A store sells; a creator's or company website shows sections and takes messages. */
  kind: SiteKind;
  locale: Locale;
  design: Design;
  theme: Theme;
  blocks: Section[];
  customPages: SitePage[];
  pages: Pages;
  shipping: ShippingOption[];
  shipCountries: string[];
  /** The ways to pay that work right now. */
  methods: PaymentMethod[];
  currency: string;
  country: string;
  taxRates: number[] | null;
  smallBusiness: boolean;
  contactEmail: string | null;
  company: Company;
  categoryIds: string[];
  /** Shown to the company itself before it goes online. */
  preview: boolean;
};

/** The store at this address: published, or for its own company's people as a preview. */
export async function findStore(slug: string, previewFor?: Pick<Context, "organization" | "permissions"> | null): Promise<PublicStore | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const [row] = await getDb()
    .select({ store: stores, org: organizations })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.organizationId))
    .where(eq(stores.slug, slug))
    .limit(1);
  if (!row || (await isSuspended(row.org.id))) return null;
  // Switched off by the company (or what it needs): closed to everyone.
  if (withDependents(row.org.disabledModules).includes(siteModule(row.store.kind))) return null;
  const own =
    !!previewFor &&
    previewFor.organization.id === row.org.id &&
    (previewFor.permissions.has(row.store.kind === "creator" || row.store.kind === "company" ? "sites.manage" : "products.manage") || previewFor.permissions.has("settings.manage"));
  if (row.store.status !== "PUBLISHED" && !own) return null;
  // Visitors see what was published; the company's own people see their edits (with a note when they differ).
  const shown = !own && row.store.live ? { ...row.store, ...(row.store.live as ReturnType<typeof contentOf>) } : row.store;
  return { ...publicOf(shown, row.org, row.store.status !== "PUBLISHED"), draft: own && viewOf(row.store).changed };
}

function publicOf(storeRow: StoreRow, org: typeof organizations.$inferSelect, preview: boolean): PublicStore {
  const view = viewOf(storeRow);
  const methods: PaymentMethod[] = [];
  if (view.payments.bank && org.iban) methods.push("bank");
  if (view.payments.stripe && view.stripe.key && view.stripe.webhook) methods.push("stripe");
  return {
    id: view.id,
    organizationId: org.id,
    name: view.name,
    slug: view.slug,
    status: view.status,
    draft: false,
    kind: view.kind,
    locale: isLocale(view.locale) ? view.locale : "de",
    design: view.design,
    theme: view.theme,
    blocks: view.blocks,
    customPages: view.customPages,
    pages: view.pages,
    shipping: view.shipping,
    shipCountries: view.shipCountries.length ? view.shipCountries : [org.country],
    methods,
    currency: org.currency,
    country: org.country,
    taxRates: org.taxRates,
    smallBusiness: org.smallBusiness,
    contactEmail: view.contactEmail ?? org.email,
    categoryIds: view.categoryIds,
    preview,
    company: {
      name: org.name,
      legalName: org.legalName,
      street: org.street,
      postalCode: org.postalCode,
      city: org.city,
      country: org.country,
      email: org.email,
      phone: org.phone,
      vatId: org.vatId,
      taxNumber: org.taxNumber,
      iban: org.iban,
      bic: org.bic,
      bankName: org.bankName,
    },
  };
}

// --- What is on offer ------------------------------------------------------------------------

export type ShopProduct = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  /** Gross, for one unit; with variants the lowest. */
  priceCents: number;
  fromPrice: boolean;
  vatRate: number;
  imageId: string | null;
  categoryId: string | null;
  available: boolean;
  createdAt: Date;
};

type StockRow = { trackStock: boolean; stockQuantity: string };

/** What is left to sell of a product or variant once open orders took theirs. */
function free(stock: string | number, held: number): number {
  return Math.max(0, Number(stock) - held);
}

const heldOf = (holdings: { productId: string; variantId: string | null; quantity: number }[], productId: string, variantId: string | null) =>
  holdings.filter((h) => h.productId === productId && (variantId === null ? h.variantId === null : h.variantId === variantId)).reduce((s, h) => s + h.quantity, 0);

async function firstImages(tx: Tx, productIds: string[]): Promise<Map<string, string>> {
  if (!productIds.length) return new Map();
  const rows = await tx
    .select({ productId: productImages.productId, documentId: productImages.documentId })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.productId), asc(productImages.position));
  const map = new Map<string, string>();
  for (const r of rows) if (!map.has(r.productId)) map.set(r.productId, r.documentId);
  return map;
}

export type CatalogQuery = { categoryId?: string | null; ids?: string[]; q?: string; limit?: number };

export async function storeProducts(store: PublicStore, query: CatalogQuery = {}): Promise<ShopProduct[]> {
  return withTenant(store.organizationId, async (tx) => {
    const filter = await visibleProductFilter(tx, store.categoryIds);
    const conditions = [filter];
    if (query.categoryId) {
      const all = await tx.select({ id: productCategories.id, parentId: productCategories.parentId }).from(productCategories);
      conditions.push(inArray(products.categoryId, [...withChildren(all, [query.categoryId])]));
    }
    if (query.ids) {
      if (!query.ids.length) return [];
      conditions.push(inArray(products.id, query.ids));
    }
    const q = query.q?.trim().slice(0, 100);
    if (q) conditions.push(sql`(${products.name} ilike ${`%${q.replace(/[%_\\]/g, "\\$&")}%`} or ${products.description} ilike ${`%${q.replace(/[%_\\]/g, "\\$&")}%`})`);
    const rows = await tx
      .select()
      .from(products)
      .where(and(...conditions))
      .orderBy(desc(products.createdAt))
      .limit(Math.min(query.limit ?? 60, 200));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const variants = await tx.select().from(productVariants).where(and(inArray(productVariants.productId, ids), eq(productVariants.active, true)));
    const holdings = await heldStock(tx, ids);
    const images = await firstImages(tx, ids);
    // Goods the supplier ships: what the supplier reported less what open supplier orders take; unknown counts as available.
    const supplierLeft = await dropshipAvailable(tx, rows.filter((r) => r.fulfillment === "DROPSHIP").map((r) => r.id));
    const list = rows.map((p): ShopProduct => {
      const own = variants.filter((v) => v.productId === p.id);
      const prices = own.length ? own.map((v) => v.priceCents ?? p.priceCents) : [p.priceCents];
      const available =
        p.fulfillment === "DROPSHIP"
          ? own.length
            ? own.some((v) => supplierLeft(p.id, v.id) !== 0)
            : supplierLeft(p.id, null) !== 0
          : !p.trackStock || (own.length ? own.some((v) => free(v.stockQuantity, heldOf(holdings, p.id, v.id)) > 0) : free(p.stockQuantity, heldOf(holdings, p.id, null)) > 0);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        unit: p.unit,
        priceCents: grossCents(Math.min(...prices), p.vatRate, store.smallBusiness),
        fromPrice: new Set(prices).size > 1,
        vatRate: p.vatRate,
        imageId: images.get(p.id) ?? null,
        categoryId: p.categoryId,
        available,
        createdAt: p.createdAt,
      };
    });
    // Chosen products keep the order they were chosen in.
    return query.ids ? query.ids.map((id) => list.find((p) => p.id === id)).filter((p): p is ShopProduct => !!p) : list;
  });
}

/** The categories that hold something to buy, with their parents for the path. */
export async function storeCategories(store: PublicStore): Promise<{ id: string; name: string; parentId: string | null; count: number }[]> {
  return withTenant(store.organizationId, async (tx) => {
    const filter = await visibleProductFilter(tx, store.categoryIds);
    const counts = await tx
      .select({ categoryId: products.categoryId, n: sql<number>`count(*)::int` })
      .from(products)
      .where(filter)
      .groupBy(products.categoryId);
    const all = await tx.select().from(productCategories).orderBy(asc(productCategories.position), asc(productCategories.name));
    const direct = new Map(counts.filter((c) => c.categoryId).map((c) => [c.categoryId!, Number(c.n)]));
    const total = (id: string): number => (direct.get(id) ?? 0) + all.filter((c) => c.parentId === id).reduce((s, c) => s + total(c.id), 0);
    return all.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId, count: total(c.id) })).filter((c) => c.count > 0);
  });
}

export type ShopVariant = { id: string; label: string; options: VariantChoice; priceCents: number; available: number | null };

export type ShopProductDetail = ShopProduct & {
  images: string[];
  options: VariantOption[];
  variants: ShopVariant[];
  /** Null: not counted (sold without a stock limit). */
  stock: number | null;
  attributes: Record<string, string>;
  shippingNote: string | null;
  returnable: boolean;
  returnDays: number | null;
};

export async function storeProduct(store: PublicStore, productId: string): Promise<ShopProductDetail | null> {
  if (!z.string().uuid().safeParse(productId).success) return null;
  const [base] = await storeProducts(store, { ids: [productId] });
  if (!base) return null;
  return withTenant(store.organizationId, async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, productId));
    const images = await tx.select({ id: productImages.documentId }).from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.position));
    const variantRows = await tx
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, productId), eq(productVariants.active, true)))
      .orderBy(asc(productVariants.position), asc(productVariants.createdAt));
    const holdings = await heldStock(tx, [productId]);
    const dropship = p.fulfillment === "DROPSHIP";
    const supplierLeft = await dropshipAvailable(tx, dropship ? [productId] : []);
    const options = (p.variantOptions ?? []) as VariantOption[];
    return {
      ...base,
      images: images.map((i) => i.id),
      options,
      variants: variantRows.map((v) => ({
        id: v.id,
        label: choiceLabel(v.options as VariantChoice, options),
        options: v.options as VariantChoice,
        priceCents: grossCents(v.priceCents ?? p.priceCents, p.vatRate, store.smallBusiness),
        available: dropship ? supplierLeft(p.id, v.id) : p.trackStock ? free(v.stockQuantity, heldOf(holdings, p.id, v.id)) : null,
      })),
      stock: variantRows.length ? null : dropship ? supplierLeft(p.id, null) : p.trackStock ? free(p.stockQuantity, heldOf(holdings, p.id, null)) : null,
      attributes: Object.fromEntries(Object.entries((p.attributes ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
      shippingNote: p.shippingNote,
      returnable: p.returnable,
      returnDays: p.returnDays,
    };
  });
}

// --- The cart ----------------------------------------------------------------------------------

const cartItems = z
  .array(
    z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid().nullish().transform((v) => v ?? null),
      quantity: z.coerce.number().int().min(1).max(MAX_QUANTITY),
    }),
  )
  .max(MAX_CART_LINES);
export type CartInput = z.input<typeof cartItems>;

export type PricedLine = {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  imageId: string | null;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  lineCents: number;
  /** null: not counted. */
  available: number | null;
  problem: "GONE" | "SHORT" | null;
};

export type PricedCart = {
  lines: PricedLine[];
  goodsCents: number;
  shipping: { option: ShippingOption; cents: number } | null;
  netCents: number;
  vatCents: number;
  grossCents: number;
  byRate: { rate: number; vatCents: number }[];
  /** The order's lines, priced from the records: what an order is made of. */
  orderLines: Line[];
  ok: boolean;
};

async function priceIn(tx: Tx, store: PublicStore, raw: CartInput, shippingId: string | null, lock = false): Promise<PricedCart> {
  const items = cartItems.parse(raw);
  // The same product twice adds up.
  const merged: { productId: string; variantId: string | null; quantity: number }[] = [];
  for (const item of items) {
    const same = merged.find((m) => m.productId === item.productId && m.variantId === item.variantId);
    if (same) same.quantity = Math.min(MAX_QUANTITY, same.quantity + item.quantity);
    else merged.push({ ...item });
  }
  const ids = [...new Set(merged.map((m) => m.productId))];
  const filter = await visibleProductFilter(tx, store.categoryIds);
  const query = tx.select().from(products).where(and(filter, ids.length ? inArray(products.id, ids) : sql`false`));
  // At checkout the products are locked: two buyers of the last piece cannot both get it.
  const productRows = lock ? await query.for("update") : await query;
  const variantRows = ids.length ? await tx.select().from(productVariants).where(and(inArray(productVariants.productId, ids), eq(productVariants.active, true))) : [];
  const holdings = await heldStock(tx, ids);
  const images = await firstImages(tx, ids);
  const supplierLeft = await dropshipAvailable(tx, productRows.filter((r) => r.fulfillment === "DROPSHIP").map((r) => r.id));

  const lines: PricedLine[] = [];
  const orderLines: Line[] = [];
  for (const item of merged) {
    const p = productRows.find((r) => r.id === item.productId);
    const own = variantRows.filter((v) => v.productId === item.productId);
    const variant = item.variantId ? own.find((v) => v.id === item.variantId) : null;
    // A product with variants is bought as one of them; a gone product or variant is named, not sold.
    if (!p || (item.variantId && !variant) || (!item.variantId && own.length)) {
      lines.push({ ...item, name: p?.name ?? "", variantLabel: null, imageId: null, unit: p?.unit ?? "", unitPriceCents: 0, lineCents: 0, available: 0, problem: "GONE" });
      continue;
    }
    const net = variant?.priceCents ?? p.priceCents;
    const stock: StockRow = { trackStock: p.trackStock, stockQuantity: variant ? variant.stockQuantity : p.stockQuantity };
    const available = p.fulfillment === "DROPSHIP" ? supplierLeft(p.id, variant?.id ?? null) : stock.trackStock ? free(stock.stockQuantity, heldOf(holdings, p.id, variant?.id ?? null)) : null;
    const label = variant ? choiceLabel(variant.options as VariantChoice, (p.variantOptions ?? []) as VariantOption[]) : null;
    const unitPrice = grossCents(net, p.vatRate, store.smallBusiness);
    lines.push({
      productId: p.id,
      variantId: variant?.id ?? null,
      name: p.name,
      variantLabel: label,
      imageId: images.get(p.id) ?? null,
      quantity: item.quantity,
      unit: p.unit,
      unitPriceCents: unitPrice,
      lineCents: unitPrice * item.quantity,
      available,
      problem: available !== null && available < item.quantity ? "SHORT" : null,
    });
    orderLines.push({
      productId: p.id,
      variantId: variant?.id ?? null,
      description: label ? `${p.name} / ${label}` : p.name,
      quantity: item.quantity,
      unit: p.unit,
      unitPriceCents: net,
      discountPercent: 0,
      vatRate: p.vatRate,
    });
  }

  const goods = totals(orderLines, store.smallBusiness);
  const goodsCents = goods.grossCents;
  const option = shippingId ? store.shipping.find((o) => o.id === shippingId) ?? null : store.shipping.length === 1 ? store.shipping[0] : null;
  let shipping: PricedCart["shipping"] = null;
  if (option && orderLines.length) {
    const cents = shippingCents(option, goodsCents);
    shipping = { option, cents };
    if (cents > 0) {
      // Shipping carries the company's standard rate.
      const [rate] = allowedRates(store.taxRates, store.country);
      const label = translator(MESSAGES[store.locale])("store.shop.shipping");
      orderLines.push({ productId: null, variantId: null, description: `${label}: ${option.name}`, quantity: 1, unit: "x", unitPriceCents: netOfGross(cents, rate, store.smallBusiness), discountPercent: 0, vatRate: rate });
    }
  }
  const sum = totals(orderLines, store.smallBusiness);
  return {
    lines,
    goodsCents,
    shipping,
    netCents: sum.netCents,
    vatCents: sum.vatCents,
    grossCents: sum.grossCents,
    byRate: sum.byRate.filter((r) => r.vatCents > 0).map((r) => ({ rate: r.rate, vatCents: r.vatCents })),
    orderLines,
    ok: lines.length > 0 && lines.every((l) => !l.problem) && !!shipping,
  };
}

/** The cart as it stands now: prices and stock from the records. */
export async function priceCart(store: PublicStore, items: CartInput, shippingId: string | null = null): Promise<PricedCart> {
  return withTenant(store.organizationId, (tx) => priceIn(tx, store, items, shippingId));
}

// --- Ordering ----------------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const required = (max: number) => z.string().trim().min(1).max(max);

const address = z.object({
  firstName: required(100),
  lastName: required(100),
  company: optionalText(160),
  street: required(160),
  postalCode: required(20),
  city: required(100),
  country: z.string().trim().toUpperCase().length(2),
});

export const checkoutInput = z.object({
  items: cartItems.min(1),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: optionalText(40),
  shipping: address,
  /** Null: billed to the shipping address. */
  billing: address.nullish().transform((v) => v ?? null),
  shippingId: z.string().min(1).max(64),
  payment: z.enum(["bank", "stripe"]),
  note: optionalText(1000),
  acceptTerms: z.literal(true),
});
export type CheckoutInput = z.input<typeof checkoutInput>;

export type Placed = { orderId: string; number: number; token: string; grossCents: number; payment: PaymentMethod };

/** Orders per visitor and store and hour, held in memory: a form must not become a flood of orders. */
const recent = new Map<string, number[]>();
function takeOrderSlot(key: string, perHour = 20): boolean {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= perHour) return false;
  list.push(now);
  recent.set(key, list);
  if (recent.size > 5000) for (const k of [...recent.keys()].slice(0, 1000)) recent.delete(k);
  return true;
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function event(tx: Tx, organizationId: string, orderId: string, kind: string, data: Record<string, unknown> = {}) {
  await tx.insert(orderEvents).values({ organizationId, orderId, kind, data, userId: null });
}

/** The buyer's order: a client (found by e-mail or new), the order with its goods reserved, and a link to follow it. */
export async function placeOrder(store: PublicStore, raw: CheckoutInput, visitor = "anonymous"): Promise<Placed> {
  if (store.preview || store.kind !== "store") throw new StorefrontError("CLOSED");
  const input = checkoutInput.parse(raw);
  if (!store.methods.includes(input.payment)) throw new StorefrontError("PAYMENT");
  if (!store.shipping.some((o) => o.id === input.shippingId)) throw new StorefrontError("SHIPPING");
  if (!store.shipCountries.includes(input.shipping.country)) throw new StorefrontError("COUNTRY");
  if (!takeOrderSlot(`${store.id}:${visitor}`)) throw new StorefrontError("BUSY");
  const ctx = await companyContext(store.organizationId);
  if (!ctx) throw new StorefrontError("CLOSED");
  const company = await companyOf(store.organizationId);

  const token = randomBytes(24).toString("base64url");
  const placed = await withTenant(store.organizationId, async (tx) => {
    const cart = await priceIn(tx, store, input.items, input.shippingId, true);
    if (!cart.lines.length) throw new StorefrontError("EMPTY");
    const gone = cart.lines.filter((l) => l.problem === "GONE");
    if (gone.length) throw new StorefrontError("GONE", gone.map((l) => ({ name: l.name, available: 0 })));
    const short = cart.lines.filter((l) => l.problem === "SHORT");
    if (short.length) throw new StorefrontError("SHORT", short.map((l) => ({ name: l.variantLabel ? `${l.name} / ${l.variantLabel}` : l.name, available: l.available ?? 0 })));
    if (!cart.shipping) throw new StorefrontError("SHIPPING");

    const bill = input.billing ?? input.shipping;
    const [existing] = await tx.select().from(clients).where(sql`lower(${clients.email}) = ${input.email}`).limit(1);
    let clientId = existing?.id;
    if (!clientId) {
      const number = await nextNumber(tx, store.organizationId, "client");
      const [client] = await tx
        .insert(clients)
        .values({
          organizationId: store.organizationId,
          number,
          type: bill.company ? "COMPANY" : "PERSON",
          status: "ACTIVE",
          companyName: bill.company,
          firstName: bill.firstName,
          lastName: bill.lastName,
          email: input.email,
          phone: input.phone,
          street: bill.street,
          postalCode: bill.postalCode,
          city: bill.city,
          country: bill.country,
          source: store.name.slice(0, 80),
          assignedUserId: ctx.user.userId,
        })
        .returning();
      clientId = client.id;
      await audit(tx, ctx, "client.create", "client", client.id, { number, store: store.slug }, "shop");
    }

    const number = await nextNumber(tx, store.organizationId, "order");
    const now = new Date();
    const [order] = await tx
      .insert(orders)
      .values({
        organizationId: store.organizationId,
        number,
        clientId,
        status: "CONFIRMED",
        title: store.name.slice(0, 200),
        notes: input.note,
        assignedUserId: ctx.user.userId,
        netCents: cart.netCents,
        vatCents: cart.vatCents,
        grossCents: cart.grossCents,
        channel: "SHOP",
        externalRef: `${store.slug}-${number}`,
        fulfillmentStatus: "RESERVED",
        paymentStatus: "UNPAID",
        shipName: [input.shipping.company, `${input.shipping.firstName} ${input.shipping.lastName}`].filter(Boolean).join(", "),
        shipStreet: input.shipping.street,
        shipPostalCode: input.shipping.postalCode,
        shipCity: input.shipping.city,
        shipCountry: input.shipping.country,
        confirmedAt: now,
        storeId: store.id,
        paymentMethod: input.payment,
        customerTokenHash: tokenHash(token),
      })
      .returning();
    await tx.insert(orderItems).values(lineRows(store.organizationId, cart.orderLines).map((l) => ({ ...l, orderId: order.id })));
    // Goods suppliers ship go to supplier orders; an order of only such goods waits with the suppliers.
    const plan = await planDropship(tx, order.id);
    if (plan.groups.length || plan.missing.length) await createSupplierOrders(tx, { organizationId: store.organizationId, userId: null, ctx, via: "shop" }, company, order.id, plan);
    if (plan.groups.length && !plan.ownGoods && !plan.missing.length) await tx.update(orders).set({ fulfillmentStatus: "AT_SUPPLIER" }).where(eq(orders.id, order.id));
    await tx.update(clients).set({ lastInteractionAt: now }).where(eq(clients.id, clientId));
    await event(tx, store.organizationId, order.id, "checkout", { store: store.name, payment: input.payment, shipping: cart.shipping.option.name });
    await event(tx, store.organizationId, order.id, "confirm");
    await audit(tx, ctx, "order.create", "order", order.id, { number, gross: cart.grossCents, store: store.slug }, "shop");
    return { orderId: order.id, number, token, grossCents: cart.grossCents, payment: input.payment as PaymentMethod, lines: cart.lines, shipping: cart.shipping };
  });

  const { fireAutomations } = await import("./automations");
  await fireAutomations(ctx, "order.created", placed.orderId).catch((e) => console.error("shop: automations failed", e instanceof Error ? e.message : e));
  const money = (c: number) => formatMoney(c, "de", { country: store.country, currency: store.currency });
  await notify(store.organizationId, await companyLeads(store.organizationId), {
    category: "update",
    kind: "shopOrder",
    vars: { number: placed.number, amount: money(placed.grossCents), store: store.name },
    href: `/app/orders/${placed.orderId}`,
    entity: "order",
    entityId: placed.orderId,
    dedupeKey: `shop-order:${placed.orderId}`,
  }).catch((e) => console.error("shop: notify failed", e instanceof Error ? e.message : e));
  await mailBuyer(store, input.email, "placed", placed).catch((e) => console.error("shop: mail failed", e instanceof Error ? e.message : e));
  await followUp(store.organizationId, { orderId: placed.orderId }).catch((e) => console.error("shop: supplier orders failed", e instanceof Error ? e.message : e));
  return { orderId: placed.orderId, number: placed.number, token: placed.token, grossCents: placed.grossCents, payment: placed.payment };
}

/** Where the buyer follows the order (the token is the only key, so the link is shown and mailed once). */
export function orderLink(store: Pick<PublicStore, "slug">, token: string): string {
  return `${appUrl() ?? ""}/shop/${store.slug}/order/${token}`;
}

/** Mails to the buyer, in the store's language; nothing when the server sends no mail. */
export async function mailBuyer(
  store: PublicStore,
  to: string,
  kind: "placed" | "paid" | "shipped",
  order: { number: number; token?: string; grossCents: number; payment?: PaymentMethod; carrier?: string | null; trackingNumber?: string | null },
): Promise<void> {
  if (!mailAvailable() || !takeMailBudget(store.organizationId)) return;
  const t = translator(MESSAGES[store.locale]);
  const money = formatMoney(order.grossCents, store.locale, { country: store.country, currency: store.currency });
  const lines = [
    t(`store.mail.${kind}Body`, { number: order.number, store: store.name, amount: money }),
    ...(kind === "placed" && order.payment === "bank" && store.company.iban
      ? ["", t("store.shop.bankTransfer"), `${t("store.shop.iban")}: ${store.company.iban}`, ...(store.company.bic ? [`BIC: ${store.company.bic}`] : []), `${t("store.shop.reference")}: ${store.slug}-${order.number}`, `${t("store.shop.amount")}: ${money}`]
      : []),
    ...(kind === "shipped" && (order.carrier || order.trackingNumber) ? ["", `${t("store.mail.tracking")}: ${[order.carrier, order.trackingNumber].filter(Boolean).join(" ")}`] : []),
    ...(order.token ? ["", orderLink(store, order.token)] : []),
    "",
    store.company.legalName ?? store.company.name,
  ];
  await sendMail({ to, subject: t(`store.mail.${kind}Subject`, { number: order.number, store: store.name }), text: lines.join("\n"), replyTo: store.contactEmail ?? undefined });
}

export type BuyerOrder = {
  id: string;
  number: number;
  createdAt: Date;
  fulfillment: string;
  payment: string;
  method: string | null;
  grossCents: number;
  vatCents: number;
  lines: { description: string; quantity: number; unit: string }[];
  shipTo: string[];
  carrier: string | null;
  trackingNumber: string | null;
  reference: string;
};

export async function orderForBuyer(store: PublicStore, token: string): Promise<BuyerOrder | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return withTenant(store.organizationId, async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.customerTokenHash, tokenHash(token)), eq(orders.storeId, store.id)))
      .limit(1);
    if (!order) return null;
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.position));
    return {
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      fulfillment: order.fulfillmentStatus,
      payment: order.paymentStatus,
      method: order.paymentMethod,
      grossCents: order.grossCents,
      vatCents: order.vatCents,
      lines: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit: i.unit })),
      shipTo: [order.shipName, order.shipStreet, [order.shipPostalCode, order.shipCity].filter(Boolean).join(" "), order.shipCountry].filter((v): v is string => !!v),
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      reference: order.externalRef ?? String(order.number),
    };
  });
}

// --- Pictures ----------------------------------------------------------------------------------

/** A picture the site shows: its logo, a picture in one of its sections or a picture of a product it offers. Nothing else of the company's files. */
export async function storeImage(store: PublicStore, documentId: string): Promise<{ file: string; size: number; mime: string } | null> {
  if (!z.string().uuid().safeParse(documentId).success) return null;
  return withTenant(store.organizationId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!doc || !/^image\/(png|jpeg|webp|gif)$/.test(doc.mimeType)) return null;
    let shown =
      store.design.logoId === documentId ||
      sectionImages([...store.blocks, ...store.customPages.flatMap((p) => p.sections)]).includes(documentId);
    if (!shown && store.kind === "store") {
      const filter = await visibleProductFilter(tx, store.categoryIds);
      const [hit] = await tx
        .select({ id: productImages.id })
        .from(productImages)
        .innerJoin(products, eq(products.id, productImages.productId))
        .where(and(eq(productImages.documentId, documentId), filter))
        .limit(1);
      shown = !!hit;
    }
    if (!shown) return null;
    const file = path.resolve(uploadDir(), doc.storageKey);
    if (!file.startsWith(path.resolve(uploadDir()) + path.sep)) return null;
    const info = await stat(file).catch(() => null);
    return info ? { file, size: info.size, mime: doc.mimeType } : null;
  });
}
