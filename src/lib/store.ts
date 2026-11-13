/**
 * The online store: what a store is made of, as names and plain rules. No
 * database code — the editor in the app, the public store and the server use
 * the same shapes. Pages are built from a fixed set of blocks: the store
 * renders known components with their settings, never stored markup or code.
 */

export const STORE_STATUSES = ["DRAFT", "PUBLISHED", "UNPUBLISHED"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const TEMPLATES = ["clean", "bold", "soft"] as const;
export type Template = (typeof TEMPLATES)[number];

export const BLOCK_TYPES = ["hero", "products", "categories", "text", "imageText", "contact"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type Block = {
  id: string;
  type: BlockType;
  title?: string;
  text?: string;
  /** A picture from the company's media (documents id). */
  imageId?: string | null;
  /** Which products a product row shows; empty: the newest. */
  productIds?: string[];
  /** Only this category (product rows). */
  categoryId?: string | null;
  limit?: number;
  buttonLabel?: string;
};

export const MAX_BLOCKS = 20;

export type Design = {
  template: Template;
  /** #rrggbb */
  primary: string;
  accent: string;
  logoId: string | null;
  tagline: string;
};

export const DEFAULT_DESIGN: Design = { template: "clean", primary: "#1e293b", accent: "#2563eb", logoId: null, tagline: "" };

/** Pages besides the home page; their texts are the company's own. */
export const INFO_PAGES = ["about", "contact"] as const;
export const LEGAL_PAGES = ["imprint", "privacy", "terms", "withdrawal", "shipping"] as const;
/** Without these a store cannot be published. Their content stays the company's responsibility. */
export const REQUIRED_LEGAL = ["imprint", "privacy", "terms", "withdrawal"] as const;
export type InfoPage = (typeof INFO_PAGES)[number];
export type LegalPage = (typeof LEGAL_PAGES)[number];
export type StorePage = InfoPage | LegalPage;
export const STORE_PAGES: readonly StorePage[] = [...INFO_PAGES, ...LEGAL_PAGES];
export const isStorePage = (value: unknown): value is StorePage => typeof value === "string" && (STORE_PAGES as readonly string[]).includes(value);

export type Pages = Record<StorePage, string>;
export const EMPTY_PAGES: Pages = { about: "", contact: "", imprint: "", privacy: "", terms: "", withdrawal: "", shipping: "" };

export type ShippingOption = {
  id: string;
  name: string;
  /** What the buyer pays, tax included. */
  priceCents: number;
  /** From this order value (tax included) shipping is free; null: never. */
  freeFromCents: number | null;
};

export type PaymentMethod = "bank" | "stripe";

export type Payments = { bank: boolean; stripe: boolean };

/** What must be in place before a store goes online. */
export const CHECKS = ["name", "products", "payment", "shipping", "address", "legal", "texts"] as const;
export type Check = (typeof CHECKS)[number];

/**
 * The store's address: lowercase letters, digits and dashes, 3–40 characters,
 * no dash at either end. Some names stay free for the app itself.
 */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
const RESERVED = new Set(["app", "api", "admin", "shop", "store", "login", "register", "nexora", "www", "mail", "help", "support", "static"]);
export const validSlug = (slug: string) => SLUG.test(slug) && !slug.includes("--") && !RESERVED.has(slug);

/** A suggestion from a name: "Müller & Söhne" → "mueller-soehne". */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "shop"}-shop`.slice(0, 40);
}

export const HEX = /^#[0-9a-f]{6}$/i;

/** The price a buyer sees for one unit: net plus tax, rounded to the cent (none for a small business). */
export function grossCents(netCents: number, vatRate: number, smallBusiness: boolean): number {
  return smallBusiness ? netCents : Math.round(netCents * (1 + vatRate / 100));
}

/** The net price of a gross amount (shipping is set as the buyer pays it). */
export function netOfGross(grossCentsValue: number, vatRate: number, smallBusiness: boolean): number {
  return smallBusiness ? grossCentsValue : Math.round(grossCentsValue / (1 + vatRate / 100));
}

/** Shipping for an order value: free from the option's limit on. */
export function shippingCents(option: Pick<ShippingOption, "priceCents" | "freeFromCents">, goodsGrossCents: number): number {
  return option.freeFromCents !== null && goodsGrossCents >= option.freeFromCents ? 0 : option.priceCents;
}

export type CartItem = { productId: string; variantId: string | null; quantity: number };
export const MAX_CART_LINES = 50;
export const MAX_QUANTITY = 999;

/** A first home page, so a new store is never empty. */
export function starterBlocks(name: string, newId: () => string): Block[] {
  return [
    { id: newId(), type: "hero", title: name, text: "", buttonLabel: "" },
    { id: newId(), type: "categories", title: "" },
    { id: newId(), type: "products", title: "", productIds: [], categoryId: null, limit: 8 },
    { id: newId(), type: "contact", title: "" },
  ];
}
