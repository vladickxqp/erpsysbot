/**
 * A page of a website, section by section: each section is a known
 * component with its settings (src/lib/site.ts) — never stored markup. The
 * texts are the company's, shown as typed; links are checked when saved and
 * again here; videos come only from YouTube's and Vimeo's privacy players.
 * A section's own look — spacing, width, alignment, columns, colours or a
 * picture behind it, its heading size, its entrance and the shape of its
 * lower edge — comes from its style, checked when saved: colours are
 * #rrggbb, pictures the company's own, numbers within their bounds.
 */
import { ArrowRight, ArrowUpRight, Award, Check, Clock, Gift, Globe, Heart, ImageIcon, Leaf, Link2, Mail, Music, Phone, Play, Plus, ShieldCheck, ShoppingBag, Sparkles, Star, Truck, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { embedOf, onColor, SHAPE_PATHS, siteHref, STORE_ONLY, type Align, type Background, type ButtonStyle, type Hover, type Section, type SectionItem, type Shape, type Spacing, type Width } from "@/lib/site";
import { storeCategories, storeProducts, type PublicStore } from "@/server/storefront";
import { ContactForm } from "./contact-form";
import { PriceNote, ProductGrid } from "./product-grid";
import { Reveal } from "./reveal";
import { shopWords } from "./store";
import { LOOK, PlainText, ShopImage } from "./ui";

const ICONS: Record<string, LucideIcon> = { sparkles: Sparkles, truck: Truck, shield: ShieldCheck, heart: Heart, star: Star, zap: Zap, clock: Clock, leaf: Leaf, gift: Gift, phone: Phone, globe: Globe, award: Award };

const FILL: Record<Background, string> = {
  plain: "bg-[var(--site-bg)]",
  soft: "bg-[var(--site-soft)]",
  brand: "bg-[var(--shop-primary)]",
  dark: "bg-[#0a0c12]",
};
const INK: Record<Background, string> = {
  plain: "text-[var(--site-fg)]",
  soft: "text-[var(--site-fg)]",
  brand: "text-[var(--site-on-primary)]",
  dark: "text-white",
};
/** The colour each background starts with, for the lower edge of the section above it. */
const EDGE_COLOR: Record<Background, string> = { plain: "var(--site-bg)", soft: "var(--site-soft)", brand: "var(--shop-primary)", dark: "#0a0c12" };

const strong = (bg: Background) => bg === "brand" || bg === "dark";
/** Secondary text: the theme's muted colour, or a softer white on strong backgrounds. */
const quiet = (bg: Background) => (strong(bg) ? "opacity-80" : "text-[var(--site-muted)]");
const card = (bg: Background) => (strong(bg) ? "border border-white/15 bg-white/[0.06]" : LOOK.card);

const BUTTON_SHAPE: Record<ButtonStyle, string> = {
  solid: "rounded-[min(var(--site-radius),16px)] shadow-lg shadow-black/10 hover:-translate-y-0.5 hover:shadow-xl",
  pill: "rounded-full shadow-lg shadow-black/10 hover:-translate-y-0.5 hover:shadow-xl",
  outline: "rounded-[min(var(--site-radius),16px)] border-2 border-current hover:bg-current/10",
  sharp: "rounded-none uppercase tracking-[0.12em] shadow-[4px_4px_0_0_rgba(0,0,0,0.25)] hover:-translate-y-0.5",
};

/** A call to action in the theme's button style: in the accent colour, or the other way round on the brand colour. */
function buttonClass(store: PublicStore, reverse = false): string {
  const style = store.theme.buttons;
  const fill = style === "outline" ? "" : reverse ? "bg-[var(--site-on-primary)] text-[var(--shop-primary)]" : "bg-[var(--shop-accent)] text-[var(--site-on-accent)]";
  return cn("inline-flex h-12 items-center justify-center gap-2 px-6 text-sm font-semibold transition", BUTTON_SHAPE[style], fill);
}

/** What cards do under the pointer, as the theme says. */
const HOVER: Record<Hover, string> = {
  lift: "transition hover:-translate-y-1 hover:shadow-lg",
  glow: "transition hover:shadow-[0_0_0_2px_var(--shop-accent),0_18px_48px_-18px_var(--shop-accent)]",
  zoom: "transition hover:scale-[1.03]",
  none: "",
};

const PAD_TOP: Record<Spacing, string> = { none: "pt-0", small: "pt-12 sm:pt-16", normal: "pt-16 sm:pt-24", large: "pt-24 sm:pt-32", huge: "pt-32 sm:pt-48" };
const PAD_BOTTOM: Record<Spacing, string> = { none: "pb-0", small: "pb-12 sm:pb-16", normal: "pb-16 sm:pb-24", large: "pb-24 sm:pb-32", huge: "pb-32 sm:pb-48" };
const WIDTH: Record<Width, string> = { narrow: "max-w-3xl", normal: "max-w-[var(--site-container)]", wide: "max-w-[90rem]", full: "max-w-none" };
const HEADING_ALIGN: Record<Align, string> = {
  left: "max-w-2xl",
  center: "mx-auto max-w-2xl justify-items-center text-center",
  right: "ml-auto max-w-2xl justify-items-end text-right",
};
const TEXT_ALIGN: Record<Align, string> = { left: "justify-items-start text-left", center: "justify-items-center text-center", right: "justify-items-end text-right" };
const COLS: Record<number, string> = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };
const STAT_COLS: Record<number, string> = { 1: "", 2: "grid-cols-2", 3: "sm:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" };
const GALLERY_GRID: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 md:grid-cols-3", 4: "grid-cols-2 md:grid-cols-4" };
const GALLERY_MASONRY: Record<number, string> = { 1: "columns-1", 2: "columns-2", 3: "columns-2 md:columns-3", 4: "columns-2 md:columns-4" };

