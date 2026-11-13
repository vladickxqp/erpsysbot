/**
 * A page of a website, section by section: each section is a known
 * component with its settings (src/lib/site.ts) — never stored markup. The
 * texts are the company's, shown as typed; links are checked when saved and
 * again here; videos come only from YouTube's and Vimeo's privacy players.
 */
import { ArrowRight, ArrowUpRight, Award, Check, Clock, Gift, Globe, Heart, ImageIcon, Leaf, Link2, Mail, Music, Phone, Play, Plus, ShieldCheck, ShoppingBag, Sparkles, Star, Truck, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { embedOf, siteHref, STORE_ONLY, type Background, type Section, type SectionItem } from "@/lib/site";
import { storeCategories, storeProducts, type PublicStore } from "@/server/storefront";
import { ContactForm } from "./contact-form";
import { PriceNote, ProductGrid } from "./product-grid";
import { Reveal } from "./reveal";
import { shopWords } from "./store";
import { LOOK, PlainText, ShopImage } from "./ui";

const ICONS: Record<string, LucideIcon> = { sparkles: Sparkles, truck: Truck, shield: ShieldCheck, heart: Heart, star: Star, zap: Zap, clock: Clock, leaf: Leaf, gift: Gift, phone: Phone, globe: Globe, award: Award };

const BG: Record<Background, string> = {
  plain: "bg-[var(--site-bg)] text-[var(--site-fg)]",
  soft: "bg-[var(--site-soft)] text-[var(--site-fg)]",
  brand: "bg-[var(--shop-primary)] text-[var(--site-on-primary)]",
  dark: "bg-[#0a0c12] text-white",
};

const strong = (bg: Background) => bg === "brand" || bg === "dark";
/** Secondary text: the theme's muted colour, or a softer white on strong backgrounds. */
const quiet = (bg: Background) => (strong(bg) ? "opacity-80" : "text-[var(--site-muted)]");
const card = (bg: Background) => (strong(bg) ? "border border-white/15 bg-white/[0.06]" : LOOK.card);

const BUTTON =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[min(var(--site-radius),16px)] px-6 text-sm font-semibold shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-xl";
const ACCENT_BUTTON = cn(BUTTON, "bg-[var(--shop-accent)] text-[var(--site-on-accent)]");

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
        return <SectionView key={section.id} store={store} s={section} first={i === 0} anchor={anchor} />;
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
        <div className="mx-auto w-full max-w-6xl px-4 py-6" aria-hidden>
          <hr className="border-[var(--site-border)]" />
        </div>
      );
    default:
      return null;
  }
}

// --- Parts ---------------------------------------------------------------------------------------

function Frame({ store, anchor, bg, narrow, className, children }: { store: PublicStore; anchor?: string; bg: Background; narrow?: boolean; className?: string; children: React.ReactNode }) {
  const inner = <div className={cn("relative mx-auto w-full px-4", narrow ? "max-w-3xl" : "max-w-6xl")}>{children}</div>;
  return (
    <section id={anchor} className={cn("relative scroll-mt-20 overflow-hidden", BG[bg], className ?? "py-16 sm:py-24")}>
      {store.theme.animate ? <Reveal>{inner}</Reveal> : inner}
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
    <div className={cn("mb-10 grid gap-3 sm:mb-14", center ? "mx-auto max-w-2xl justify-items-center text-center" : "max-w-2xl")}>
      {s.subtitle && <Eyebrow text={s.subtitle} bg={bg} />}
      {s.title && <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{s.title}</h2>}
      {text && <PlainText text={text} className={cn("text-base sm:text-lg", quiet(bg))} />}
    </div>
  );
}

/** A link of the site: its own pages in the same tab, anything outside in a new one. */
function Go({ href, className, children, label }: { href: string; className?: string; children: React.ReactNode; label?: string }) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} className={className} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} aria-label={label} target={/^https?:/i.test(href) ? "_blank" : undefined} rel="noopener noreferrer">
      {children}
    </a>
  );
}

function ButtonOf({ store, s, fallback }: { store: PublicStore; s: Section; fallback?: string | null }) {
  const href = siteHref(`/shop/${store.slug}`, s.link) ?? fallback ?? null;
  if (!href || !s.buttonLabel) return null;
  return (
    <Go href={href} className={ACCENT_BUTTON}>
      {s.buttonLabel} <ArrowRight className="size-4" />
    </Go>
  );
}

