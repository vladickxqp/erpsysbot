/**
 * The website builder: what a site is made of, as names and plain rules. A
 * site is a store, a creator's page or a company website; each is built from
 * the same sections and themes. Pages are lists of sections with settings —
 * the site renders known components, never stored markup or code — so what
 * the AI or a person builds stays safe, fast and editable.
 *
 * No database code: the editor, the public site, the server and the AI use
 * these shapes.
 */
import type { AppModule } from "./modules";
import type { Block, Check, LegalPage } from "./store";

/** What the site is for: selling (with cart and checkout), a creator's page, a company website. */
export const SITE_KINDS = ["store", "creator", "company"] as const;
export type SiteKind = (typeof SITE_KINDS)[number];
export const isSiteKind = (value: unknown): value is SiteKind => typeof value === "string" && (SITE_KINDS as readonly string[]).includes(value);

/** The module a kind belongs to: a store sells (Commerce), the other sites are for everyone. */
export const siteModule = (kind: unknown): AppModule => (kind === "creator" || kind === "company" ? "sites" : "store");

/** Every section the builder offers, grouped for the "add section" gallery. */
export const SECTION_TYPES = [
  "hero",
  "features",
  "imageText",
  "text",
  "stats",
  "gallery",
  "testimonials",
  "pricing",
  "faq",
  "logos",
  "team",
  "cta",
  "video",
  "links",
  "products",
  "categories",
  "newsletter",
  "contactForm",
  "contact",
  "divider",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const isSectionType = (value: unknown): value is SectionType => typeof value === "string" && (SECTION_TYPES as readonly string[]).includes(value);

export const SECTION_GROUPS: { key: "intro" | "content" | "trust" | "sell" | "reach"; types: SectionType[] }[] = [
  { key: "intro", types: ["hero", "cta", "divider"] },
  { key: "content", types: ["features", "imageText", "text", "gallery", "video", "links", "team"] },
  { key: "trust", types: ["stats", "testimonials", "logos", "faq"] },
  { key: "sell", types: ["products", "categories", "pricing"] },
  { key: "reach", types: ["newsletter", "contactForm", "contact"] },
];

/** Sections that only make sense where goods are sold. */
export const STORE_ONLY: SectionType[] = ["products", "categories"];

/** The ways a section can be laid out; the first is the default. */
export const VARIANTS: Partial<Record<SectionType, readonly string[]>> = {
  hero: ["centered", "split", "image", "gradient"],
  features: ["cards", "icons", "list"],
  imageText: ["imageLeft", "imageRight"],
  gallery: ["grid", "masonry"],
  testimonials: ["cards", "quote"],
  stats: ["row", "cards"],
  cta: ["banner", "card"],
  links: ["buttons", "cards"],
  team: ["cards", "round"],
};

export const BACKGROUNDS = ["plain", "soft", "brand", "dark"] as const;
export type Background = (typeof BACKGROUNDS)[number];

/** Icons a feature may carry (lucide names, drawn by the site from a fixed list). */
export const FEATURE_ICONS = ["sparkles", "truck", "shield", "heart", "star", "zap", "clock", "leaf", "gift", "phone", "globe", "award"] as const;

/** One entry of a list section: a feature, a picture, a quote, a price, a question, a person, a link. */
export type SectionItem = {
  id: string;
  title?: string;
  text?: string;
  imageId?: string | null;
  /** A number, a price, a role: what the section shows big or under the name. */
  value?: string;
  /** Who said it, the button on a price, the platform of a link. */
  label?: string;
  link?: string;
  icon?: string;
  /** A price card to stand out. */
  highlight?: boolean;
};

/** A section: the old store block, with a layout, a background and entries. */
export type Section = Omit<Block, "type"> & {
  type: SectionType;
  variant?: string;
  background?: Background;
  subtitle?: string;
  /** Where the button leads: a page of the site or an outside address. */
  link?: string;
  items?: SectionItem[];
  /** A YouTube or Vimeo address (video sections). */
  videoUrl?: string;
  /** Hidden sections stay in the editor and are not shown. */
  hidden?: boolean;
};

export const MAX_SECTIONS = 30;
export const MAX_ITEMS = 24;
export const MAX_PAGES = 10;

/** A page of its own besides the home page, at /shop/<site>/<slug>. */
export type SitePage = { id: string; slug: string; title: string; inMenu: boolean; sections: Section[] };

/** Addresses the site uses itself: a page cannot take them. */
export const RESERVED_PAGES = new Set(["products", "cart", "checkout", "c", "p", "info", "order", "img", "api", "admin"]);
export const PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const validPageSlug = (slug: string) => PAGE_SLUG.test(slug) && !slug.includes("--") && !RESERVED_PAGES.has(slug);

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", ғ: "g", д: "d", е: "e", ё: "e", є: "ye", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", қ: "q",
  л: "l", м: "m", н: "n", ң: "n", о: "o", ө: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ү: "u", ұ: "u", ф: "f", х: "h", һ: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ә: "a", ю: "yu", я: "ya",
};