/** A section's own colours: dark text on light backgrounds, light text on dark ones, for every part inside. */
const LIGHT_VARS = { "--site-fg": "#0f172a", "--site-muted": "#526077", "--site-card": "#ffffff", "--site-border": "#e2e8f0" };
const DARK_VARS = { "--site-fg": "#f1f5f9", "--site-muted": "#a3adbd", "--site-card": "rgba(255, 255, 255, 0.06)", "--site-border": "rgba(255, 255, 255, 0.14)" };

type Props = { store: PublicStore; s: Section; first: boolean; anchor?: string };

/** The visible sections of a page, in order; the first hero carries the page's main heading. */
export function Sections({ store, sections }: { store: PublicStore; sections: Section[] }) {
  const shown = sections.filter((s) => !s.hidden && (store.kind === "store" || !STORE_ONLY.includes(s.type)));
  const seen = new Set<string>();
  return (
    <>
      {shown.map((section, i) => {
        // The first section of each kind can be linked to: "#contactForm", "#pricing".
        const anchor = seen.has(section.type) ? undefined : section.type;
        seen.add(section.type);
        const style = section.style ?? {};
        const next = shown[i + 1];
        return (
          <div
            key={section.id}
            id={style.anchor}
            data-section-id={section.id}
            className={cn("relative scroll-mt-20", style.hideOn === "mobile" && "max-md:hidden", style.hideOn === "desktop" && "md:hidden")}
          >
            <SectionView store={store} s={section} first={i === 0} anchor={anchor} />
            {style.shape && style.shape !== "none" && <Edge shape={style.shape} color={next ? fillOf(next) : "var(--site-soft)"} />}
          </div>
        );
      })}
    </>
  );
}

function SectionView(props: Props) {
  switch (props.s.type) {
    case "hero":
      return <Hero {...props} />;
    case "features":
      return <Features {...props} />;
    case "imageText":
      return <ImageText {...props} />;
    case "text":
      return <TextSection {...props} />;
    case "stats":
      return <Stats {...props} />;
    case "gallery":
      return <Gallery {...props} />;
    case "testimonials":
      return <Testimonials {...props} />;
    case "pricing":
      return <Pricing {...props} />;
    case "faq":
      return <Faq {...props} />;
    case "logos":
      return <Logos {...props} />;
    case "team":
      return <Team {...props} />;
    case "cta":
      return <Cta {...props} />;
    case "video":
      return <Video {...props} />;
    case "links":
      return <Links {...props} />;
    case "products":
      return <Products {...props} />;
    case "categories":
      return <Categories {...props} />;
    case "newsletter":
      return <Newsletter {...props} />;
    case "contactForm":
      return <Contact {...props} form />;
    case "contact":
      return <Contact {...props} />;
    case "divider":
      return (
        <div className="mx-auto w-full max-w-[var(--site-container)] px-4 py-6" aria-hidden>
          <hr className="border-[var(--site-border)]" />
        </div>
      );
    default:
      return null;
  }
}

// --- Look ------------------------------------------------------------------------------------------

/** The background a section has unless the company chose one. */
function defaultBg(s: Section): Background {
  if (s.type === "hero") return s.variant === "split" ? "soft" : "brand";
  if (s.type === "testimonials" || s.type === "newsletter" || s.type === "contactForm") return "soft";
  if (s.type === "video") return "dark";
  return "plain";
}

/** The background as a section's parts read it: its own colours and pictures count as light or dark. */
function toneOf(s: Section): Background {
  const st = s.style ?? {};
  if (st.tone === "light") return "dark";
  if (st.tone === "dark") return "plain";
  if (st.bgImageId) return "dark";
  if (st.bgColor) return onColor(st.bgColor) === "#ffffff" ? "dark" : "plain";
  return s.background ?? defaultBg(s);
}

/** The colour a section starts with at its top, which the lower edge of the section above is filled with. */
function fillOf(s: Section): string {
  const st = s.style ?? {};
  if (st.bgColor) return st.bgColor;
  if (st.bgImageId) return "#0a0c12";
  if (s.type === "hero") {
    // A picture behind the hero (full-screen, or centered with a picture) starts dark; the gradient starts in the brand colour.
    if (s.variant === "image" || (s.variant !== "split" && s.variant !== "gradient" && s.imageId)) return "#0a0c12";
    if (s.variant === "gradient") return "var(--shop-primary)";
  }
  if (s.type === "cta" && s.variant !== "card") return "var(--shop-primary)";
  return EDGE_COLOR[s.background ?? defaultBg(s)];
}

