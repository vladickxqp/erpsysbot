import type { Metadata } from "next";
import { sellingShopOf, shopWords } from "../store";
import { CheckoutForm } from "./checkout-form";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { t } = shopWords(await sellingShopOf((await params).slug));
  return { title: t("store.shop.checkout"), robots: { index: false } };
}

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ shipping?: string }> }) {
  const store = await sellingShopOf((await params).slug);
  const { shipping } = await searchParams;
  // Named on the server: browsers name some countries differently than Node.
  const names = new Intl.DisplayNames([store.locale], { type: "region" });
  const countryName = (code: string) => names.of(code) ?? code;
  return (
    <CheckoutForm
      storeId={store.id}
      slug={store.slug}
      shipping={store.shipping}
      initialShipping={store.shipping.some((o) => o.id === shipping) ? shipping! : (store.shipping[0]?.id ?? null)}
      methods={store.methods}
      countries={store.shipCountries.map((code) => ({ code, name: countryName(code) }))}
      smallBusiness={store.smallBusiness}
      preview={store.preview}
      legal={{ terms: !!store.pages.terms.trim(), privacy: !!store.pages.privacy.trim(), withdrawal: !!store.pages.withdrawal.trim() }}
    />
  );
}
