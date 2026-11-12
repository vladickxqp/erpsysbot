import type { Metadata } from "next";
import { shopOf, shopWords } from "../store";
import { CartView } from "./cart-view";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { t } = shopWords(await shopOf((await params).slug));
  return { title: t("store.shop.cart"), robots: { index: false } };
}

export default async function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const store = await shopOf((await params).slug);
  return <CartView storeId={store.id} slug={store.slug} shipping={store.shipping} smallBusiness={store.smallBusiness} />;
}
