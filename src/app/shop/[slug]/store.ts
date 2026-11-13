import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { formatMoney, MESSAGES, translator } from "@/i18n";
import { currentContext } from "@/server/request";
import { findStore, type PublicStore } from "@/server/storefront";

/** The store of this request (once per request), or the page is not found. */
export const shopOf = cache(async (slug: string): Promise<PublicStore> => {
  const store = await findStore(slug, await currentContext());
  if (!store) notFound();
  return store;
});

/** A store's own pages (catalogue, cart, checkout, orders): not part of a creator's or company website. */
export const sellingShopOf = cache(async (slug: string): Promise<PublicStore> => {
  const store = await shopOf(slug);
  if (store.kind !== "store") notFound();
  return store;
});

/** Texts and amounts in the store's own language and currency. */
export function shopWords(store: PublicStore) {
  const t = translator(MESSAGES[store.locale]);
  const money = (cents: number) => formatMoney(cents, store.locale, { country: store.country, currency: store.currency });
  return { t, money };
}
