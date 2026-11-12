import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/store";
import { storeCategories, storeProducts, type PublicStore } from "@/server/storefront";
import { PriceNote, ProductGrid } from "./product-grid";
import { shopOf, shopWords } from "./store";
import { LOOK, PlainText, ShopImage, ShopLinkButton } from "./ui";

export default async function ShopHome({ params }: { params: Promise<{ slug: string }> }) {
  const store = await shopOf((await params).slug);
  return (
    <div className="grid gap-10 pb-12">
      {store.blocks.map((block) => (
        <BlockView key={block.id} store={store} block={block} />
      ))}
    </div>
  );
}

async function BlockView({ store, block }: { store: PublicStore; block: Block }) {
  const { t } = shopWords(store);
  const look = LOOK[store.design.template];
  const base = `/shop/${store.slug}`;
  const heading = block.title ? <h2 className="mb-4 text-xl font-semibold">{block.title}</h2> : null;

  if (block.type === "hero") {
    return (
      <section className={cn("relative overflow-hidden", look.hero)}>
        {block.imageId && <ShopImage slug={store.slug} id={block.imageId} alt="" className="absolute inset-0 size-full opacity-40" />}
        <div className="relative mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:py-24">
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">{block.title || store.name}</h1>
          {(block.text || store.design.tagline) && <PlainText text={block.text || store.design.tagline} className="max-w-xl text-base opacity-90 sm:text-lg" />}
          <div>
            <ShopLinkButton href={`${base}/products`}>{block.buttonLabel || t("store.shop.shopNow")}</ShopLinkButton>
          </div>
        </div>
      </section>
    );
  }

  if (block.type === "products") {
    const products = await storeProducts(store, block.productIds?.length ? { ids: block.productIds } : { categoryId: block.categoryId ?? null, limit: block.limit ?? 8 });
    return (
      <section className="mx-auto w-full max-w-6xl px-4">
        {heading}
        <ProductGrid store={store} products={products} />
        <div className="mt-3">
          <PriceNote store={store} />
        </div>
      </section>
    );
  }

  if (block.type === "categories") {
    const categories = (await storeCategories(store)).filter((c) => !c.parentId);
    if (!categories.length) return null;
    return (
      <section className="mx-auto w-full max-w-6xl px-4">
        {heading}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={`${base}/c/${c.id}`} className={cn("flex h-20 items-center justify-between gap-2 px-4 hover:opacity-90", look.card, look.radius)}>
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-slate-500">{c.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (block.type === "imageText") {
    return (
      <section className="mx-auto grid w-full max-w-6xl items-center gap-6 px-4 md:grid-cols-2">
        <ShopImage slug={store.slug} id={block.imageId ?? null} alt={block.title ?? ""} className={cn("aspect-[4/3] w-full", look.radius)} />
        <div className="grid gap-3">
          {block.title && <h2 className="text-2xl font-semibold">{block.title}</h2>}
          {block.text && <PlainText text={block.text} className="text-slate-700" />}
        </div>
      </section>
    );
  }

  if (block.type === "contact") {
    const c = store.company;
    return (
      <section className="mx-auto w-full max-w-6xl px-4">
        <div className={cn("grid gap-2 p-6 text-sm", look.card, look.radius)}>
          <h2 className="text-lg font-semibold">{block.title || t("store.page.contact")}</h2>
          {block.text && <PlainText text={block.text} className="text-slate-700" />}
          <span>{c.legalName ?? c.name}</span>
          {c.street && <span>{[c.street, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</span>}
          {store.contactEmail && (
            <a href={`mailto:${store.contactEmail}`} className="w-fit text-[var(--shop-accent)] hover:underline">
              {store.contactEmail}
            </a>
          )}
          {c.phone && <span>{c.phone}</span>}
        </div>
      </section>
    );
  }

  // text
  return (
    <section className="mx-auto w-full max-w-3xl px-4">
      {heading}
      {block.text && <PlainText text={block.text} className="text-slate-700" />}
    </section>
  );
}
