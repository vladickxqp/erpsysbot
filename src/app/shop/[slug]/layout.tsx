import type { Metadata } from "next";
import Link from "next/link";
import { I18nProvider } from "@/i18n/client";
import { MESSAGES } from "@/i18n";
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
  return (
    <I18nProvider locale={store.locale} region={{ country: store.country, currency: store.currency }} messages={MESSAGES[store.locale]}>
      <div lang={store.locale} data-site={store.kind} data-site-mode={store.theme.mode} style={themeStyle(store.theme)} className={cn("flex min-h-dvh flex-col antialiased", FONT_VARIABLES, LOOK.page)}>
        {store.preview && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t("store.shop.previewBanner")}</div>}
        {!store.preview && store.draft && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t("sites.draftBanner")}</div>}
        <header className={LOOK.header}>
          <div className={cn("mx-auto flex h-16 max-w-6xl items-center gap-4 px-4", LOOK.headerText)}>
            <Link href={base} className="flex min-w-0 items-center gap-3">
              {store.design.logoId ? (
                <ShopImage slug={store.slug} id={store.design.logoId} alt={store.name} className="h-9 w-auto max-w-40 object-contain" />
              ) : (
                <span className="site-heading truncate text-lg font-bold">{store.name}</span>
              )}
            </Link>
            <nav className="hidden flex-1 items-center justify-end gap-1 text-sm md:flex" aria-label={t("store.shop.menu")}>
              {menu.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-[min(var(--site-radius),10px)] px-3 py-2 font-medium opacity-80 transition hover:bg-[var(--site-soft)] hover:opacity-100">
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1 md:ml-0">
              {menu.length > 0 && <MobileMenu label={t("store.shop.menu")} items={menu} />}
              {selling && <CartLink storeId={store.id} slug={store.slug} />}
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--site-border)] bg-[var(--site-soft)] text-sm text-[var(--site-muted)]">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-2">
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
