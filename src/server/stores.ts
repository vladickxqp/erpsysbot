/**
 * A company's websites, as the app manages them: online stores (Commerce)
 * and the creator's and company websites built the same way
 * (src/lib/site.ts) — name and address, theme, the sections of the home page
 * and of its own pages, the legal pages, and for a store shipping and
 * payment. Editing a store needs products.manage, a website sites.manage;
 * payment keys and going online need settings.manage. A site is published
 * only when every check of its kind passes — which says the required parts
 * are filled in, not that they are legally sound.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import { z } from "zod";
import { getDb } from "@/db/client";
import { documents, organizations, productCategories, products, stores } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { isLocale, MESSAGES, translator } from "@/i18n";
import {
  ALIGNS,
  ANCHOR,
  ANIMATIONS,
  BACKGROUNDS,
  BUTTON_STYLES,
  CHECKS_OF,
  CONTAINERS,
  embedOf,
  FEATURE_ICONS,
  FONT_PAIRS,
  HEADER_STYLES,
  HEADING_WEIGHTS,
  HOVERS,
  isSiteKind,
  MAX_DELAY,
  MAX_ITEMS,
  MAX_PAGES,
  MAX_SECTIONS,
  PLACEHOLDER,
  PRESET_NAMES,
  presetTheme,
  RADII,
  REQUIRED_LEGAL_OF,
  safeLink,
  SECTION_TYPES,
  sectionImages,
  sectionTexts,
  SHAPES,
  siteModule,
  slugifyPage,
  SPACINGS,
  SPEEDS,
  STARTER_PRESET,
  starterSections,
  STORE_ONLY,
  themeOf,
  TITLE_SIZES,
  TONES,
  validPageSlug,
  VARIANTS,
  WIDTHS,
  type Section,
  type SectionStyle,
  type SiteKind,
  type SitePage,
  type Theme,
} from "@/lib/site";
import { DEFAULT_DESIGN, EMPTY_PAGES, HEX, slugify, validSlug, type Check, type Design, type Pages, type Payments, type ShippingOption, type StoreStatus } from "@/lib/store";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { assertModule } from "./modules";
import { requirePermission, type Permission } from "./permissions";
import { hint, seal, unseal } from "./secret-box";

export class StoreError extends Error {
  constructor(
    public readonly code: "SLUG_INVALID" | "SLUG_TAKEN" | "CHECKS" | "STRIPE_KEY" | "STRIPE_WEBHOOK" | "PUBLISHED" | "MEDIA" | "KIND" | "PAGE_SLUG",
    public readonly failed: Check[] = [],
  ) {
    super(code);
  }
}

export type StoreRow = typeof stores.$inferSelect;

/** A site as the app shows it: everything but the secrets, which only say whether they are set. */
export type StoreView = Omit<StoreRow, "stripeSecretKey" | "stripeWebhookSecret" | "live" | "kind" | "design" | "blocks" | "customPages" | "pages" | "shipping" | "payments"> & {
  kind: SiteKind;
  /** Published, with edits visitors do not see yet. */
  changed: boolean;
  design: Design;
  theme: Theme;
  blocks: Section[];
  customPages: SitePage[];
  pages: Pages;
  shipping: ShippingOption[];
  payments: Payments;
  stripe: { key: boolean; webhook: boolean; hint: string | null };
};

const kindOfRow = (row: { kind: string }): SiteKind => (isSiteKind(row.kind) ? row.kind : "store");

/** The parts of a site visitors see, as they are now: what publishing copies to `live`. */
export const contentOf = (row: Pick<StoreRow, "design" | "blocks" | "customPages" | "pages">) => ({ design: row.design, blocks: row.blocks, customPages: row.customPages, pages: row.pages });

/** Whether a site differs from what visitors see; jsonb keeps keys in its own order, so each part is compared. */
function differs(row: StoreRow, live: unknown): boolean {
  const now: Record<string, unknown> = contentOf(row);
  const was = (live ?? {}) as Record<string, unknown>;
  return Object.keys(now).some((k) => JSON.stringify(now[k]) !== JSON.stringify(was[k]));
}

