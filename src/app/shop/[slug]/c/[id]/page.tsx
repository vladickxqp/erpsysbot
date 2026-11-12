import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { storeCategories, storeProducts } from "@/server/storefront";
import { PriceNote, ProductGrid } from "../../product-grid";
import { shopOf } from "../../store";

async function load(slug: string, id: string) {
  const store = await shopOf(slug);
  const categories = await storeCategories(store);
  const category = categories.find((c) => c.id === id);
  if (!category) notFound();
  return { store, categories, category };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { slug, id } = await params;
  return { title: (await load(slug, id)).category.name };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { store, categories, category } = await load(slug, id);
  const children = categories.filter((c) => c.parentId === category.id);
  const parent = categories.find((c) => c.id === category.parentId);
  const products = await storeProducts(store, { categoryId: category.id, limit: 120 });
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <div className="grid gap-2">
        {parent && (
          <Link href={`/shop/${store.slug}/c/${parent.id}`} className="w-fit text-sm text-slate-500 hover:underline">
            {parent.name}
          </Link>
        )}
        <h1 className="text-2xl font-semibold">{category.name}</h1>
        {children.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {children.map((c) => (
              <Link key={c.id} href={`/shop/${store.slug}/c/${c.id}`} className="rounded-full border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </div>
      <ProductGrid store={store} products={products} />
      <PriceNote store={store} />
    </div>
  );
}
