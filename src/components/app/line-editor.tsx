"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import { lineNet, parseMoney, totals, VAT_RATES } from "@/server/money";

export type ProductOption = { id: string; name: string; unit: string; priceCents: number; vatRate: number; description: string | null };

export type EditableLine = {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  discountPercent: string;
  vatRate: number;
};

let seq = 0;
const key = () => `l${(seq += 1)}`;

export function blankLine(): EditableLine {
  return { key: key(), productId: null, description: "", quantity: "1", unit: "Stk", price: "", discountPercent: "0", vatRate: 19 };
}

export function toEditable(lines: { productId: string | null; description: string; quantity: string | number; unit: string; unitPriceCents: number; discountPercent: string | number; vatRate: number }[]): EditableLine[] {
  return lines.map((l) => ({
    key: key(),
    productId: l.productId,
    description: l.description,
    quantity: String(Number(l.quantity)).replace(".", ","),
    unit: l.unit,
    price: (l.unitPriceCents / 100).toFixed(2).replace(".", ","),
    discountPercent: String(Number(l.discountPercent)).replace(".", ","),
    vatRate: l.vatRate,
  }));
}

const num = (text: string) => Number(text.replace(/\s/g, "").replace(",", "."));

/** The lines as the server takes them, or null while one is incomplete. */
export function serialize(lines: EditableLine[]) {
  const out = [];
  for (const l of lines) {
    const price = parseMoney(l.price);
    const quantity = num(l.quantity);
    const discount = num(l.discountPercent || "0");
    if (!l.description.trim() || price === null || !(quantity > 0) || !(discount >= 0 && discount <= 100)) return null;
    out.push({
      productId: l.productId,
      description: l.description.trim(),
      quantity,
      unit: l.unit.trim() || "Stk",
      unitPriceCents: price,
      discountPercent: discount,
      vatRate: l.vatRate,
    });
  }
  return out.length ? out : null;
}

export function LineEditor({
  lines,
  onChange,
  products,
  smallBusiness,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  products: ProductOption[];
  smallBusiness: boolean;
}) {
  const { t, locale } = useI18n();
  const money = (cents: number) => formatMoney(cents, locale);
  const set = (k: string, patch: Partial<EditableLine>) => onChange(lines.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const valid = useMemo(() => serialize(lines), [lines]);
  const sum = valid ? totals(valid, smallBusiness) : null;

  return (
    <div className="grid gap-3">
      {lines.map((l, index) => {
        const price = parseMoney(l.price);
        const net =
          price !== null && num(l.quantity) > 0
            ? lineNet({ quantity: num(l.quantity), unitPriceCents: price, discountPercent: num(l.discountPercent || "0") || 0 })
            : null;
        return (
          <div key={l.key} className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-12 sm:items-end">
            {products.length > 0 && (
              <div className="sm:col-span-12">
                <Select
                  value={l.productId ?? ""}
                  onValueChange={(id) => {
                    const p = products.find((x) => x.id === id);
                    if (p)
                      set(l.key, {
                        productId: p.id,
                        description: p.description ? `${p.name}\n${p.description}` : p.name,
                        unit: p.unit,
                        price: (p.priceCents / 100).toFixed(2).replace(".", ","),
                        vatRate: p.vatRate,
                      });
                  }}
                >
                  <SelectTrigger className="h-8 w-full text-xs sm:w-72" aria-label={t("lines.product")}>
                    <SelectValue placeholder={t("lines.fromProduct")} />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {money(p.priceCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <label className="grid gap-1 sm:col-span-5">
              <span className="text-xs text-muted-foreground">
                {index + 1}. {t("lines.description")}
              </span>
              <Input value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} required />
            </label>
            <label className="grid gap-1 sm:col-span-1">
              <span className="text-xs text-muted-foreground">{t("lines.quantity")}</span>
              <Input inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} />
            </label>
            <label className="grid gap-1 sm:col-span-1">
              <span className="text-xs text-muted-foreground">{t("lines.unit")}</span>
              <Input value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })} />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs text-muted-foreground">{t("lines.price")}</span>
              <Input inputMode="decimal" value={l.price} placeholder="0,00" onChange={(e) => set(l.key, { price: e.target.value })} />
            </label>
            <label className="grid gap-1 sm:col-span-1">
              <span className="text-xs text-muted-foreground">{t("lines.discount")}</span>
              <Input inputMode="decimal" value={l.discountPercent} onChange={(e) => set(l.key, { discountPercent: e.target.value })} />
            </label>
            {!smallBusiness && (
              <label className="grid gap-1 sm:col-span-1">
                <span className="text-xs text-muted-foreground">{t("lines.vat")}</span>
                <Select value={String(l.vatRate)} onValueChange={(v) => set(l.key, { vatRate: Number(v) })}>
                  <SelectTrigger className="w-full" aria-label={t("lines.vat")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_RATES.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} %
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <div className={`flex items-center justify-between gap-2 ${smallBusiness ? "sm:col-span-2" : "sm:col-span-1"}`}>
              <span className="text-sm tabular-nums font-medium">{net !== null ? money(net) : "—"}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("lines.remove")}
                disabled={lines.length === 1}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Button type="button" variant="outline" onClick={() => onChange([...lines, blankLine()])}>
          <Plus className="size-4" /> {t("lines.add")}
        </Button>
        <dl className="min-w-56 text-sm">
          {sum ? (
            <>
              <div className="flex justify-between gap-6 py-0.5">
                <dt className="text-muted-foreground">{t("lines.subtotal")}</dt>
                <dd className="tabular-nums">{money(sum.netCents)}</dd>
              </div>
              {smallBusiness ? (
                <div className="py-0.5 text-xs text-muted-foreground">{t("lines.smallBusiness")}</div>
              ) : (
                sum.byRate.map((g) => (
                  <div key={g.rate} className="flex justify-between gap-6 py-0.5">
                    <dt className="text-muted-foreground">{t("lines.vatOn", { rate: g.rate })}</dt>
                    <dd className="tabular-nums">{money(g.vatCents)}</dd>
                  </div>
                ))
              )}
              <div className="mt-1 flex justify-between gap-6 border-t pt-1.5 font-semibold">
                <dt>{t("lines.total")}</dt>
                <dd className="tabular-nums">{money(sum.grossCents)}</dd>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{t("lines.invalid")}</p>
          )}
        </dl>
      </div>
    </div>
  );
}