export function viewOf(row: StoreRow): StoreView {
  const { stripeSecretKey, stripeWebhookSecret, live, ...rest } = row;
  return {
    ...rest,
    kind: kindOfRow(row),
    changed: row.status === "PUBLISHED" && !!live && differs(row, live),
    design: { ...DEFAULT_DESIGN, ...((row.design ?? {}) as Partial<Design>) },
    theme: themeOf(row.design),
    blocks: (row.blocks ?? []) as Section[],
    customPages: (row.customPages ?? []) as SitePage[],
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

/** The right to edit a kind of site: products.manage for a store, sites.manage for a website. */
export const editRight = (kind: SiteKind): Permission => (kind === "store" ? "products.manage" : "sites.manage");

/** The right, and the kind's module switched on: a site of a company without it stays closed in every action. */
function allow(ctx: Context, kind: SiteKind, permission: "edit" | "settings.manage" = "edit") {
  requirePermission(ctx.permissions, permission === "edit" ? editRight(kind) : permission);
  assertModule(ctx, siteModule(kind));
}

function canSee(ctx: Context, kind: SiteKind) {
  allow(ctx, kind, ctx.permissions.has(editRight(kind)) ? "edit" : "settings.manage");
}

/** The kind of one of the company's sites, for the right and the module it needs. */
async function kindOf(ctx: Context, id: string): Promise<SiteKind> {
  const [row] = await withTenant(ctx.organization.id, (tx) => tx.select({ kind: stores.kind }).from(stores).where(eq(stores.id, id)).limit(1));
  if (!row) throw new NotFoundError();
  return kindOfRow(row);
}

/** The company's stores (Commerce) or its websites. */
export async function listStores(ctx: Context, scope: "store" | "sites" = "store"): Promise<StoreView[]> {
  canSee(ctx, scope === "store" ? "store" : "company");
  const kinds: SiteKind[] = scope === "store" ? ["store"] : ["creator", "company"];
  const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(stores).where(inArray(stores.kind, kinds)).orderBy(asc(stores.createdAt)));
  return rows.map(viewOf);
}

export async function getStore(ctx: Context, id: string): Promise<StoreView> {
  canSee(ctx, await kindOf(ctx, id));
  return viewOf(await withTenant(ctx.organization.id, (tx) => storeOf(tx, id)));
}

/** What the AI needs to know of a site it helps to build; only for those who may edit it. */
export async function siteBasics(ctx: Context, id: string): Promise<{ kind: SiteKind; locale: string; name: string }> {
  const kind = await kindOf(ctx, id);
  allow(ctx, kind);
  const row = await withTenant(ctx.organization.id, (tx) => storeOf(tx, id));
  return { kind, locale: row.locale, name: row.name };
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

export async function createStore(ctx: Context, raw: { name: string; kind?: SiteKind }): Promise<StoreView> {
  const kind = raw.kind ?? "store";
  if (!isSiteKind(kind)) throw new StoreError("KIND");
  allow(ctx, kind);
  const storeName = name.parse(raw.name);
  const slug = await suggestSlug(storeName);
  const locale = isLocale(ctx.organization.locale) ? ctx.organization.locale : "de";
  try {
    const row = await withTenant(ctx.organization.id, async (tx) => {
      const [created] = await tx
        .insert(stores)
        .values({
          organizationId: ctx.organization.id,
          kind,
          name: storeName,
          slug,
          locale,
          design: { ...DEFAULT_DESIGN, ...themeOf({ preset: STARTER_PRESET[kind], ...presetTheme(STARTER_PRESET[kind]) }) },
          blocks: starterSections(kind, storeName, randomUUID, translator(MESSAGES[locale])),
          customPages: [],
          pages: EMPTY_PAGES,
          shipping: [],
          payments: { bank: false, stripe: false },
          contactEmail: ctx.organization.email,
        })
        .returning();
      await audit(tx, ctx, "store.create", "store", created.id, { slug, kind });
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
  allow(ctx, await kindOf(ctx, id));
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

const themeInput = z.object({
  preset: z.string().refine((p) => PRESET_NAMES.includes(p)),
  mode: z.enum(["light", "dark"]),
  font: z.enum(FONT_PAIRS),
  radius: z.enum(RADII),
  /** The old switch: false is the same as the animation "none". */
  animate: z.boolean().optional(),
  animation: z.enum(ANIMATIONS).optional(),
  speed: z.enum(SPEEDS).optional(),
  buttons: z.enum(BUTTON_STYLES).optional(),
  headingWeight: z.enum(HEADING_WEIGHTS).optional(),
  uppercase: z.boolean().optional(),
  header: z.enum(HEADER_STYLES).optional(),
  hover: z.enum(HOVERS).optional(),
  container: z.enum(CONTAINERS).optional(),
  primary: z.string().regex(HEX),
  accent: z.string().regex(HEX),
  logoId: z.string().uuid().nullish().transform((v) => v ?? null),
  tagline: text(160),
});
export type ThemeInput = z.input<typeof themeInput>;

/** The look: a preset with the company's colours, fonts and corners, its details, its logo and tagline; details not sent stay as they were. */
export async function saveTheme(ctx: Context, id: string, raw: ThemeInput): Promise<void> {
  allow(ctx, await kindOf(ctx, id));
  const { animate, ...input } = themeInput.parse(raw);
  const sent = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    await assertImages(tx, [input.logoId]);
    const before = themeOf(row.design).animation;
    const animation = input.animation ?? (animate === false ? "none" : animate === true && before === "none" ? "up" : before);
    await tx
      .update(stores)
      .set({ design: { ...((row.design ?? {}) as object), ...sent, animation, animate: animation !== "none" }, updatedAt: new Date() })
      .where(eq(stores.id, id));
    await audit(tx, ctx, "store.theme", "store", id, { preset: input.preset });
  });
}

const optionalId = z.string().uuid().nullish().transform((v) => v ?? null);
/** Only links a visitor may follow are kept (src/lib/site.ts safeLink). */
const link = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => safeLink(v) ?? "");

const itemInput = z.object({
  id: z.string().min(1).max(64),
  title: text(160),
  text: text(1200),
  value: text(60),
  label: text(120),
  imageId: optionalId,
  link,
  icon: z.enum(FEATURE_ICONS).optional().catch(undefined),
  highlight: z.boolean().optional().default(false),
});

/** Each part of a section's own look is checked by itself: what is not known or out of bounds is dropped, never trusted. */
const styleInput = z
  .object({
    animation: z.enum(ANIMATIONS).optional().catch(undefined),
    speed: z.enum(SPEEDS).optional().catch(undefined),
    delay: z.number().int().min(0).max(MAX_DELAY).optional().catch(undefined),
    stagger: z.boolean().optional().catch(undefined),
    paddingTop: z.enum(SPACINGS).optional().catch(undefined),
    paddingBottom: z.enum(SPACINGS).optional().catch(undefined),
    width: z.enum(WIDTHS).optional().catch(undefined),
    align: z.enum(ALIGNS).optional().catch(undefined),
    columns: z.number().int().min(1).max(4).optional().catch(undefined),
    bgColor: z.string().regex(HEX).optional().catch(undefined),
    bgColor2: z.string().regex(HEX).optional().catch(undefined),
    angle: z.number().int().min(0).max(360).optional().catch(undefined),
    bgImageId: z.string().uuid().optional().catch(undefined),
    overlay: z.number().int().min(0).max(90).optional().catch(undefined),
    parallax: z.boolean().optional().catch(undefined),
    tone: z.enum(TONES).optional().catch(undefined),
    titleSize: z.enum(TITLE_SIZES).optional().catch(undefined),
    shape: z.enum(SHAPES).optional().catch(undefined),
    hideOn: z.enum(["mobile", "desktop"]).optional().catch(undefined),
    anchor: z.string().trim().toLowerCase().regex(ANCHOR).optional().catch(undefined),
  })
  .optional()
  .catch(undefined)
  .transform((style): SectionStyle | undefined => {
    if (!style) return undefined;
    const kept = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as SectionStyle;
    // A gradient needs its first colour, tinting and parallax need the picture.
    if (!kept.bgColor) {
      delete kept.bgColor2;
      delete kept.angle;
    }
    if (!kept.bgImageId) {
      delete kept.overlay;
      delete kept.parallax;
    }
    return Object.keys(kept).length ? kept : undefined;
  });

const sectionInput = z
  .object({
    id: z.string().min(1).max(64),
    type: z.enum(SECTION_TYPES),
    variant: z.string().max(20).optional(),
    background: z.enum(BACKGROUNDS).optional().catch(undefined),
    title: text(160),
    subtitle: text(300),
    text: text(4000),
    buttonLabel: text(40),
    link,
    imageId: optionalId,
    productIds: z.array(z.string().uuid()).max(24).default([]),
    categoryId: optionalId,
    limit: z.coerce.number().int().min(1).max(24).default(8),
    videoUrl: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((v) => (v && embedOf(v) ? v : "")),
    hidden: z.boolean().optional().default(false),
    items: z.array(itemInput).max(MAX_ITEMS).default([]),
    style: styleInput,
  })
  .transform((s): Section => ({ ...s, variant: VARIANTS[s.type]?.includes(s.variant ?? "") ? s.variant : VARIANTS[s.type]?.[0] }));

/** Sections as sent, checked; a website keeps no store sections (they need a catalogue). */
const sectionsOf = (kind: SiteKind, raw: unknown): Section[] =>
  z
    .array(sectionInput)
    .max(MAX_SECTIONS)
    .parse(raw)
    .filter((s) => kind === "store" || !STORE_ONLY.includes(s.type));

/** What is not the company's own is refused (pictures) or dropped (products, categories), not trusted. */
async function cleanSections(tx: Tx, list: Section[]): Promise<Section[]> {
  await assertImages(tx, sectionImages(list));
  const productIds = [...new Set(list.flatMap((s) => s.productIds ?? []))];
  const known = productIds.length ? new Set((await tx.select({ id: products.id }).from(products).where(inArray(products.id, productIds))).map((p) => p.id)) : new Set<string>();
  const categoryIds = [...new Set(list.map((s) => s.categoryId).filter((v): v is string => !!v))];
  const cats = categoryIds.length
    ? new Set((await tx.select({ id: productCategories.id }).from(productCategories).where(inArray(productCategories.id, categoryIds))).map((c) => c.id))
    : new Set<string>();
  return list.map((s) => ({ ...s, productIds: (s.productIds ?? []).filter((p) => known.has(p)), categoryId: s.categoryId && cats.has(s.categoryId) ? s.categoryId : null }));
}

/** The sections of the home page ("home") or of one of the site's own pages (by its id). */
export async function saveSections(ctx: Context, id: string, page: string, raw: unknown[]): Promise<void> {
  const kind = await kindOf(ctx, id);
  allow(ctx, kind);
  const list = sectionsOf(kind, raw);
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    const clean = await cleanSections(tx, list);
    if (page === "home") {
      await tx.update(stores).set({ blocks: clean, updatedAt: new Date() }).where(eq(stores.id, id));
    } else {
      const pages = (row.customPages ?? []) as SitePage[];
      if (!pages.some((p) => p.id === page)) throw new NotFoundError();
      await tx
        .update(stores)
        .set({ customPages: pages.map((p) => (p.id === page ? { ...p, sections: clean } : p)), updatedAt: new Date() })
        .where(eq(stores.id, id));
    }
    await audit(tx, ctx, "store.sections", "store", id, { page, sections: clean.length });
  });
}

const pageListInput = z
  .array(
    z.object({
      id: z.string().min(1).max(64).optional(),
      title: z.string().trim().min(1).max(80),
      slug: z.string().trim().toLowerCase().max(40),
      inMenu: z.boolean().default(true),
    }),
  )
  .max(MAX_PAGES);
export type PageListInput = z.input<typeof pageListInput>;

/** The site's own pages: order, titles, addresses, place in the menu; a new page starts with a title section. */
export async function saveSitePages(ctx: Context, id: string, raw: PageListInput): Promise<SitePage[]> {
  allow(ctx, await kindOf(ctx, id));
  const list = pageListInput.parse(raw);
  const slugs = new Set<string>();
  for (const p of list) {
    if (!validPageSlug(p.slug) || slugs.has(p.slug)) throw new StoreError("PAGE_SLUG");
    slugs.add(p.slug);
  }
  return withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    const before = new Map(((row.customPages ?? []) as SitePage[]).map((p) => [p.id, p]));
    const pages: SitePage[] = list.map((p) => {
      const old = p.id ? before.get(p.id) : undefined;
      return {
        id: old?.id ?? randomUUID(),
        title: p.title,
        slug: p.slug,
        inMenu: p.inMenu,
        sections: old?.sections ?? [{ id: randomUUID(), type: "hero", variant: "centered", background: "soft", title: p.title, text: "" }],
      };
    });
    await tx.update(stores).set({ customPages: pages, updatedAt: new Date() }).where(eq(stores.id, id));
    await audit(tx, ctx, "store.site_pages", "store", id, { pages: pages.map((p) => p.slug) });
    return pages;
  });
}

