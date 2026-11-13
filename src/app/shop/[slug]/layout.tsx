import type { Metadata } from "next";
import Link from "next/link";
import { I18nProvider } from "@/i18n/client";
import { MESSAGES } from "@/i18n";
import type { HeaderStyle } from "@/lib/site";
import { LEGAL_PAGES } from "@/lib/store";
import { cn } from "@/lib/utils";
import { storeCategories } from "@/server/storefront";
import { CartLink } from "./cart-link";
import { FONT_VARIABLES } from "./fonts";
import { MobileMenu } from "./mobile-menu";
import { shopOf, shopWords } from "./store";
import { themeStyle } from "./theme";
import { LOOK, ShopImage } from "./ui";
import "./site.css";

/** The header as the theme sets it: along at the top, fixed, centred, or floating above the page. */
const HEADER: Record<HeaderStyle, string> = {
  sticky: "sticky top-0 z-30 border-b border-[var(--site-border)] bg-[var(--site-bg)]/85 backdrop-blur-md",
  static: "relative z-30 border-b border-[var(--site-border)] bg-[var(--site-bg)]",
  centered: "sticky top-0 z-30 border-b border-[var(--site-border)] bg-[var(--site-bg)]/90 backdrop-blur-md",
  floating:
    "sticky top-3 z-30 mx-3 mt-3 rounded-[min(calc(var(--site-radius)*2),28px)] border border-[var(--site-border)] bg-[var(--site-bg)]/80 shadow-lg shadow-black/5 backdrop-blur-md sm:mx-auto sm:w-[calc(100%-2rem)] sm:max-w-[var(--site-container)]",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const store = await shopOf((await params).slug);
  return {
    title: { default: store.name, template: `%s · ${store.name}` },
    description: store.design.tagline || undefined,
    openGraph: { title: store.name, description: store.design.tagline || undefined, type: "website" },
    robots: store.preview ? { index: false, follow: false } : undefined,
  };
}

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const store = await shopOf((await params).slug);
  const { t } = shopWords(store);
  const base = `/shop/${store.slug}`;
  const selling = store.kind === "store";
  const pages = store.customPages.filter((p) => p.inMenu).map((p) => ({ href: `${base}/${p.slug}`, label: p.title }));
  const top = selling ? (await storeCategories(store)).filter((c) => !c.parentId).slice(0, pages.length ? 3 : 6) : [];
  const menu = [
    ...(selling ? [{ href: `${base}/products`, label: t("store.shop.allProducts") }, ...top.map((c) => ({ href: `${base}/c/${c.id}`, label: c.name }))] : []),
    ...pages,
    ...(store.pages.about.trim() ? [{ href: `${base}/info/about`, label: t("store.page.about") }] : []),
  ];
  const legal = LEGAL_PAGES.filter((p) => (p !== "shipping" || selling) && store.pages[p].trim());
  const logo = (
    <Link href={base} className="flex min-w-0 items-center gap-3">
      {store.design.logoId ? (
        <ShopImage slug={store.slug} id={store.design.logoId} alt={store.name} className="h-9 w-auto max-w-40 object-contain" />
      ) : (
        <span className="site-heading truncate text-lg font-bold">{store.name}</span>
      )}
    </Link>
  );
  const links = menu.map((item) => (
    <Link key={item.href} href={item.href} className="rounded-[min(var(--site-radius),10px)] px-3 py-2 font-medium opacity-80 transition hover:bg-[var(--site-soft)] hover:opacity-100">
      {item.label}
    </Link>
  ));
  const tools = (
    <div className="flex items-center gap-1">
      {menu.length > 0 && <MobileMenu label={t("store.shop.menu")} items={menu} />}
      {selling && <CartLink storeId={store.id} slug={store.slug} />}
    </div>
  );
  return (
    <I18nProvider locale={store.locale} region={{ country: store.country, currency: store.currency }} messages={MESSAGES[store.locale]}>
      <div
        lang={store.locale}
        data-site={store.kind}
        data-site-mode={store.theme.mode}
        data-weight={store.theme.headingWeight}
        data-upper={store.theme.uppercase ? "" : undefined}
        style={themeStyle(store.theme)}
        className={cn("flex min-h-dvh flex-col antialiased", FONT_VARIABLES, LOOK.page)}
      >
        {store.preview && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t("store.shop.previewBanner")}</div>}
        {!store.preview && store.draft && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t("sites.draftBanner")}</div>}
        <header className={HEADER[store.theme.header]}>
          {store.theme.header === "centered" ? (
            <div className={cn("mx-auto grid max-w-[var(--site-container)] gap-1 px-4 py-3", LOOK.headerText)}>
              <div className="relative flex h-12 items-center justify-center">
                {logo}
                <div className="absolute inset-y-0 right-0 flex items-center">{tools}</div>
              </div>
              {menu.length > 0 && (
                <nav className="hidden flex-wrap items-center justify-center gap-1 text-sm md:flex" aria-label={t("store.shop.menu")}>
                  {links}
                </nav>
              )}
            </div>
          ) : (
            <div className={cn("mx-auto flex h-16 max-w-[var(--site-container)] items-center gap-4 px-4", LOOK.headerText)}>
              {logo}
              <nav className="hidden flex-1 items-center justify-end gap-1 text-sm md:flex" aria-label={t("store.shop.menu")}>
                {links}
              </nav>
              <div className="ml-auto md:ml-0">{tools}</div>
            </div>
          )}
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--site-border)] bg-[var(--site-soft)] text-sm text-[var(--site-muted)]">
          <div className="mx-auto grid max-w-[var(--site-container)] gap-6 px-4 py-10 sm:grid-cols-2">
            <div className="grid content-start gap-1">
              <span className="font-semibold text-[var(--site-fg)]">{store.company.legalName ?? store.company.name}</span>
              {store.company.street && <span>{store.company.street}</span>}
              {(store.company.postalCode || store.company.city) && <span>{[store.company.postalCode, store.company.city].filter(Boolean).join(" ")}</span>}
              {store.contactEmail && (
                <a href={`mailto:${store.contactEmail}`} className="w-fit hover:underline">
                  {store.contactEmail}
                </a>
              )}
            </div>
            <nav className="flex flex-wrap content-start gap-x-5 gap-y-2 sm:justify-end" aria-label={t("store.shop.legal")}>
              {store.pages.contact.trim() && (
                <Link href={`${base}/info/contact`} className="hover:underline">
                  {t("store.page.contact")}
                </Link>
              )}
              {legal.map((p) => (
                <Link key={p} href={`${base}/info/${p}`} className="hover:underline">
                  {t(`store.page.${p}`)}
                </Link>
              ))}
            </nav>
          </div>
        </footer>
      </div>
    </I18nProvider>
  );
}
