"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import type { Totals } from "@/server/money";

export type ItemRow = {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  discountPercent: number;
  vatRate: number;
  netCents: number;
};

/** Lines and totals of an order or an invoice, read-only. */
export function ItemsTable({ items, totals, smallBusiness }: { items: ItemRow[]; totals: Totals; smallBusiness: boolean }) {
  const { t, locale } = useI18n();
  const money = (c: number) => formatMoney(c, locale);
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>{t("lines.description")}</TableHead>
              <TableHead className="text-right">{t("lines.quantity")}</TableHead>
              <TableHead className="text-right">{t("lines.price")}</TableHead>
              {!smallBusiness && <TableHead className="text-right">{t("lines.vat")}</TableHead>}
              <TableHead className="text-right">{t("lines.net")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="text-muted-foreground">{i.position}</TableCell>
                <TableCell className="whitespace-pre-wrap">
                  {i.description}
                  {i.discountPercent > 0 && <span className="ml-2 text-xs text-muted-foreground">−{qty.format(i.discountPercent)} %</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {qty.format(i.quantity)} {i.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(i.unitPriceCents)}</TableCell>
                {!smallBusiness && <TableCell className="text-right text-muted-foreground">{i.vatRate} %</TableCell>}
                <TableCell className="text-right tabular-nums">{money(i.netCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <dl className="ml-auto grid min-w-64 gap-1 text-sm">
        <div className="flex justify-between gap-8">
          <dt className="text-muted-foreground">{t("lines.subtotal")}</dt>
          <dd className="tabular-nums">{money(totals.netCents)}</dd>
        </div>
        {smallBusiness ? (
          <div className="text-xs text-muted-foreground">{t("lines.smallBusiness")}</div>
        ) : (
          totals.byRate.map((g) => (
            <div key={g.rate} className="flex justify-between gap-8">
              <dt className="text-muted-foreground">{t("lines.vatOn", { rate: g.rate })}</dt>
              <dd className="tabular-nums">{money(g.vatCents)}</dd>
            </div>
          ))
        )}
        <div className="mt-1 flex justify-between gap-8 border-t pt-2 text-base font-semibold">
          <dt>{t("lines.total")}</dt>
          <dd className="tabular-nums">{money(totals.grossCents)}</dd>
        </div>
      </dl>
    </div>
  );
}