/** A page address from its title ("Über uns" → "ueber-uns", "О нас" → "o-nas"), free among `taken` and never one the site uses. */
export function slugifyPage(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[а-яёєіїґғқңөүұһә]/g, (c) => CYRILLIC[c] ?? "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "seite";
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    if (validPageSlug(candidate) && !taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`.slice(0, 40);
}

/** A link a visitor may follow: the site's own pages, the web, mail or phone — nothing that runs code. */
export function safeLink(raw: string | undefined | null): string | null {
  const link = (raw ?? "").trim();
  if (!link) return null;
  if (/^#[\w-]{1,40}$/.test(link)) return link;
  if (/^\/(?!\/)[\w\-./?=&#%]*$/.test(link)) return link;
  if (/^(https?:\/\/|mailto:|tel:)[^\s<>"']+$/i.test(link)) return link;
  return null;
}

/** Where a link of the site leads: its own pages under its address ("/kontakt" → "/shop/<site>/kontakt"), anything else as it is. */
export function siteHref(base: string, raw: string | undefined | null): string | null {
  const link = safeLink(raw);
  if (!link || !link.startsWith("/") || link.startsWith("/shop/")) return link;
  return link === "/" ? base : `${base}${link}`;
}

/** A video that can be embedded: YouTube or Vimeo, as their privacy-friendly player address. */
export function embedOf(url: string | undefined | null): string | null {
  const u = (url ?? "").trim();
  const youtube = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/i.exec(u);
  if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`;
  const vimeo = /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d{4,12})/i.exec(u);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`;
  return null;
}

// --- Themes ----------------------------------------------------------------------------------------

export const FONT_PAIRS = ["modern", "elegant", "editorial", "friendly", "tech", "classic"] as const;
export type FontPair = (typeof FONT_PAIRS)[number];

export const RADII = ["none", "small", "medium", "large"] as const;
export type Radius = (typeof RADII)[number];

export type Theme = {
  preset: string;
  mode: "light" | "dark";
  font: FontPair;
  radius: Radius;
  /** Sections float in gently as the visitor scrolls. */
  animate: boolean;
  /** #rrggbb */
  primary: string;
  accent: string;
};

/** Ready-made looks; a person may change every part afterwards. */
export const THEME_PRESETS: Record<string, Omit<Theme, "preset" | "animate">> = {
  minimal: { mode: "light", font: "modern", radius: "small", primary: "#0f172a", accent: "#2563eb" },
  luxury: { mode: "dark", font: "elegant", radius: "none", primary: "#0b0b0f", accent: "#c8a24a" },
  fresh: { mode: "light", font: "friendly", radius: "large", primary: "#065f46", accent: "#10b981" },
  bold: { mode: "light", font: "tech", radius: "medium", primary: "#111827", accent: "#f43f5e" },
  editorial: { mode: "light", font: "editorial", radius: "none", primary: "#1c1917", accent: "#b45309" },
  midnight: { mode: "dark", font: "tech", radius: "medium", primary: "#020617", accent: "#8b5cf6" },
  ocean: { mode: "light", font: "modern", radius: "large", primary: "#0c4a6e", accent: "#0ea5e9" },
  classic: { mode: "light", font: "classic", radius: "small", primary: "#1e3a5f", accent: "#b91c1c" },
};
export const PRESET_NAMES = Object.keys(THEME_PRESETS);

export const DEFAULT_THEME: Theme = { preset: "minimal", animate: true, ...THEME_PRESETS.minimal };

/** The look a new site starts with. */
export const STARTER_PRESET: Record<SiteKind, string> = { store: "minimal", creator: "midnight", company: "ocean" };

export const RADIUS_PX: Record<Radius, string> = { none: "0px", small: "6px", medium: "14px", large: "26px" };

/** Black or white, whichever reads better on this colour (#rrggbb). */
export function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#0b0b0f" : "#ffffff";
}

/** The colours and corners of a theme as CSS variables (the fonts are added where they are loaded). */
export function themeVars(theme: Theme): Record<string, string> {
  const dark = theme.mode === "dark";
  return {
    "--shop-primary": theme.primary,
    "--shop-accent": theme.accent,
    "--site-on-primary": onColor(theme.primary),
    "--site-on-accent": onColor(theme.accent),
    "--site-bg": dark ? "#0b0d12" : "#ffffff",
    "--site-fg": dark ? "#f1f5f9" : "#0f172a",
    "--site-muted": dark ? "#a3adbd" : "#526077",
    "--site-soft": dark ? "#141823" : `color-mix(in srgb, ${theme.primary} 5%, #f8fafc)`,
    "--site-card": dark ? "#121621" : "#ffffff",
    "--site-border": dark ? "rgba(255, 255, 255, 0.1)" : "#e2e8f0",
    "--site-radius": RADIUS_PX[theme.radius],
  };
}

