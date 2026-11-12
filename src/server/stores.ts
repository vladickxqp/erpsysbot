/**
 * A company's online stores, as the app manages them: name and address,
 * design, the home page's blocks, the store's pages, shipping, payment and
 * publication. Editing needs products.manage; payment keys and going online
 * need settings.manage. A store is published only when every check passes —
 * which says the required parts are filled in, not that they are legally sound.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import { z } from "zod";
import { getDb } from "@/db/client";
import { documents, organizations, productCategories, products, stores } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { isLocale } from "@/i18n";
import {
  BLOCK_TYPES,
  CHECKS,
  DEFAULT_DESIGN,
  EMPTY_PAGES,
  HEX,
  MAX_BLOCKS,
  REQUIRED_LEGAL,
  TEMPLATES,
  slugify,
  starterBlocks,
  validSlug,
  type Block,
  type Check,
  type Design,
  type Pages,
  type Payments,
  type ShippingOption,
  type StoreStatus,
} from "@/lib/store";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { assertModule } from "./modules";
import { requirePermission } from "./permissions";
import { hint, seal, unseal } from "./secret-box";

export class StoreError extends Error {
  constructor(
    public readonly code: "SLUG_INVALID" | "SLUG_TAKEN" | "CHECKS" | "STRIPE_KEY" | "STRIPE_WEBHOOK" | "PUBLISHED" | "MEDIA",
    public readonly failed: Check[] = [],
  ) {
    super(code);
  }
}

export type StoreRow = typeof stores.$inferSelect;

/** A store as the app shows it: everything but the secrets, which only say whether they are set. */
export type StoreView = Omit<StoreRow, "stripeSecretKey" | "stripeWebhookSecret" | "design" | "blocks" | "pages" | "shipping" | "payments"> & {
  design: Design;
  blocks: Block[];
  pages: Pages;
  shipping: ShippingOption[];
  payments: Payments;
  stripe: { key: boolean; webhook: boolean; hint: string | null };
};

export function viewOf(row: StoreRow): StoreView {
  const { stripeSecretKey, stripeWebhookSecret, ...rest } = row;
  return {
    ...rest,
    design: { ...DEFAULT_DESIGN, ...((row.design ?? {}) as Partial<Design>) },
    blocks: (row.blocks ?? []) as Block[],
    pages: { ...EMPTY_PAGES, ...((row.pages ?? {}) as Partial<Pages>) },
    shipping: (row.shipping ?? []) as ShippingOption[],
    payments: { bank: false, stripe: false, ...((row.payments ?? {}) as Partial<Payments>) },
    stripe: { key: !!stripeSecretKey, webhook: !!stripeWebhookSecret, hint: row.stripeKeyHint },
  };
}

const isUnique = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string; cause?: unknown } | null;
  if (!err) return false;
  return err.code === "23505" || /duplicate key|unique constraint/i.test(String(err.message ?? "")) || (err.cause !== undefined && err.cause !== e && isUnique(err.cause));
};

async function storeOf(tx: Tx, id: string): Promise<StoreRow> {
  const [row] = await tx.select().from(stores).where(eq(stores.id, id)).limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

/** The right, and the module switched on: a store of a company without it stays closed in every action. */
function allow(ctx: Context, permission: "products.manage" | "settings.manage") {
  requirePermission(ctx.permissions, permission);
  assertModule(ctx, "store");
}

function canSee(ctx: Context) {
  allow(ctx, ctx.permissions.has("products.manage") ? "products.manage" : "settings.manage");
}

export async function listStores(ctx: Context): Promise<StoreView[]> {
  canSee(ctx);
  const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(stores).orderBy(asc(stores.createdAt)));
  return rows.map(viewOf);
}

export async function getStore(ctx: Context, id: string): Promise<StoreView> {
  canSee(ctx);
  return viewOf(await withTenant(ctx.organization.id, (tx) => storeOf(tx, id)));
}

/** The slug is free across all companies (stores live at one address each). */
async function slugFree(slug: string, except?: string): Promise<boolean> {
  const [row] = await getDb().select({ id: stores.id }).from(stores).where(eq(stores.slug, slug)).limit(1);
  return !row || row.id === except;
}

export async function suggestSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const candidate = i ? `${base.slice(0, 36)}-${i + 1}` : base;
    if (validSlug(candidate) && (await slugFree(candidate))) return candidate;
  }
  return `${base.slice(0, 31)}-${randomUUID().slice(0, 8)}`;
}

const name = z.string().trim().min(1).max(120);