const items = (s: Section): SectionItem[] => s.items ?? [];
const cols = (n: number) => (n <= 1 ? "" : n === 2 ? "sm:grid-cols-2" : n === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3");
const lines = (text: string | undefined) => (text ?? "").split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

// --- Sections ------------------------------------------------------------------------------------

function Hero({ store, s, first, anchor }: Props) {
  const { t } = shopWords(store);
  const base = `/shop/${store.slug}`;
  const variant = s.variant ?? "centered";
  const Title = first ? "h1" : "h2";
  const title = s.title || store.name;
  const text = s.text || store.design.tagline;
  const href = siteHref(base, s.link) ?? (store.kind === "store" ? `${base}/products` : null);
  const label = s.buttonLabel || (store.kind === "store" ? t("store.shop.shopNow") : "");
  const button = href && label ? (
    <Go href={href} className={ACCENT_BUTTON}>
      {label} <ArrowRight className="size-4" />
    </Go>
  ) : null;

  if (variant === "split") {
    const bg = s.background ?? "soft";
    return (
      <Frame store={store} anchor={anchor} bg={bg} className="py-16 sm:py-28">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="grid justify-items-start gap-5">
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
    const inner = (
      <div className="mx-auto grid w-full max-w-6xl justify-items-start gap-5 px-4 pb-16 pt-40 sm:pb-24">
        {s.subtitle && <Eyebrow text={s.subtitle} bg="dark" />}
        <Title className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">{title}</Title>
        {text && <PlainText text={text} className="max-w-xl text-lg opacity-85" />}
        {button && <div className="pt-2">{button}</div>}
      </div>
    );
    return (
      <section id={anchor} className="relative isolate flex min-h-[80vh] items-end overflow-hidden bg-[#0a0c12] text-white">
        {s.imageId ? <ShopImage slug={store.slug} id={s.imageId} alt="" className="absolute inset-0 -z-10 size-full" /> : <div aria-hidden className="site-gradient absolute inset-0 -z-10" />}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
        {store.theme.animate ? <Reveal>{inner}</Reveal> : inner}
      </section>
    );
  }

  const gradient = variant === "gradient";
  const bg = gradient ? "brand" : (s.background ?? "brand");
  return (
    <section id={anchor} className={cn("relative isolate overflow-hidden", gradient ? "site-gradient text-[var(--site-on-primary)]" : BG[bg])}>
      {s.imageId && !gradient && (
        <>
          <ShopImage slug={store.slug} id={s.imageId} alt="" className="absolute inset-0 -z-10 size-full" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-black/45" />
        </>
      )}
      {!s.imageId && !gradient && (
        <>
          <div aria-hidden className="site-glow absolute -left-24 -top-24 -z-10 size-96 opacity-60" />
          <div aria-hidden className="site-glow absolute -bottom-32 -right-16 -z-10 size-[28rem] opacity-50" />
        </>
      )}
      <Maybe on={store.theme.animate}>
        <div className={cn("mx-auto grid w-full max-w-4xl justify-items-center gap-6 px-4 py-24 text-center sm:py-36", s.imageId && !gradient && "text-white")}>
          {s.subtitle && (
            <span className="rounded-full border border-current/20 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] backdrop-blur">{s.subtitle}</span>
          )}
          <Title className="text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">{title}</Title>
          {text && <PlainText text={text} className="max-w-2xl text-lg opacity-85 sm:text-xl" />}
          {button && <div className="pt-2">{button}</div>}
        </div>
      </Maybe>
    </section>
  );
}

function Maybe({ on, children }: { on: boolean; children: React.ReactNode }) {
  return on ? <Reveal>{children}</Reveal> : <>{children}</>;
}

function Features({ store, s, anchor }: Props) {
  const bg = s.background ?? "plain";
  const variant = s.variant ?? "cards";
  const list = items(s);
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
      <Heading s={s} bg={bg} />
      {variant === "list" ? (
        <ul className="mx-auto grid max-w-4xl gap-x-10 gap-y-6 sm:grid-cols-2">
          {list.map((item) => (
            <li key={item.id} className="flex gap-4">
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
        <div className={cn("grid gap-5", cols(list.length))}>
          {list.map((item) => {
            const Icon = ICONS[item.icon ?? ""] ?? Sparkles;
            return (
              <div
                key={item.id}
                className={cn(
                  "grid content-start gap-3",
                  variant === "cards" ? cn("rounded-[var(--site-radius)] p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-lg", card(bg)) : "justify-items-center p-4 text-center",
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
  const bg = s.background ?? "plain";
  const right = s.variant === "imageRight";
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <ShopImage slug={store.slug} id={s.imageId ?? null} alt={s.title ?? ""} className={cn("aspect-[4/3] w-full rounded-[var(--site-radius)] shadow-xl", right && "md:order-last")} />
        <div className="grid justify-items-start gap-4">
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
  const bg = s.background ?? "plain";
  return (
    <Frame store={store} anchor={anchor} bg={bg} narrow>
      <div className="grid justify-items-start gap-4">
        {s.subtitle && <Eyebrow text={s.subtitle} bg={bg} />}
        {s.title && <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{s.title}</h2>}
        {s.text && <PlainText text={s.text} className={cn("text-lg", strong(bg) ? "opacity-90" : "")} />}
        <ButtonOf store={store} s={s} />
      </div>
    </Frame>
  );
}

function Stats({ store, s, anchor }: Props) {
  const bg = s.background ?? "plain";
  const list = items(s);
  const cards = s.variant === "cards";
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
      <Heading s={s} bg={bg} />
      <dl className={cn("grid gap-6 text-center", list.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : list.length === 3 ? "sm:grid-cols-3" : "grid-cols-2")}>
        {list.map((item) => (
          <div key={item.id} className={cn("grid gap-1", cards && cn("rounded-[var(--site-radius)] p-6", card(bg)))}>
            <dt className={cn("order-last text-sm", quiet(bg))}>{item.title}</dt>
            <dd className={cn("site-heading text-4xl font-bold tracking-tight sm:text-5xl", !strong(bg) && "text-[var(--shop-accent)]")}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </Frame>
  );
}

function Gallery({ store, s, anchor }: Props) {
  const bg = s.background ?? "plain";
  const list = items(s).filter((i) => i.imageId);
  if (!list.length) return null;
  const masonry = s.variant === "masonry";
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
      <Heading s={s} bg={bg} />
      <div className={masonry ? "columns-2 gap-3 md:columns-3 [&>*]:mb-3" : "grid grid-cols-2 gap-3 md:grid-cols-3"}>
        {list.map((item) => (
          <figure key={item.id} className="group relative overflow-hidden rounded-[var(--site-radius)] break-inside-avoid">
            <ShopImage
              slug={store.slug}
              id={item.imageId ?? null}
              alt={item.title ?? ""}
              className={cn("w-full transition duration-500 group-hover:scale-105", masonry ? "h-auto" : "aspect-square")}
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
  const bg = s.background ?? "soft";
  const list = items(s).filter((i) => i.text);
  if (s.variant === "quote") {
    return (
      <Frame store={store} anchor={anchor} bg={bg} narrow>
        <Heading s={s} bg={bg} />
        <div className="grid gap-14">
          {list.map((item) => (
            <figure key={item.id} className="grid justify-items-center gap-6 text-center">
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
    <Frame store={store} anchor={anchor} bg={bg}>
      <Heading s={s} bg={bg} />
      <div className={cn("grid gap-5", cols(list.length))}>
        {list.map((item) => (
          <figure key={item.id} className={cn("grid content-between gap-6 rounded-[var(--site-radius)] p-7 shadow-sm", card(bg))}>
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
  const bg = s.background ?? "plain";
  const list = items(s);
  const base = `/shop/${store.slug}`;
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
      <Heading s={s} bg={bg} />
      <div className={cn("grid items-stretch gap-6", cols(list.length))}>
        {list.map((item) => {
          const href = siteHref(base, item.link) ?? "#contactForm";
          return (
            <div
              key={item.id}
              className={cn(
                "relative grid content-start gap-5 rounded-[calc(var(--site-radius)*1.25)] p-8 shadow-sm",
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
                  {lines(item.text).map((line, i) => (
                    <li key={i} className="flex gap-2">
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
  const bg = s.background ?? "plain";
  const list = items(s).filter((i) => i.title);
  return (
    <Frame store={store} anchor={anchor} bg={bg} narrow>
      <Heading s={s} bg={bg} />
      <div className={cn("divide-y rounded-[var(--site-radius)]", strong(bg) ? "divide-white/15" : "divide-[var(--site-border)]")}>
        {list.map((item) => (
          <details key={item.id} className="group py-5">
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
  const bg = s.background ?? "plain";
  const list = items(s).filter((i) => i.imageId || i.title);
  return (
    <Frame store={store} anchor={anchor} bg={bg} className="py-12 sm:py-16">
      <Heading s={s} bg={bg} />
      <ul className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
        {list.map((item) => (
          <li key={item.id} className="opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0">
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
  const bg = s.background ?? "plain";
  const round = s.variant === "round";
  const list = items(s);
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
      <Heading s={s} bg={bg} />
      <div className={cn("grid gap-8", list.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : cols(list.length))}>
        {list.map((item) => (
          <div key={item.id} className={cn("grid content-start gap-3", round && "justify-items-center text-center")}>
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
  const href = siteHref(`/shop/${store.slug}`, s.link) ?? "#contactForm";
  const button = s.buttonLabel ? (
    <Go href={href} className={cn(BUTTON, "bg-[var(--site-on-primary)] text-[var(--shop-primary)]")}>
      {s.buttonLabel} <ArrowRight className="size-4" />
    </Go>
  ) : null;
  const content = (
    <div className="grid justify-items-center gap-5 text-center">
      {s.subtitle && <span className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">{s.subtitle}</span>}
      {s.title && <h2 className="max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">{s.title}</h2>}
      {s.text && <PlainText text={s.text} className="max-w-2xl text-lg opacity-85" />}
      {button && <div className="pt-2">{button}</div>}
    </div>
  );
  if (s.variant === "card") {
    return (
      <Frame store={store} anchor={anchor} bg={s.background ?? "plain"}>
        <div className="site-gradient relative overflow-hidden rounded-[calc(var(--site-radius)*2)] px-6 py-16 text-[var(--site-on-primary)] shadow-2xl sm:px-16 sm:py-20">{content}</div>
      </Frame>
    );
  }
  return (
    <section id={anchor} className="site-gradient relative overflow-hidden text-[var(--site-on-primary)]">
      <Maybe on={store.theme.animate}>
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">{content}</div>
      </Maybe>
    </section>
  );
}

function Video({ store, s, anchor }: Props) {
  const { t } = shopWords(store);
  const src = embedOf(s.videoUrl);
  if (!src) return null;
  const bg = s.background ?? "dark";
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
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
  const bg = s.background ?? "plain";
  const base = `/shop/${store.slug}`;
  const list = items(s).flatMap((item) => {
    const href = siteHref(base, item.link);
    return href && item.title ? [{ ...item, href }] : [];
  });
  if (s.variant === "cards") {
    return (
      <Frame store={store} anchor={anchor} bg={bg}>
        <Heading s={s} bg={bg} />
        <div className={cn("grid gap-4", cols(list.length))}>
          {list.map((item) => {
            const Icon = linkIcon(item.href);
            return (
              <Go key={item.id} href={item.href} className={cn("group grid content-start gap-3 rounded-[var(--site-radius)] p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg", card(bg))}>
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
    <Frame store={store} anchor={anchor} bg={bg} narrow>
      <Heading s={s} bg={bg} />
      <div className="mx-auto grid max-w-md gap-3">
        {list.map((item) => {
          const Icon = linkIcon(item.href);
          return (
            <Go
              key={item.id}
              href={item.href}
              className={cn(
                "group flex h-14 items-center gap-3 rounded-[min(var(--site-radius),28px)] px-5 font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--shop-accent)] hover:shadow-lg",
                card(bg),
              )}
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
  const bg = s.background ?? "plain";
  const products = await storeProducts(store, s.productIds?.length ? { ids: s.productIds } : { categoryId: s.categoryId ?? null, limit: s.limit ?? 8 });
  return (
    <Frame store={store} anchor={anchor} bg={bg} className="py-12 sm:py-16">
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
  const bg = s.background ?? "plain";
  const base = `/shop/${store.slug}`;
  return (
    <Frame store={store} anchor={anchor} bg={bg} className="py-12 sm:py-16">
      <Heading s={s} bg={bg} center={false} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={`${base}/c/${c.id}`}
              className={cn("group flex h-24 items-center justify-between gap-2 rounded-[var(--site-radius)] px-5 transition hover:-translate-y-0.5 hover:shadow-lg", card(bg))}
            >
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
  const bg = s.background ?? "soft";
  const privacy = store.pages.privacy.trim() ? `/shop/${store.slug}/info/privacy` : null;
  return (
    <Frame store={store} anchor={anchor} bg={bg} narrow>
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
  const bg = s.background ?? (form ? "soft" : "plain");
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
      <Frame store={store} anchor={anchor} bg={bg} className="py-12 sm:py-16">
        <div className={cn("grid gap-3 rounded-[var(--site-radius)] p-8", card(bg))}>
          <h2 className="text-xl font-semibold">{s.title || t("store.page.contact")}</h2>
          {s.text && <PlainText text={s.text} className={quiet(bg)} />}
          {details}
        </div>
      </Frame>
    );
  }
  return (
    <Frame store={store} anchor={anchor} bg={bg}>
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
