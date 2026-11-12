"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatMoney, formatRate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { CartItem } from "@/lib/store";
import { priceCartAction, type CartView } from "./actions";

/** The cart as the server prices it, again whenever it or the shipping choice changes. */
export function usePricedCart(slug: string, items: CartItem[], ready: boolean, shippingId: string | null) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [loading, start] = useTransition();
  const asked = useRef(0);
  const key = JSON.stringify(items) + (shippingId ?? "");
  useEffect(() => {
    if (!ready) return;
    const ask = ++asked.current;
    start(async () => {
      const priced = items.length ? await priceCartAction(slug, items, shippingId) : null;
      // Only the latest answer counts.
      if (ask === asked.current) setCart(priced);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, slug]);
  return { cart, loading };
}

export function Totals({ cart, smallBusiness }: { cart: CartView; smallBusiness: boolean }) {
  const { t, locale, region } = useI18n();
  const money = (c: number) => formatMoney(c, locale, region);
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      <dt className="text-slate-600">{t("store.shop.goods")}</dt>
      <dd className="text-right tabular-nums">{money(cart.goodsCents)}</dd>
      <dt className="text-slate-600">{t("store.shop.shipping")}</dt>
      <dd className="text-right tabular-nums">{cart.shippingCents === null ? "–" : cart.shippingCents === 0 ? t("store.shop.free") : money(cart.shippingCents)}</dd>
      <dt className="mt-2 border-t border-slate-200 pt-2 font-semibold">{t("store.shop.total")}</dt>
      <dd className="mt-2 border-t border-slate-200 pt-2 text-right font-semibold tabular-nums">{money(cart.grossCents)}</dd>
      {smallBusiness ? (
        <dd className="col-span-2 text-xs text-slate-500">{t("store.shop.noVat")}</dd>
      ) : (
        cart.byRate.map((r) => (
          <div key={r.rate} className="contents text-xs text-slate-500">
            <dt>{t("store.shop.vatIncluded", { rate: formatRate(r.rate, locale, region) })}</dt>
            <dd className="text-right tabular-nums">{money(r.vatCents)}</dd>
          </div>
        ))
      )}
    </dl>
  );
}