export async function createStore(ctx: Context, raw: { name: string }): Promise<StoreView> {
  allow(ctx, "products.manage");
  const storeName = name.parse(raw.name);
  const slug = await suggestSlug(storeName);
  try {
    const row = await withTenant(ctx.organization.id, async (tx) => {
      const [created] = await tx
        .insert(stores)
        .values({
          organizationId: ctx.organization.id,
          name: storeName,
          slug,
          locale: isLocale(ctx.organization.locale) ? ctx.organization.locale : "de",
          design: DEFAULT_DESIGN,
          blocks: starterBlocks(storeName, randomUUID),
          pages: EMPTY_PAGES,
          shipping: [],
          payments: { bank: false, stripe: false },
          contactEmail: ctx.organization.email,
        })
        .returning();
      await audit(tx, ctx, "store.create", "store", created.id, { slug });
      return created;
    });
    return viewOf(row);
  } catch (e) {
    if (isUnique(e)) throw new StoreError("SLUG_TAKEN");
    throw e;
  }
}

const basicsInput = z.object({
  name,
  slug: z.string().trim().toLowerCase(),
  locale: z.string().refine(isLocale),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "email"),
  categoryIds: z.array(z.string().uuid()).max(200).default([]),
  /** Countries it ships to (ISO codes); empty: the company's own. */
  shipCountries: z
    .array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/))
    .max(60)
    .default([])
    .transform((list) => [...new Set(list)]),
});
export type BasicsInput = z.input<typeof basicsInput>;

export async function saveBasics(ctx: Context, id: string, raw: BasicsInput): Promise<void> {
  allow(ctx, "products.manage");
  const input = basicsInput.parse(raw);
  if (!validSlug(input.slug)) throw new StoreError("SLUG_INVALID");
  if (!(await slugFree(input.slug, id))) throw new StoreError("SLUG_TAKEN");
  try {
    await withTenant(ctx.organization.id, async (tx) => {
      await storeOf(tx, id);
      const categoryIds = input.categoryIds.length
        ? (await tx.select({ id: productCategories.id }).from(productCategories).where(inArray(productCategories.id, input.categoryIds))).map((c) => c.id)
        : [];
      await tx
        .update(stores)
        .set({ name: input.name, slug: input.slug, locale: input.locale, contactEmail: input.contactEmail, categoryIds, shipCountries: input.shipCountries, updatedAt: new Date() })
        .where(eq(stores.id, id));
      await audit(tx, ctx, "store.update", "store", id, { slug: input.slug });
    });
  } catch (e) {
    if (isUnique(e)) throw new StoreError("SLUG_TAKEN");
    throw e;
  }
}

/** Pictures a store uses must be the company's own images. */
async function assertImages(tx: Tx, ids: (string | null | undefined)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return;
  const found = await tx.select({ id: documents.id, mime: documents.mimeType }).from(documents).where(inArray(documents.id, wanted));
  if (found.length !== wanted.length || found.some((d) => !/^image\/(png|jpeg|webp|gif)$/.test(d.mime))) throw new StoreError("MEDIA");
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v ?? "");

const designInput = z.object({
  template: z.enum(TEMPLATES),
  primary: z.string().regex(HEX),
  accent: z.string().regex(HEX),
  logoId: z.string().uuid().nullish().transform((v) => v ?? null),
  tagline: text(160),
});

export async function saveDesign(ctx: Context, id: string, raw: z.input<typeof designInput>): Promise<void> {
  allow(ctx, "products.manage");
  const design = designInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    await storeOf(tx, id);
    await assertImages(tx, [design.logoId]);
    await tx.update(stores).set({ design, updatedAt: new Date() }).where(eq(stores.id, id));
    await audit(tx, ctx, "store.design", "store", id);
  });
}

const blockInput = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(BLOCK_TYPES),
  title: text(160),
  text: text(4000),
  imageId: z.string().uuid().nullish().transform((v) => v ?? null),
  productIds: z.array(z.string().uuid()).max(24).default([]),
  categoryId: z.string().uuid().nullish().transform((v) => v ?? null),
  limit: z.coerce.number().int().min(1).max(24).default(8),
  buttonLabel: text(40),
});

