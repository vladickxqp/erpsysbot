"use client";

import { Check, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { MAX_QUANTITY } from "@/lib/store";
import type { VariantOption } from "@/lib/variants";
import type { ShopVariant } from "@/server/storefront";
import { useCart } from "../../cart-store";
import { fieldClass, ShopButton } from "../../ui";

type Props = {
  storeId: string;
  slug: string;
  product: { id: string; priceCents: number; unit: string; stock: number | null; variants: ShopVariant[]; options: VariantOption[] };
};

export function BuyBox({ storeId, slug, product }: Props) {
  const { t, locale, region } = useI18n();
  const { add } = useCart(storeId);
  const money = (c: number) => formatMoney(c, locale, region);
  const hasVariants = product.variants.length > 0;
  const options = product.options.length ? product.options : [];
  const [choice, setChoice] = useState<Record<string, string>>(() => (hasVariants ? { ...product.variants.find((v) => v.available !== 0)?.options } : {}));
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const variant = useMemo(
    () => (hasVariants ? (product.variants.find((v) => Object.entries(v.options).every(([k, val]) => choice[k] === val)) ?? null) : null),
    [choice, hasVariants, product.variants],
  );
  const price = variant?.priceCents ?? product.priceCents;
  const left = hasVariants ? (variant?.available ?? 0) : product.stock;
  const soldOut = (hasVariants && !variant) || left === 0;
  const max = Math.min(MAX_QUANTITY, left ?? MAX_QUANTITY);

  return (
    <div className="grid gap-4">
      <div className="text-2xl font-semibold">{money(price)}</div>
      {options.map((o) => (
        <div key={o.name} className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">{o.name}</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={o.name}>
            {o.values.map((value) => {
              const exists = product.variants.some((v) => v.options[o.name] === value);
              if (!exists) return null;
              const active = choice[o.name] === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setChoice({ ...choice, [o.name]: value });
                    setAdded(false);
                  }}
                  className={`min-w-11 rounded-md border px-3 py-2 text-sm ${active ? "border-[var(--shop-accent)] bg-[var(--shop-accent)] text-white" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"}`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-md border border-slate-300 bg-white">
          <button type="button" className="inline-flex size-10 items-center justify-center text-slate-700 disabled:opacity-40" aria-label={t("store.shop.less")} disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
            <Minus className="size-4" />
          </button>
          <input
            className={`${fieldClass} h-10 w-14 rounded-none border-0 text-center focus:ring-0`}
            inputMode="numeric"
            aria-label={t("store.shop.quantity")}
            value={quantity}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              setQuantity(Number.isFinite(n) ? Math.max(1, Math.min(max || 1, n)) : 1);
            }}
          />
          <button type="button" className="inline-flex size-10 items-center justify-center text-slate-700 disabled:opacity-40" aria-label={t("store.shop.more")} disabled={quantity >= max} onClick={() => setQuantity(quantity + 1)}>
            <Plus className="size-4" />
          </button>
        </div>
        <ShopButton
          type="button"
          disabled={soldOut}
          onClick={() => {
            add({ productId: product.id, variantId: variant?.id ?? null, quantity });
            setAdded(true);
          }}
        >
          {soldOut ? t("store.shop.soldOut") : t("store.shop.addToCart")}
        </ShopButton>
      </div>
      {left !== null && left > 0 && left <= 5 && <p className="text-sm text-amber-700">{t("store.shop.onlyLeft", { count: left })}</p>}
      {added && (
        <p className="flex items-center gap-2 text-sm text-emerald-700">
          <Check className="size-4" /> {t("store.shop.added")}
          <Link href={`/shop/${slug}/cart`} className="font-medium underline">
            {t("store.shop.toCart")}
          </Link>
        </p>
      )}
    </div>
  );
}