/** The background and text colour of a section: its layout's, or its own colour, gradient and picture. */
function paint(store: PublicStore, s: Section): { className: string; style?: CSSProperties; layer: React.ReactNode } {
  const st = s.style ?? {};
  const own = !!(st.bgColor || st.bgImageId);
  const tone = st.tone && st.tone !== "auto" ? st.tone : own ? (toneOf(s) === "dark" ? "light" : "dark") : null;
  const vars = tone === "light" ? DARK_VARS : tone === "dark" ? LIGHT_VARS : undefined;
  const ink = tone === "light" ? "text-white" : tone === "dark" ? "text-[#0f172a]" : null;
  if (!own) {
    const bg = s.background ?? defaultBg(s);
    return { className: cn(FILL[bg], ink ?? INK[bg]), style: vars as CSSProperties | undefined, layer: null };
  }
  const gradient = st.bgColor && st.bgColor2 ? `linear-gradient(${st.angle ?? 135}deg, ${st.bgColor}, ${st.bgColor2})` : null;
  const background: CSSProperties = gradient ? { backgroundImage: gradient } : { backgroundColor: st.bgColor ?? "#0a0c12" };
  const layer = st.bgImageId ? (
    <>
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: `url(/shop/${store.slug}/img/${st.bgImageId})`, backgroundAttachment: st.parallax ? "fixed" : undefined }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{ backgroundColor: st.bgColor ?? "#000000", backgroundImage: gradient ?? undefined, opacity: (st.overlay ?? 45) / 100 }}
      />
    </>
  ) : null;
  return { className: ink ?? "", style: { ...vars, ...background } as CSSProperties, layer };
}

/** The space above and below: the section's own, or its layout's. */
function spacing(s: Section, fallback: string): string {
  const st = s.style ?? {};
  return st.paddingTop || st.paddingBottom ? cn(PAD_TOP[st.paddingTop ?? "normal"], PAD_BOTTOM[st.paddingBottom ?? "normal"]) : fallback;
}

/** Columns of entries: the section's own number, or as many as suit them. */
const cols = (n: number) => (n <= 1 ? "" : n === 2 ? "sm:grid-cols-2" : n === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3");
const colsOf = (s: Section, n: number) => (s.style?.columns ? COLS[s.style.columns] : cols(n));

/** An entry that can come in after the ones before it (site.css, "stagger"). */
const entry = (i: number) => ({ "--i": i }) as CSSProperties;

/** The section's entrance: its own, or the theme's; "none" leaves it as it is. */
function Motion({ store, s, className, children }: { store: PublicStore; s: Section; className?: string; children: React.ReactNode }) {
  const st = s.style ?? {};
  const animation = st.animation ?? store.theme.animation;
  if (animation === "none") return <>{children}</>;
  return (
    <Reveal animation={animation} speed={st.speed ?? store.theme.speed} delay={st.delay ?? 0} stagger={!!st.stagger} className={className}>
      {children}
    </Reveal>
  );
}


/** The lower edge of a section, filled with the colour of the next one. */
function Edge({ shape, color }: { shape: Exclude<Shape, "none">; color: string }) {
  return (
    <svg aria-hidden viewBox="0 0 1440 80" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 -bottom-px z-10 block h-10 w-full sm:h-16" style={{ color }}>
      <path d={SHAPE_PATHS[shape]} fill="currentColor" />
    </svg>
  );
}

// --- Parts ---------------------------------------------------------------------------------------

function Frame({ store, s, anchor, pad = "py-16 sm:py-24", narrow, children }: { store: PublicStore; s: Section; anchor?: string; pad?: string; narrow?: boolean; children: React.ReactNode }) {
  const st = s.style ?? {};
  const look = paint(store, s);
  return (
    <section id={anchor} data-title={st.titleSize} className={cn("relative isolate scroll-mt-20 overflow-hidden", look.className, spacing(s, pad))} style={look.style}>
      {look.layer}
      <Motion store={store} s={s}>
        <div className={cn("relative mx-auto w-full px-4", WIDTH[st.width ?? (narrow ? "narrow" : "normal")])}>{children}</div>
      </Motion>
    </section>
  );
}

function Eyebrow({ text, bg }: { text: string; bg: Background }) {
  return <span className={cn("text-xs font-semibold uppercase tracking-[0.2em]", strong(bg) ? "opacity-80" : "text-[var(--shop-accent)]")}>{text}</span>;
}

function Heading({ s, bg, center = true, withText = true }: { s: Section; bg: Background; center?: boolean; withText?: boolean }) {
  const text = withText ? s.text : "";
  if (!s.title && !s.subtitle && !text) return null;
  return (
    <div className={cn("mb-10 grid gap-3 sm:mb-14", HEADING_ALIGN[s.style?.align ?? (center ? "center" : "left")])}>
      {s.subtitle && <Eyebrow text={s.subtitle} bg={bg} />}
      {s.title && <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{s.title}</h2>}
      {text && <PlainText text={text} className={cn("text-base sm:text-lg", quiet(bg))} />}
    </div>
  );
}

/** A link of the site: its own pages in the same tab, anything outside in a new one. */
function Go({ href, className, style, children, label }: { href: string; className?: string; style?: CSSProperties; children: React.ReactNode; label?: string }) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} className={className} style={style} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} style={style} aria-label={label} target={/^https?:/i.test(href) ? "_blank" : undefined} rel="noopener noreferrer">
      {children}
    </a>
  );
}