export async function saveBlocks(ctx: Context, id: string, raw: unknown[]): Promise<void> {
  allow(ctx, "products.manage");
  const blocks = z.array(blockInput).max(MAX_BLOCKS).parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    await storeOf(tx, id);
    await assertImages(tx, blocks.map((b) => b.imageId));
    const productIds = [...new Set(blocks.flatMap((b) => b.productIds))];
    const known = productIds.length ? new Set((await tx.select({ id: products.id }).from(products).where(inArray(products.id, productIds))).map((p) => p.id)) : new Set<string>();
    const categoryIds = [...new Set(blocks.map((b) => b.categoryId).filter((v): v is string => !!v))];
    const cats = categoryIds.length ? new Set((await tx.select({ id: productCategories.id }).from(productCategories).where(inArray(productCategories.id, categoryIds))).map((c) => c.id)) : new Set<string>();
    // What is not the company's own is dropped, not trusted.
    const clean: Block[] = blocks.map((b) => ({ ...b, productIds: b.productIds.filter((p) => known.has(p)), categoryId: b.categoryId && cats.has(b.categoryId) ? b.categoryId : null }));
    await tx.update(stores).set({ blocks: clean, updatedAt: new Date() }).where(eq(stores.id, id));
    await audit(tx, ctx, "store.blocks", "store", id, { blocks: clean.length });
  });
}

const pageText = text(30000);
const pagesInput = z.object({
  about: pageText,
  contact: pageText,
  imprint: pageText,
  privacy: pageText,
  terms: pageText,
  withdrawal: pageText,
  shipping: pageText,
});

export async function savePages(ctx: Context, id: string, raw: Partial<Pages>): Promise<void> {
  allow(ctx, "products.manage");
  const pages: Pages = pagesInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    await storeOf(tx, id);
    await tx.update(stores).set({ pages, updatedAt: new Date() }).where(eq(stores.id, id));
    await audit(tx, ctx, "store.pages", "store", id);
  });
}

const shippingInput = z
  .array(
    z.object({
      id: z.string().min(1).max(64).optional(),
      name: z.string().trim().min(1).max(80),
      priceCents: z.coerce.number().int().min(0).max(1_000_000),
      freeFromCents: z.coerce.number().int().min(0).max(100_000_000).nullish().transform((v) => v ?? null),
    }),
  )
  .max(10);

export async function saveShippingOptions(ctx: Context, id: string, raw: z.input<typeof shippingInput>): Promise<void> {
  allow(ctx, "products.manage");
  const options: ShippingOption[] = shippingInput.parse(raw).map((o) => ({ ...o, id: o.id ?? randomUUID() }));
  await withTenant(ctx.organization.id, async (tx) => {
    await storeOf(tx, id);
    await tx.update(stores).set({ shipping: options, updatedAt: new Date() }).where(eq(stores.id, id));
    await audit(tx, ctx, "store.shipping", "store", id, { options: options.length });
  });
}

/** Asks Stripe whether the key works for payments; tests put their own answer here. */
export type KeyCheck = (secretKey: string) => Promise<boolean>;
const stripeKeyWorks: KeyCheck = async (secretKey) => {
  try {
    await new Stripe(secretKey).checkout.sessions.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
};

const paymentsInput = z.object({
  bank: z.boolean(),
  stripe: z.boolean(),
  /** Only when a new key is given; empty keeps the stored one. */
  secretKey: z.string().trim().max(300).optional(),
  webhookSecret: z.string().trim().max(300).optional(),
  removeStripe: z.boolean().optional(),
});

export async function savePayments(ctx: Context, id: string, raw: z.input<typeof paymentsInput>, check: KeyCheck = stripeKeyWorks): Promise<void> {
  allow(ctx, "settings.manage");
  const input = paymentsInput.parse(raw);
  const patch: Partial<typeof stores.$inferInsert> = { updatedAt: new Date() };
  if (input.removeStripe) Object.assign(patch, { stripeSecretKey: null, stripeWebhookSecret: null, stripeKeyHint: null });
  if (input.secretKey) {
    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(input.secretKey) || !(await check(input.secretKey))) throw new StoreError("STRIPE_KEY");
    Object.assign(patch, { stripeSecretKey: seal(input.secretKey), stripeKeyHint: hint(input.secretKey) });
  }
  if (input.webhookSecret) {
    if (!/^whsec_[A-Za-z0-9+/=]{10,}$/.test(input.webhookSecret)) throw new StoreError("STRIPE_WEBHOOK");
    patch.stripeWebhookSecret = seal(input.webhookSecret);
  }
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    const keySet = input.removeStripe ? false : !!(patch.stripeSecretKey ?? row.stripeSecretKey);
    const hookSet = input.removeStripe ? false : !!(patch.stripeWebhookSecret ?? row.stripeWebhookSecret);
    // Card payment is offered only with both: the key to start a payment and the secret to believe its result.
    const payments: Payments = { bank: input.bank, stripe: input.stripe && keySet && hookSet };
    patch.payments = payments;
    await tx.update(stores).set(patch).where(eq(stores.id, id));
    // Never the keys, only what changed.
    await audit(tx, ctx, "store.payments", "store", id, { bank: payments.bank, stripe: payments.stripe, newKey: !!input.secretKey, newWebhook: !!input.webhookSecret, removed: !!input.removeStripe });
  });
}

