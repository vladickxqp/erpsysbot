import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import { storeProduct } from "@/server/storefront";
import { PriceNote } from "../../product-grid";
import { sellingShopOf, shopWords } from "../../store";
import { LOOK, PlainText, ShopImage } from "../../ui";
import { BuyBox } from "./buy-box";

async function load(slug: string, id: string) {
  const store = await sellingShopOf(slug);
  const product = await storeProduct(store, id);
  if (!product) notFound();
  return { store, product };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { slug, id } = await params;
  const { product } = await load(slug, id);
  return { title: product.name, description: product.description?.slice(0, 160) || undefined };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { store, product } = await load(slug, id);
  const { t } = shopWords(store);
  const look = LOOK;
  const [main, ...more] = product.images;
  const facts = Object.entries(product.attributes).filter(([k, v]) => k.trim() && v.trim());
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 md:grid-cols-2">
      <div className="grid content-start gap-3">
        <ShopImage slug={store.slug} id={main ?? null} alt={product.name} className={cn("aspect-square w-full", look.radius)} />
        {more.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {more.slice(0, 8).map((img) => (
              <ShopImage key={img} slug={store.slug} id={img} alt={product.name} className={cn("aspect-square w-full", look.radius)} />
            ))}
          </div>
        )}
      </div>
      <div className="grid content-start gap-5">
        <h1 className="text-2xl font-semibold sm:text-3xl">{product.name}</h1>
        <BuyBox
          storeId={store.id}
          slug={store.slug}
          product={{ id: product.id, priceCents: product.priceCents, unit: product.unit, stock: product.stock, variants: product.variants, options: product.options }}
        />
        <PriceNote store={store} />
        {product.description && <PlainText text={product.description} className="text-sm text-slate-700" />}
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {(product.shippingNote || product.returnable) && (
          <div className="grid gap-1 text-sm text-slate-600">
            {product.shippingNote && <span>{product.shippingNote}</span>}
            {product.returnable && product.returnDays ? <span>{t("store.shop.returnDays", { days: product.returnDays })}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