function ButtonOf({ store, s, fallback }: { store: PublicStore; s: Section; fallback?: string | null }) {
  const href = siteHref(`/shop/${store.slug}`, s.link) ?? fallback ?? null;
  if (!href || !s.buttonLabel) return null;
  return (
    <Go href={href} className={buttonClass(store)}>
      {s.buttonLabel} <ArrowRight className="size-4" />
    </Go>
  );
}

const items = (s: Section): SectionItem[] => s.items ?? [];
const lines = (text: string | undefined) => (text ?? "").split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

// --- Sections ------------------------------------------------------------------------------------

function Hero({ store, s, first, anchor }: Props) {
  const { t } = shopWords(store);
  const base = `/shop/${store.slug}`;
  const st = s.style ?? {};
  const variant = s.variant ?? "centered";
  const Title = first ? "h1" : "h2";
  const title = s.title || store.name;
  const text = s.text || store.design.tagline;
  const href = siteHref(base, s.link) ?? (store.kind === "store" ? `${base}/products` : null);
  const label = s.buttonLabel || (store.kind === "store" ? t("store.shop.shopNow") : "");
  const button = href && label ? (
    <Go href={href} className={buttonClass(store)}>
      {label} <ArrowRight className="size-4" />
    </Go>
  ) : null;

  if (variant === "split") {
    const bg = toneOf(s);
    return (
      <Frame store={store} s={s} anchor={anchor} pad="py-16 sm:py-28">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className={cn("grid gap-5", TEXT_ALIGN[st.align ?? "left"])}>
            {s.subtitle && <Eyebrow text={s.subtitle} bg={bg} />}
            <Title className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">{title}</Title>
            {text && <PlainText text={text} className={cn("max-w-xl text-lg", quiet(bg))} />}
            {button && <div className="pt-2">{button}</div>}
          </div>
          <div className="relative">
            <div aria-hidden className="site-glow absolute -inset-8 opacity-70" />
            {s.imageId ? (
              <ShopImage slug={store.slug} id={s.imageId} alt="" className="relative aspect-[4/3] w-full rounded-[calc(var(--site-radius)*1.5)] shadow-2xl" />
            ) : (
              <div aria-hidden className="site-gradient relative aspect-[4/3] w-full rounded-[calc(var(--site-radius)*1.5)] shadow-2xl" />
            )}
          </div>
        </div>
      </Frame>
    );
  }

  if (variant === "image") {
    return (
      <section id={anchor} data-title={st.titleSize} className="relative isolate flex min-h-[80vh] items-end overflow-hidden bg-[#0a0c12] text-white">
        {s.imageId ? <ShopImage slug={store.slug} id={s.imageId} alt="" className="absolute inset-0 -z-10 size-full" /> : <div aria-hidden className="site-gradient absolute inset-0 -z-10" />}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
        <Motion store={store} s={s} className="w-full">
          <div className={cn("mx-auto grid w-full gap-5 px-4", WIDTH[st.width ?? "normal"], TEXT_ALIGN[st.align ?? "left"], spacing(s, "pb-16 pt-40 sm:pb-24"))}>
            {s.subtitle && <Eyebrow text={s.subtitle} bg="dark" />}
            <Title className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">{title}</Title>
            {text && <PlainText text={text} className="max-w-xl text-lg opacity-85" />}
            {button && <div className="pt-2">{button}</div>}
          </div>
        </Motion>
      </section>
    );
  }

  // Centered or gradient: the hero's picture lies behind it like a background picture of its own.
  const gradient = variant === "gradient";
  const painted: Section = !gradient && s.imageId && !st.bgImageId ? { ...s, style: { ...st, bgImageId: s.imageId } } : s;
  const own = !!(painted.style?.bgColor || painted.style?.bgImageId);
  const look = paint(store, painted);
  const brandGradient = gradient && !own;
  return (
    <section
      id={anchor}
      data-title={st.titleSize}
      className={cn("relative isolate overflow-hidden", brandGradient ? "site-gradient text-[var(--site-on-primary)]" : look.className)}
      style={brandGradient ? undefined : look.style}
    >
      {!brandGradient && look.layer}
      {!own && !gradient && (
        <>
          <div aria-hidden className="site-glow absolute -left-24 -top-24 -z-10 size-96 opacity-60" />
          <div aria-hidden className="site-glow absolute -bottom-32 -right-16 -z-10 size-[28rem] opacity-50" />
        </>
      )}
      <Motion store={store} s={s}>
        <div className={cn("mx-auto grid w-full gap-6 px-4", st.width ? WIDTH[st.width] : "max-w-4xl", TEXT_ALIGN[st.align ?? "center"], spacing(s, "py-24 sm:py-36"))}>
          {s.subtitle && (
            <span className="rounded-full border border-current/20 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] backdrop-blur">{s.subtitle}</span>
          )}
          <Title className="text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">{title}</Title>
          {text && <PlainText text={text} className="max-w-2xl text-lg opacity-85 sm:text-xl" />}
          {button && <div className="pt-2">{button}</div>}
        </div>
      </Motion>
    </section>
  );
}

