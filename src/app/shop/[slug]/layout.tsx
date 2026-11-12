import type { Metadata } from "next";
import Link from "next/link";
import { I18nProvider } from "@/i18n/client";
import { MESSAGES } from "@/i18n";
import { cn } from "@/lib/utils";
import { storeCategories } from "@/server/storefront";
import { CartLink } from "./cart-link";
import { shopOf, shopWords } from "./store";
import { brandStyle, LOOK, ShopImage } from "./ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const store = await shopOf((await params).slug);
  return {
    title: { default: store.name, template: `%s · ${store.name}` },
    description: store.design.tagline || undefined,
    robots: store.preview ? { index: false, follow: false } : undefined,
  };
}

export default async function ShopLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const store = await shopOf((await params).slug);
  const { t } = shopWords(store);
  const look = LOOK[store.design.template];
  const top = (await storeCategories(store)).filter((c) => !c.parentId).slice(0, 6);
  const base = `/shop/${store.slug}`;
  const legal = (["imprint", "privacy", "terms", "withdrawal", "shipping"] as const).filter((p) => store.pages[p].trim());
  return (
    <I18nProvider locale={store.locale} region={{ country: store.country, currency: store.currency }} messages={MESSAGES[store.locale]}>
      <div lang={store.locale} style={brandStyle(store.design)} className={cn("flex min-h-dvh flex-col", look.page)}>
        {store.preview && (
          <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">{t("store.shop.previewBanner")}</div>
        )}
        <header className={look.header}>
          <div className={cn("mx-auto flex max-w-6xl items-center gap-4 px-4 py-3", look.headerText)}>
            <Link href={base} className="flex min-w-0 items-center gap-3">
              {store.design.logoId ? (
                <ShopImage slug={store.slug} id={store.design.logoId} alt={store.name} className="h-10 w-auto max-w-40 object-contain" />
              ) : (
                <span className="truncate text-lg font-semibold">{store.name}</span>
              )}
            </Link>
            <nav className="hidden flex-1 items-center gap-1 text-sm md:flex" aria-label={t("store.shop.menu")}>
              <Link href={`${base}/products`} className="rounded-md px-3 py-2 hover:opacity-80">
                {t("store.shop.allProducts")}
              </Link>
              {top.map((c) => (
                <Link key={c.id} href={`${base}/c/${c.id}`} className="rounded-md px-3 py-2 hover:opacity-80">
                  {c.name}
                </Link>
              ))}
              {store.pages.about.trim() && (
                <Link href={`${base}/info/about`} className="rounded-md px-3 py-2 hover:opacity-80">
                  {t("store.page.about")}
                </Link>
              )}
            </nav>
            <div className="ml-auto flex items-center gap-1 md:ml-0">
              <Link href={`${base}/products`} className="rounded-md px-2 py-2 text-sm hover:opacity-80 md:hidden">
                {t("store.shop.allProducts")}
              </Link>
              <CartLink storeId={store.id} slug={store.slug} />
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200 bg-white text-sm text-slate-600">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:grid-cols-2">
            <div className="grid gap-1">
              <span className="font-medium text-slate-900">{store.company.legalName ?? store.company.name}</span>
              {store.company.street && <span>{store.company.street}</span>}
              {(store.company.postalCode || store.company.city) && <span>{[store.company.postalCode, store.company.city].filter(Boolean).join(" ")}</span>}
              {store.contactEmail && (
                <a href={`mailto:${store.contactEmail}`} className="hover:underline">
                  {store.contactEmail}
                </a>
              )}
            </div>
            <nav className="flex flex-wrap content-start gap-x-4 gap-y-2 sm:justify-end" aria-label={t("store.shop.legal")}>
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
