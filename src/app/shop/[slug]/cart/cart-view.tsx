"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { ShippingOption } from "@/lib/store";
import { Totals, usePricedCart } from "../cart-summary";
import { useCart } from "../cart-store";
import { ShopImage, ShopLinkButton } from "../ui";

export function CartView({ storeId, slug, shipping, smallBusiness }: { storeId: string; slug: string; shipping: ShippingOption[]; smallBusiness: boolean }) {
  const { t, locale, region } = useI18n();
  const money = (c: number) => formatMoney(c, locale, region);
  const { items, ready, setQuantity } = useCart(storeId);
  const [shippingId, setShippingId] = useState<string | null>(shipping[0]?.id ?? null);
  const { cart, loading } = usePricedCart(slug, items, ready, shippingId);

  if (ready && !items.length) {
    return (
      <div className="mx-auto grid max-w-3xl justify-items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t("store.shop.cart")}</h1>
        <p className="text-slate-600">{t("store.shop.cartEmpty")}</p>
        <ShopLinkButton href={`/shop/${slug}/products`}>{t("store.shop.shopNow")}</ShopLinkButton>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[var(--site-container)] gap-8 px-4 py-8 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-4">
        <h1 className="text-2xl font-semibold">{t("store.shop.cart")}</h1>
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white" aria-busy={loading}>
          {(cart?.lines ?? []).map((l) => (
            <li key={`${l.productId}:${l.variantId ?? ""}`} className="flex gap-3 p-3">
              <ShopImage slug={slug} id={l.imageId} alt={l.name} className="size-20 shrink-0 rounded-md" />
              <div className="grid min-w-0 flex-1 gap-1">
                <Link href={`/shop/${slug}/p/${l.productId}`} className="truncate font-medium hover:underline">
                  {l.name || t("store.shop.gone")}
                </Link>
                {l.variantLabel && <span className="text-sm text-slate-500">{l.variantLabel}</span>}
                {l.problem === "GONE" && <span className="text-sm text-red-600">{t("store.shop.gone")}</span>}
                {l.problem === "SHORT" && <span className="text-sm text-red-600">{t("store.shop.onlyLeft", { count: l.available ?? 0 })}</span>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center rounded-md border border-slate-300">
                    <button type="button" className="inline-flex size-8 items-center justify-center" aria-label={t("store.shop.less")} onClick={() => setQuantity(l, l.quantity - 1)}>
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm tabular-nums">{l.quantity}</span>
                    <button type="button" className="inline-flex size-8 items-center justify-center" aria-label={t("store.shop.more")} onClick={() => setQuantity(l, l.quantity + 1)}>
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{money(l.lineCents)}</span>
                  <button type="button" className="inline-flex size-8 items-center justify-center text-slate-500 hover:text-red-600" aria-label={t("store.shop.remove")} onClick={() => setQuantity(l, 0)}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <aside className="grid content-start gap-4 rounded-md border border-slate-200 bg-white p-4">
        {shipping.length > 1 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t("store.shop.shipping")}</legend>
            {shipping.map((o) => (
              <label key={o.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <input type="radio" name="shipping" checked={shippingId === o.id} onChange={() => setShippingId(o.id)} className="accent-[var(--shop-accent)]" />
                  {o.name}
                </span>
                <span className="tabular-nums text-slate-600">{money(o.priceCents)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {cart && <Totals cart={cart} smallBusiness={smallBusiness} />}
        <ShopLinkButton href={`/shop/${slug}/checkout${shippingId ? `?shipping=${shippingId}` : ""}`} aria-disabled={!cart?.ok} className={!cart?.ok ? "pointer-events-none opacity-50" : undefined}>
          {t("store.shop.toCheckout")}
        </ShopLinkButton>
      </aside>
    </div>
  );
}