const applyInput = z.object({
  theme: z.object({
    preset: z.string().optional(),
    mode: z.enum(["light", "dark"]).optional(),
    font: z.enum(FONT_PAIRS).optional(),
    radius: z.enum(RADII).optional(),
    primary: z.string().regex(HEX).optional(),
    accent: z.string().regex(HEX).optional(),
  }),
  tagline: text(160),
  sections: z.array(z.unknown()).max(MAX_SECTIONS),
  pages: z
    .array(z.object({ title: z.string().trim().min(1).max(80), slug: z.string().trim().max(40).default(""), sections: z.array(z.unknown()).max(MAX_SECTIONS) }))
    .max(MAX_PAGES),
  categories: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  /** Add the suggested categories the catalogue does not have yet (stores only). */
  createCategories: z.boolean().default(false),
});
export type ApplyInput = z.input<typeof applyInput>;

/** A proposal (from the AI) taken over: the theme, the home page and the own pages are replaced; nothing goes online by itself. */
export async function applySite(ctx: Context, id: string, raw: ApplyInput): Promise<void> {
  const kind = await kindOf(ctx, id);
  allow(ctx, kind);
  const input = applyInput.parse(raw);
  const home = sectionsOf(kind, input.sections);
  const taken = new Set<string>();
  const drafts = input.pages.map((p) => {
    const slug = validPageSlug(p.slug) && !taken.has(p.slug) ? p.slug : slugifyPage(p.title, taken);
    taken.add(slug);
    return { title: p.title, slug, sections: sectionsOf(kind, p.sections) };
  });
  const theme: Partial<Theme> = {};
  if (input.theme.preset && PRESET_NAMES.includes(input.theme.preset)) theme.preset = input.theme.preset;
  if (input.theme.mode) theme.mode = input.theme.mode;
  if (input.theme.font) theme.font = input.theme.font;
  if (input.theme.radius) theme.radius = input.theme.radius;
  if (input.theme.primary) theme.primary = input.theme.primary;
  if (input.theme.accent) theme.accent = input.theme.accent;
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    const pages: SitePage[] = [];
    for (const d of drafts) pages.push({ id: randomUUID(), title: d.title, slug: d.slug, inMenu: true, sections: await cleanSections(tx, d.sections) });
    // A new preset brings its own colours and fonts unless the proposal names them.
    const design = { ...((row.design ?? {}) as object), ...(theme.preset ? presetTheme(theme.preset) : {}), ...theme, ...(input.tagline ? { tagline: input.tagline } : {}) };
    await tx
      .update(stores)
      .set({ design, blocks: await cleanSections(tx, home), customPages: pages, updatedAt: new Date() })
      .where(eq(stores.id, id));
    let created = 0;
    if (kind === "store" && input.createCategories && input.categories.length) {
      const existing = await tx.select({ name: productCategories.name, parentId: productCategories.parentId }).from(productCategories);
      const names = new Set(existing.filter((c) => !c.parentId).map((c) => c.name.toLowerCase()));
      const fresh = [...new Map(input.categories.map((c) => [c.toLowerCase(), c])).values()].filter((c) => !names.has(c.toLowerCase()));
      if (fresh.length) {
        const rows = await tx
          .insert(productCategories)
          .values(fresh.map((n, i) => ({ organizationId: ctx.organization.id, name: n, position: existing.length + i })))
          .onConflictDoNothing()
          .returning({ id: productCategories.id });
        created = rows.length;
      }
    }
    await audit(tx, ctx, "store.ai_apply", "store", id, { sections: home.length, pages: pages.length, categories: created });
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
  allow(ctx, await kindOf(ctx, id));
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
  const kind = await kindOf(ctx, id);
  allow(ctx, kind);
  if (kind !== "store") throw new StoreError("KIND");
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
  const kind = await kindOf(ctx, id);
  allow(ctx, kind, "settings.manage");
  if (kind !== "store") throw new StoreError("KIND");
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
  canSee(ctx, await kindOf(ctx, id));
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
  const selling = store.kind === "store";
  let offered = 0;
  if (selling) {
    const filter = await visibleProductFilter(tx, row.categoryIds);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(products).where(filter);
    offered = Number(n);
  }
  const missingPages = REQUIRED_LEGAL_OF[store.kind].filter((p) => !store.pages[p].trim());
  const shown = [...store.blocks, ...store.customPages.flatMap((p) => p.sections)].filter((s) => !s.hidden);
  const passed: Record<Check, boolean> = {
    name: !!store.name.trim() && validSlug(store.slug),
    // What a store needs to sell; a website sells nothing.
    products: !selling || offered > 0,
    payment: !selling || (store.payments.bank && !!org?.iban) || (store.payments.stripe && store.stripe.key && store.stripe.webhook),
    shipping: !selling || store.shipping.length > 0,
    address: !!(org?.street && org.postalCode && org.city && (store.contactEmail || org.email)),
    legal: missingPages.length === 0,
    texts: !sectionTexts(shown).some((text) => PLACEHOLDER.test(text)),
  };
  return { passed, missingPages, ready: CHECKS_OF[store.kind].every((c) => passed[c]) };
}