/** The store's own secrets, for the payment code only. */
export function storeSecrets(row: Pick<StoreRow, "stripeSecretKey" | "stripeWebhookSecret">): { secretKey: string | null; webhookSecret: string | null } {
  return { secretKey: unseal(row.stripeSecretKey), webhookSecret: unseal(row.stripeWebhookSecret) };
}

/** Category ids with all their sub-categories. */
export function withChildren(all: { id: string; parentId: string | null }[], roots: readonly string[]): Set<string> {
  const result = new Set(roots);
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of all) {
      if (c.parentId && result.has(c.parentId) && !result.has(c.id)) {
        result.add(c.id);
        changed = true;
      }
    }
  }
  return result;
}

/** What the store offers: active products with a price, in its categories (or all). */
export async function visibleProductFilter(tx: Tx, categoryIds: readonly string[]) {
  const base = and(eq(products.active, true), gt(products.priceCents, 0));
  if (!categoryIds.length) return base;
  const all = await tx.select({ id: productCategories.id, parentId: productCategories.parentId }).from(productCategories);
  const ids = [...withChildren(all, categoryIds)];
  return and(base, ids.length ? inArray(products.categoryId, ids) : sql`false`);
}

export type Checklist = { passed: Record<Check, boolean>; missingPages: string[]; ready: boolean };

export async function checklist(ctx: Context, id: string): Promise<Checklist> {
  canSee(ctx);
  const org = await companyOf(ctx.organization.id);
  return withTenant(ctx.organization.id, async (tx) => checksOf(tx, await storeOf(tx, id), org));
}

/** The company itself is not readable to its tenant role: read it before the transaction, as the owner. */
async function companyOf(organizationId: string) {
  const [org] = await getDb().select().from(organizations).where(eq(organizations.id, organizationId));
  return org;
}

async function checksOf(tx: Tx, row: StoreRow, org: Awaited<ReturnType<typeof companyOf>> | undefined): Promise<Checklist> {
  const store = viewOf(row);
  const filter = await visibleProductFilter(tx, row.categoryIds);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(products).where(filter);
  const missingPages = REQUIRED_LEGAL.filter((p) => !store.pages[p].trim());
  const passed: Record<Check, boolean> = {
    name: !!store.name.trim() && validSlug(store.slug),
    products: Number(n) > 0,
    payment: (store.payments.bank && !!org?.iban) || (store.payments.stripe && store.stripe.key && store.stripe.webhook),
    shipping: store.shipping.length > 0,
    address: !!(org?.street && org.postalCode && org.city && (store.contactEmail || org.email)),
    legal: missingPages.length === 0,
  };
  return { passed, missingPages, ready: CHECKS.every((c) => passed[c]) };
}

export async function setStoreStatus(ctx: Context, id: string, status: Exclude<StoreStatus, "DRAFT">): Promise<void> {
  allow(ctx, "settings.manage");
  const org = status === "PUBLISHED" ? await companyOf(ctx.organization.id) : undefined;
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    if (status === "PUBLISHED") {
      const checks = await checksOf(tx, row, org);
      if (!checks.ready) throw new StoreError("CHECKS", CHECKS.filter((c) => !checks.passed[c]));
    }
    await tx
      .update(stores)
      .set({ status, updatedAt: new Date(), ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}) })
      .where(eq(stores.id, id));
    await audit(tx, ctx, status === "PUBLISHED" ? "store.publish" : "store.unpublish", "store", id);
  });
}

export async function deleteStore(ctx: Context, id: string): Promise<void> {
  allow(ctx, "settings.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    if (row.status === "PUBLISHED") throw new StoreError("PUBLISHED");
    await tx.delete(stores).where(eq(stores.id, id));
    await audit(tx, ctx, "store.delete", "store", id, { slug: row.slug });
  });
}

/** Products to choose for a product row on the home page. */
export async function productChoices(ctx: Context): Promise<{ id: string; name: string }[]> {
  allow(ctx, "products.manage");
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.active, true), gt(products.priceCents, 0)))
      .orderBy(asc(products.name))
      .limit(500),
  );
}

/** Images of the company, to choose a logo or a block's picture from. */
export async function storeImages(ctx: Context) {
  allow(ctx, "products.manage");
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(inArray(documents.mimeType, ["image/png", "image/jpeg", "image/webp", "image/gif"]))
      .orderBy(sql`${documents.createdAt} desc`)
      .limit(200),
  );
}
