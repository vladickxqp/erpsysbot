import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isStorePage, type StorePage } from "@/lib/store";
import { shopOf, shopWords } from "../../store";
import { PlainText } from "../../ui";

async function load(slug: string, page: string) {
  if (!isStorePage(page)) notFound();
  const store = await shopOf(slug);
  // A store's shipping page always lists the options; the others exist once they have text.
  if (page === "shipping" ? store.kind !== "store" : !store.pages[page].trim()) notFound();
  return { store, page: page as StorePage };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; page: string }> }): Promise<Metadata> {
  const { slug, page } = await params;
  const { store } = await load(slug, page);
  return { title: shopWords(store).t(`store.page.${page}`) };
}

export default async function InfoPage({ params }: { params: Promise<{ slug: string; page: string }> }) {
  const { slug, page: name } = await params;
  const { store, page } = await load(slug, name);
  const { t, money } = shopWords(store);
  const c = store.company;
  return (
    <article className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t(`store.page.${page}`)}</h1>
      {(page === "imprint" || page === "contact") && (
        <div className="grid gap-0.5 text-sm">
          <span className="font-medium">{c.legalName ?? c.name}</span>
          {c.street && <span>{c.street}</span>}
          {(c.postalCode || c.city) && <span>{[c.postalCode, c.city].filter(Boolean).join(" ")}</span>}
          {store.contactEmail && <span>{store.contactEmail}</span>}
          {c.phone && <span>{c.phone}</span>}
          {page === "imprint" && c.vatId && (
            <span>
              {t("store.shop.vatId")}: {c.vatId}
            </span>
          )}
        </div>
      )}
      {page === "shipping" && store.shipping.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {store.shipping.map((o) => (
            <li key={o.id}>
              {o.name}: {money(o.priceCents)}
              {o.freeFromCents !== null && ` · ${t("store.shop.freeFrom", { amount: money(o.freeFromCents) })}`}
            </li>
          ))}
        </ul>
      )}
      {store.pages[page].trim() && <PlainText text={store.pages[page]} className="text-sm text-slate-700" />}
    </article>
  );
}
