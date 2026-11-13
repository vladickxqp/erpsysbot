import type { Metadata } from "next";
import { storeProducts } from "@/server/storefront";
import { PriceNote, ProductGrid } from "../product-grid";
import { sellingShopOf, shopWords } from "../store";
import { fieldClass, ShopButton } from "../ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { t } = shopWords(await sellingShopOf((await params).slug));
  return { title: t("store.shop.allProducts") };
}

export default async function AllProducts({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const store = await sellingShopOf((await params).slug);
  const { t } = shopWords(store);
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const products = await storeProducts(store, { q, limit: 120 });
  return (
    <div className="mx-auto grid w-full max-w-[var(--site-container)] gap-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("store.shop.allProducts")}</h1>
        <form className="flex w-full gap-2 sm:w-auto" role="search">
          <input name="q" defaultValue={q} placeholder={t("store.shop.search")} aria-label={t("store.shop.search")} className={`${fieldClass} sm:w-64`} />
          <ShopButton type="submit" variant="outline">
            {t("store.shop.searchButton")}
          </ShopButton>
        </form>
      </div>
      <ProductGrid store={store} products={products} />
      <PriceNote store={store} />
    </div>
  );
}