/** The theme of a site: what was saved, completed from its preset and the defaults. */
export function themeOf(raw: unknown): Theme {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Theme> & { template?: string };
  const preset = typeof r.preset === "string" && THEME_PRESETS[r.preset] ? r.preset : r.template === "bold" ? "bold" : r.template === "soft" ? "fresh" : "minimal";
  const base = THEME_PRESETS[preset];
  const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
  return {
    preset,
    mode: r.mode === "dark" || r.mode === "light" ? r.mode : base.mode,
    font: (FONT_PAIRS as readonly string[]).includes(r.font as string) ? (r.font as FontPair) : base.font,
    radius: (RADII as readonly string[]).includes(r.radius as string) ? (r.radius as Radius) : base.radius,
    animate: typeof r.animate === "boolean" ? r.animate : true,
    primary: hex(r.primary, base.primary),
    accent: hex(r.accent, base.accent),
  };
}

// --- Starting points -------------------------------------------------------------------------------

/**
 * A first home page per kind of site, so nothing starts empty. `words` gives
 * the texts in the site's language (sites.starter.*); what only the company
 * knows stays a placeholder in square brackets, which must be replaced
 * before the site goes online (check "texts").
 */
export function starterSections(kind: SiteKind, name: string, newId: () => string, words: (key: string, vars?: Record<string, string>) => string): Section[] {
  const item = (patch: Partial<SectionItem>): SectionItem => ({ id: newId(), ...patch });
  if (kind === "creator") {
    return [
      { id: newId(), type: "hero", variant: "centered", background: "brand", title: name, subtitle: words("sites.starter.niche"), text: words("sites.starter.creatorText") },
      {
        id: newId(),
        type: "links",
        variant: "buttons",
        title: "",
        items: [item({ title: "YouTube", link: "https://www.youtube.com" }), item({ title: "Instagram", link: "https://www.instagram.com" }), item({ title: "TikTok", link: "https://www.tiktok.com" })],
      },
      { id: newId(), type: "contactForm", title: words("sites.starter.collab"), text: "" },
    ];
  }
  if (kind === "company") {
    return [
      { id: newId(), type: "hero", variant: "split", background: "soft", title: name, text: words("sites.starter.companyText"), buttonLabel: words("sites.starter.contact"), link: "#contactForm" },
      {
        id: newId(),
        type: "features",
        variant: "cards",
        title: words("sites.starter.services"),
        items: (["sparkles", "shield", "clock"] as const).map((icon, i) => item({ icon, title: words("sites.starter.service", { n: String(i + 1) }), text: words("sites.starter.serviceText") })),
      },
      { id: newId(), type: "contactForm", title: words("sites.starter.contact"), text: "" },
    ];
  }
  return [
    { id: newId(), type: "hero", variant: "centered", background: "brand", title: name, text: "", buttonLabel: "" },
    { id: newId(), type: "categories", title: "" },
    { id: newId(), type: "products", title: "", productIds: [], categoryId: null, limit: 8 },
    { id: newId(), type: "contact", title: "" },
  ];
}

/** A placeholder left for the company: "[Anzahl Kunden]". */
export const PLACEHOLDER = /\[[^\]\n]{2,80}\]/;

/** The texts of sections, to look for placeholders. */
export function sectionTexts(sections: readonly Section[]): string[] {
  return sections.flatMap((s) => [s.title, s.subtitle, s.text, s.buttonLabel, ...(s.items ?? []).flatMap((i) => [i.title, i.text, i.value, i.label])].filter((v): v is string => !!v));
}

/** Legal pages each kind needs before going online (the texts stay the company's). */
export const REQUIRED_LEGAL_OF: Record<SiteKind, readonly LegalPage[]> = {
  store: ["imprint", "privacy", "terms", "withdrawal"],
  creator: ["imprint", "privacy"],
  company: ["imprint", "privacy"],
};

/** The checks a kind must pass before publishing (see src/lib/store.ts CHECKS). */
export const CHECKS_OF: Record<SiteKind, readonly Check[]> = {
  store: ["name", "products", "payment", "shipping", "address", "legal", "texts"],
  creator: ["name", "address", "legal", "texts"],
  company: ["name", "address", "legal", "texts"],
};