export async function setStoreStatus(ctx: Context, id: string, status: Exclude<StoreStatus, "DRAFT">): Promise<void> {
  allow(ctx, await kindOf(ctx, id), "settings.manage");
  const org = status === "PUBLISHED" ? await companyOf(ctx.organization.id) : undefined;
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    if (status === "PUBLISHED") {
      const checks = await checksOf(tx, row, org);
      if (!checks.ready) throw new StoreError("CHECKS", CHECKS_OF[kindOfRow(row)].filter((c) => !checks.passed[c]));
    }
    await tx
      .update(stores)
      .set({ status, updatedAt: new Date(), ...(status === "PUBLISHED" ? { publishedAt: new Date(), live: contentOf(row) } : {}) })
      .where(eq(stores.id, id));
    await audit(tx, ctx, status === "PUBLISHED" ? "store.publish" : "store.unpublish", "store", id);
  });
}

/** A site goes for good; one that is online only when its name is typed again (`confirmName`). Orders of a shop stay. */
export async function deleteStore(ctx: Context, id: string, confirmName?: string): Promise<void> {
  allow(ctx, await kindOf(ctx, id), "settings.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    if (row.status === "PUBLISHED" && (confirmName ?? "").trim() !== row.name.trim()) throw new StoreError("PUBLISHED");
    await tx.delete(stores).where(eq(stores.id, id));
    await audit(tx, ctx, "store.delete", "store", id, { slug: row.slug });
  });
}