function Features({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const variant = s.variant ?? "cards";
  const list = items(s);
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <Heading s={s} bg={bg} />
      {variant === "list" ? (
        <ul className={cn("mx-auto grid max-w-4xl gap-x-10 gap-y-6", s.style?.columns ? COLS[s.style.columns] : "sm:grid-cols-2")}>
          {list.map((item, i) => (
            <li key={item.id} className="site-item flex gap-4" style={entry(i)}>
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--shop-accent)] text-[var(--site-on-accent)]">
                <Check className="size-4" />
              </span>
              <div className="grid gap-1">
                {item.title && <h3 className="font-semibold">{item.title}</h3>}
                {item.text && <PlainText text={item.text} className={cn("text-sm", quiet(bg))} />}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className={cn("grid gap-5", colsOf(s, list.length))}>
          {list.map((item, i) => {
            const Icon = ICONS[item.icon ?? ""] ?? Sparkles;
            return (
              <div
                key={item.id}
                style={entry(i)}
                className={cn(
                  "site-item grid content-start gap-3",
                  variant === "cards" ? cn("rounded-[var(--site-radius)] p-7 shadow-sm", HOVER[store.theme.hover], card(bg)) : "justify-items-center p-4 text-center",
                )}
              >
                <span className="grid size-12 place-items-center rounded-[min(var(--site-radius),14px)] bg-[var(--shop-accent)]/12 text-[var(--shop-accent)]">
                  <Icon className="size-6" />
                </span>
                {item.title && <h3 className="text-lg font-semibold">{item.title}</h3>}
                {item.text && <PlainText text={item.text} className={cn("text-sm", quiet(bg))} />}
              </div>
            );
          })}
        </div>
      )}
    </Frame>
  );
}

function ImageText({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const right = s.variant === "imageRight";
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <ShopImage slug={store.slug} id={s.imageId ?? null} alt={s.title ?? ""} className={cn("aspect-[4/3] w-full rounded-[var(--site-radius)] shadow-xl", right && "md:order-last")} />
        <div className={cn("grid gap-4", TEXT_ALIGN[s.style?.align ?? "left"])}>
          {s.subtitle && <Eyebrow text={s.subtitle} bg={bg} />}
          {s.title && <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{s.title}</h2>}
          {s.text && <PlainText text={s.text} className={cn("text-lg", quiet(bg))} />}
          <ButtonOf store={store} s={s} />
        </div>
      </div>
    </Frame>
  );
}

function TextSection({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  return (
    <Frame store={store} s={s} anchor={anchor} narrow>
      <div className={cn("grid gap-4", TEXT_ALIGN[s.style?.align ?? "left"])}>
        {s.subtitle && <Eyebrow text={s.subtitle} bg={bg} />}
        {s.title && <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{s.title}</h2>}
        {s.text && <PlainText text={s.text} className={cn("text-lg", strong(bg) ? "opacity-90" : "")} />}
        <ButtonOf store={store} s={s} />
      </div>
    </Frame>
  );
}

function Stats({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const list = items(s);
  const cards = s.variant === "cards";
  const columns = s.style?.columns ? STAT_COLS[s.style.columns] : list.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : list.length === 3 ? "sm:grid-cols-3" : "grid-cols-2";
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <Heading s={s} bg={bg} />
      <dl className={cn("grid gap-6 text-center", columns)}>
        {list.map((item, i) => (
          <div key={item.id} style={entry(i)} className={cn("site-item grid gap-1", cards && cn("rounded-[var(--site-radius)] p-6", card(bg)))}>
            <dt className={cn("order-last text-sm", quiet(bg))}>{item.title}</dt>
            <dd className={cn("site-heading text-4xl font-bold tracking-tight sm:text-5xl", !strong(bg) && "text-[var(--shop-accent)]")}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </Frame>
  );
}

function Gallery({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const list = items(s).filter((i) => i.imageId);
  if (!list.length) return null;
  const masonry = s.variant === "masonry";
  const n = s.style?.columns ?? 3;
  const zoom = store.theme.hover !== "none";
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <Heading s={s} bg={bg} />
      <div className={masonry ? cn("gap-3 [&>*]:mb-3", GALLERY_MASONRY[n]) : cn("grid gap-3", GALLERY_GRID[n])}>
        {list.map((item, i) => (
          <figure key={item.id} style={entry(i)} className="site-item group relative overflow-hidden rounded-[var(--site-radius)] break-inside-avoid">
            <ShopImage
              slug={store.slug}
              id={item.imageId ?? null}
              alt={item.title ?? ""}
              className={cn("w-full", zoom && "transition duration-500 group-hover:scale-105", masonry ? "h-auto" : "aspect-square")}
            />
            {item.title && (
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-medium text-white">{item.title}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </Frame>
  );
}

function Testimonials({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const list = items(s).filter((i) => i.text);
  if (s.variant === "quote") {
    return (
      <Frame store={store} s={s} anchor={anchor} narrow>
        <Heading s={s} bg={bg} />
        <div className="grid gap-14">
          {list.map((item, i) => (
            <figure key={item.id} style={entry(i)} className="site-item grid justify-items-center gap-6 text-center">
              <span aria-hidden className="site-heading text-7xl leading-none text-[var(--shop-accent)]">
                &ldquo;
              </span>
              <blockquote className="site-heading -mt-8 text-2xl font-medium leading-snug text-balance sm:text-3xl">{item.text}</blockquote>
              <Person store={store} item={item} bg={bg} />
            </figure>
          ))}
        </div>
      </Frame>
    );
  }
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <Heading s={s} bg={bg} />
      <div className={cn("grid gap-5", colsOf(s, list.length))}>
        {list.map((item, i) => (
          <figure key={item.id} style={entry(i)} className={cn("site-item grid content-between gap-6 rounded-[var(--site-radius)] p-7 shadow-sm", card(bg))}>
            <blockquote className="grid gap-3">
              <span aria-hidden className="site-heading text-5xl leading-none text-[var(--shop-accent)]">
                &ldquo;
              </span>
              <PlainText text={item.text ?? ""} className="-mt-4 text-base" />
            </blockquote>
            <Person store={store} item={item} bg={bg} />
          </figure>
        ))}
      </div>
    </Frame>
  );
}

function Person({ store, item, bg }: { store: PublicStore; item: SectionItem; bg: Background }) {
  if (!item.label && !item.title && !item.imageId) return null;
  return (
    <figcaption className="flex items-center gap-3 text-left">
      {item.imageId && <ShopImage slug={store.slug} id={item.imageId} alt="" className="size-11 rounded-full" />}
      <span className="grid">
        {item.label && <span className="font-semibold">{item.label}</span>}
        {item.title && <span className={cn("text-sm", quiet(bg))}>{item.title}</span>}
      </span>
    </figcaption>
  );
}

function Pricing({ store, s, anchor }: Props) {
  const { t } = shopWords(store);
  const bg = toneOf(s);
  const list = items(s);
  const base = `/shop/${store.slug}`;
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <Heading s={s} bg={bg} />
      <div className={cn("grid items-stretch gap-6", colsOf(s, list.length))}>
        {list.map((item, i) => {
          const href = siteHref(base, item.link) ?? "#contactForm";
          return (
            <div
              key={item.id}
              style={entry(i)}
              className={cn(
                "site-item relative grid content-start gap-5 rounded-[calc(var(--site-radius)*1.25)] p-8 shadow-sm",
                card(bg),
                item.highlight && "shadow-2xl ring-2 ring-[var(--shop-accent)] lg:-translate-y-2",
              )}
            >
              {item.highlight && (
                <span className="absolute -top-3 left-8 rounded-full bg-[var(--shop-accent)] px-3 py-1 text-xs font-semibold text-[var(--site-on-accent)]">{t("sites.public.popular")}</span>
              )}
              {item.title && <h3 className="text-lg font-semibold">{item.title}</h3>}
              {item.value && <div className="site-heading text-4xl font-bold tracking-tight">{item.value}</div>}
              {lines(item.text).length > 0 && (
                <ul className="grid gap-2 text-sm">
                  {lines(item.text).map((line, j) => (
                    <li key={j} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--shop-accent)]" /> <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Go
                href={href}
                className={cn(
                  "mt-auto inline-flex h-11 items-center justify-center rounded-[min(var(--site-radius),14px)] px-5 text-sm font-semibold transition hover:opacity-90",
                  item.highlight ? "bg-[var(--shop-accent)] text-[var(--site-on-accent)]" : "border border-current/20",
                )}
              >
                {item.label || t("sites.public.choose")}
              </Go>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Faq({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const list = items(s).filter((i) => i.title);
  return (
    <Frame store={store} s={s} anchor={anchor} narrow>
      <Heading s={s} bg={bg} />
      <div className={cn("divide-y rounded-[var(--site-radius)]", strong(bg) ? "divide-white/15" : "divide-[var(--site-border)]")}>
        {list.map((item, i) => (
          <details key={item.id} style={entry(i)} className="site-item group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-lg font-medium [&::-webkit-details-marker]:hidden">
              {item.title}
              <Plus className="size-5 shrink-0 transition-transform group-open:rotate-45" />
            </summary>
            {item.text && <PlainText text={item.text} className={cn("pt-3", quiet(bg))} />}
          </details>
        ))}
      </div>
    </Frame>
  );
}

function Logos({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const list = items(s).filter((i) => i.imageId || i.title);
  return (
    <Frame store={store} s={s} anchor={anchor} pad="py-12 sm:py-16">
      <Heading s={s} bg={bg} />
      <ul className={cn("flex flex-wrap items-center gap-x-12 gap-y-8", s.style?.align === "left" ? "justify-start" : s.style?.align === "right" ? "justify-end" : "justify-center")}>
        {list.map((item, i) => (
          <li key={item.id} style={entry(i)} className="site-item opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0">
            {item.imageId ? (
              <ShopImage slug={store.slug} id={item.imageId} alt={item.title ?? ""} className="h-10 w-auto max-w-40 object-contain" />
            ) : (
              <span className="site-heading text-xl font-bold">{item.title}</span>
            )}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function Team({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const round = s.variant === "round";
  const list = items(s);
  const columns = s.style?.columns ? COLS[s.style.columns] : list.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : cols(list.length);
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <Heading s={s} bg={bg} />
      <div className={cn("grid gap-8", columns)}>
        {list.map((item, i) => (
          <div key={item.id} style={entry(i)} className={cn("site-item grid content-start gap-3", round && "justify-items-center text-center")}>
            <ShopImage
              slug={store.slug}
              id={item.imageId ?? null}
              alt={item.title ?? ""}
              className={round ? "size-32 rounded-full shadow-lg sm:size-40" : "aspect-[4/5] w-full rounded-[var(--site-radius)] shadow-lg"}
            />
            <div className="grid gap-0.5">
              {item.title && <h3 className="text-lg font-semibold">{item.title}</h3>}
              {item.value && <span className="text-sm font-medium text-[var(--shop-accent)]">{item.value}</span>}
            </div>
            {item.text && <PlainText text={item.text} className={cn("text-sm", quiet(bg))} />}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function Cta({ store, s, anchor }: Props) {
  const st = s.style ?? {};
  const own = !!(st.bgColor || st.bgImageId);
  const href = siteHref(`/shop/${store.slug}`, s.link) ?? "#contactForm";
  const boxed = s.variant === "card";
  const button = s.buttonLabel ? (
    <Go href={href} className={buttonClass(store, boxed || !own)}>
      {s.buttonLabel} <ArrowRight className="size-4" />
    </Go>
  ) : null;
  const content = (
    <div className={cn("grid gap-5", TEXT_ALIGN[st.align ?? "center"])}>
      {s.subtitle && <span className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">{s.subtitle}</span>}
      {s.title && <h2 className="max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">{s.title}</h2>}
      {s.text && <PlainText text={s.text} className="max-w-2xl text-lg opacity-85" />}
      {button && <div className="pt-2">{button}</div>}
    </div>
  );
  if (boxed) {
    return (
      <Frame store={store} s={s} anchor={anchor}>
        <div className="site-gradient relative overflow-hidden rounded-[calc(var(--site-radius)*2)] px-6 py-16 text-[var(--site-on-primary)] shadow-2xl sm:px-16 sm:py-20">{content}</div>
      </Frame>
    );
  }
  const look = paint(store, s);
  return (
    <section
      id={anchor}
      data-title={st.titleSize}
      className={cn("relative isolate overflow-hidden", own ? look.className : "site-gradient text-[var(--site-on-primary)]")}
      style={own ? look.style : undefined}
    >
      {own && look.layer}
      <Motion store={store} s={s}>
        <div className={cn("mx-auto w-full px-4", WIDTH[st.width ?? "normal"], spacing(s, "py-20 sm:py-28"))}>{content}</div>
      </Motion>
    </section>
  );
}

function Video({ store, s, anchor }: Props) {
  const { t } = shopWords(store);
  const src = embedOf(s.videoUrl);
  if (!src) return null;
  const bg = toneOf(s);
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <Heading s={s} bg={bg} />
      <div className="mx-auto aspect-video w-full max-w-5xl overflow-hidden rounded-[var(--site-radius)] bg-black shadow-2xl">
        <iframe
          src={src}
          title={s.title || t("sites.type.video")}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          className="size-full"
        />
      </div>
    </Frame>
  );
}

/** A platform's sign for a link (no brand logos: plain symbols). */
function linkIcon(href: string): LucideIcon {
  if (/youtu\.?be|vimeo|twitch/i.test(href)) return Play;
  if (/instagram|pinterest|flickr/i.test(href)) return ImageIcon;
  if (/tiktok|spotify|soundcloud|music|podcast/i.test(href)) return Music;
  if (/^mailto:/i.test(href)) return Mail;
  if (/^tel:/i.test(href)) return Phone;
  if (/shop|store|etsy|amazon/i.test(href)) return ShoppingBag;
  return Link2;
}

function Links({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const base = `/shop/${store.slug}`;
  const hover = HOVER[store.theme.hover];
  const list = items(s).flatMap((item) => {
    const href = siteHref(base, item.link);
    return href && item.title ? [{ ...item, href }] : [];
  });
  if (s.variant === "cards") {
    return (
      <Frame store={store} s={s} anchor={anchor}>
        <Heading s={s} bg={bg} />
        <div className={cn("grid gap-4", colsOf(s, list.length))}>
          {list.map((item, i) => {
            const Icon = linkIcon(item.href);
            return (
              <Go key={item.id} href={item.href} style={entry(i)} className={cn("site-item group grid content-start gap-3 rounded-[var(--site-radius)] p-6 shadow-sm", hover, card(bg))}>
                <span className="flex items-center justify-between">
                  <Icon className="size-6 text-[var(--shop-accent)]" />
                  <ArrowUpRight className="size-5 opacity-50 transition group-hover:opacity-100" />
                </span>
                <span className="text-lg font-semibold">{item.title}</span>
                {item.text && <span className={cn("text-sm", quiet(bg))}>{item.text}</span>}
              </Go>
            );
          })}
        </div>
      </Frame>
    );
  }
  return (
    <Frame store={store} s={s} anchor={anchor} narrow>
      <Heading s={s} bg={bg} />
      <div className="mx-auto grid max-w-md gap-3">
        {list.map((item, i) => {
          const Icon = linkIcon(item.href);
          return (
            <Go
              key={item.id}
              href={item.href}
              style={entry(i)}
              className={cn("site-item group flex h-14 items-center gap-3 rounded-[min(var(--site-radius),28px)] px-5 font-semibold shadow-sm hover:border-[var(--shop-accent)]", hover, card(bg))}
            >
              <Icon className="size-5 shrink-0 text-[var(--shop-accent)]" />
              <span className="flex-1 truncate text-center">{item.title}</span>
              <ArrowUpRight className="size-4 shrink-0 opacity-40 transition group-hover:opacity-100" />
            </Go>
          );
        })}
      </div>
    </Frame>
  );
}

async function Products({ store, s, anchor }: Props) {
  if (store.kind !== "store") return null;
  const bg = toneOf(s);
  const products = await storeProducts(store, s.productIds?.length ? { ids: s.productIds } : { categoryId: s.categoryId ?? null, limit: s.limit ?? 8 });
  return (
    <Frame store={store} s={s} anchor={anchor} pad="py-12 sm:py-16">
      <Heading s={s} bg={bg} center={false} />
      <ProductGrid store={store} products={products} />
      <div className="mt-3">
        <PriceNote store={store} />
      </div>
    </Frame>
  );
}

async function Categories({ store, s, anchor }: Props) {
  if (store.kind !== "store") return null;
  const categories = (await storeCategories(store)).filter((c) => !c.parentId);
  if (!categories.length) return null;
  const bg = toneOf(s);
  const base = `/shop/${store.slug}`;
  return (
    <Frame store={store} s={s} anchor={anchor} pad="py-12 sm:py-16">
      <Heading s={s} bg={bg} center={false} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map((c) => (
          <li key={c.id}>
            <Link href={`${base}/c/${c.id}`} className={cn("group flex h-24 items-center justify-between gap-2 rounded-[var(--site-radius)] px-5", HOVER[store.theme.hover], card(bg))}>
              <span className="font-semibold">{c.name}</span>
              <span className={cn("flex items-center gap-1 text-xs", quiet(bg))}>
                {c.count} <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function Newsletter({ store, s, anchor }: Props) {
  const bg = toneOf(s);
  const privacy = store.pages.privacy.trim() ? `/shop/${store.slug}/info/privacy` : null;
  return (
    <Frame store={store} s={s} anchor={anchor} narrow>
      <div className="grid gap-6">
        <Heading s={s} bg={bg} />
        <div className="mx-auto w-full max-w-xl">
          <ContactForm slug={store.slug} kind="newsletter" privacyHref={privacy} buttonLabel={s.buttonLabel} />
        </div>
      </div>
    </Frame>
  );
}

function Contact({ store, s, anchor, form }: Props & { form?: boolean }) {
  const { t } = shopWords(store);
  const bg = toneOf(s);
  const c = store.company;
  const privacy = store.pages.privacy.trim() ? `/shop/${store.slug}/info/privacy` : null;
  const details = (
    <div className={cn("grid content-start gap-2 text-sm", quiet(bg))}>
      <span className={cn("font-semibold", !strong(bg) && "text-[var(--site-fg)]")}>{c.legalName ?? c.name}</span>
      {c.street && <span>{[c.street, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</span>}
      {store.contactEmail && (
        <a href={`mailto:${store.contactEmail}`} className="flex w-fit items-center gap-2 hover:underline">
          <Mail className="size-4" /> {store.contactEmail}
        </a>
      )}
      {c.phone && (
        <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="flex w-fit items-center gap-2 hover:underline">
          <Phone className="size-4" /> {c.phone}
        </a>
      )}
    </div>
  );
  if (!form) {
    return (
      <Frame store={store} s={s} anchor={anchor} pad="py-12 sm:py-16">
        <div className={cn("grid gap-3 rounded-[var(--site-radius)] p-8", card(bg))}>
          <h2 className="text-xl font-semibold">{s.title || t("store.page.contact")}</h2>
          {s.text && <PlainText text={s.text} className={quiet(bg)} />}
          {details}
        </div>
      </Frame>
    );
  }
  return (
    <Frame store={store} s={s} anchor={anchor}>
      <div className="grid gap-12 md:grid-cols-[2fr_3fr]">
        <div className="grid content-start gap-4">
          {s.subtitle && <Eyebrow text={s.subtitle} bg={bg} />}
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{s.title || t("store.page.contact")}</h2>
          {s.text && <PlainText text={s.text} className={cn("text-lg", quiet(bg))} />}
          <div className="pt-2">{details}</div>
        </div>
        <div className={cn("rounded-[calc(var(--site-radius)*1.25)] p-6 shadow-xl sm:p-8", strong(bg) ? "bg-[var(--site-card)] text-[var(--site-fg)]" : LOOK.card)}>
          <ContactForm slug={store.slug} privacyHref={privacy} buttonLabel={s.buttonLabel} />
        </div>
      </div>
    </Frame>
  );
}