/** Edits of a published site go online; the checks of its kind must pass again. */
export async function publishChanges(ctx: Context, id: string): Promise<void> {
  allow(ctx, await kindOf(ctx, id), "settings.manage");
  const org = await companyOf(ctx.organization.id);
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    if (row.status !== "PUBLISHED") throw new StoreError("CHECKS");
    const checks = await checksOf(tx, row, org);
    if (!checks.ready) throw new StoreError("CHECKS", CHECKS_OF[kindOfRow(row)].filter((c) => !checks.passed[c]));
    await tx.update(stores).set({ live: contentOf(row), publishedAt: new Date(), updatedAt: new Date() }).where(eq(stores.id, id));
    await audit(tx, ctx, "store.publish_changes", "store", id);
  });
}

/** Edits not yet published are dropped: the site is again what visitors see. */
export async function discardChanges(ctx: Context, id: string): Promise<void> {
  allow(ctx, await kindOf(ctx, id));
  await withTenant(ctx.organization.id, async (tx) => {
    const row = await storeOf(tx, id);
    const live = row.live as ReturnType<typeof contentOf> | null;
    if (!live) return;
    await tx
      .update(stores)
      .set({ design: live.design, blocks: live.blocks, customPages: live.customPages, pages: live.pages, updatedAt: new Date() })
      .where(eq(stores.id, id));
    await audit(tx, ctx, "store.discard_changes", "store", id);
  });
}

/** Products to choose for a product row on the home page. */
export async function productChoices(ctx: Context): Promise<{ id: string; name: string }[]> {
  allow(ctx, "store");
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.active, true), gt(products.priceCents, 0)))
      .orderBy(asc(products.name))
      .limit(500),
  );
}

/** Images of the company, to choose a logo or a section's picture from. */
export async function storeImages(ctx: Context, kind: SiteKind = "store") {
  allow(ctx, kind);
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(inArray(documents.mimeType, ["image/png", "image/jpeg", "image/webp", "image/gif"]))
      .orderBy(sql`${documents.createdAt} desc`)
      .limit(200),
  );
}
