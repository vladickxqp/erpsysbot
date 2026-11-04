"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { blankLine, LineEditor, serialize, type EditableLine, type ProductOption } from "@/components/app/line-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { saveDraftAction } from "./actions";

export type InvoiceFormValues = {
  id?: string;
  clientId: string;
  serviceDate: string;
  dueDate: string;
  notes: string;
  lines: EditableLine[];
  currency?: string;
  exchangeRate?: string;
};

export function InvoiceForm({
  initial,
  clients,
  products,
  smallBusiness,
}: {
  initial?: InvoiceFormValues;
  clients: { id: string; name: string; number: number }[];
  products: ProductOption[];
  smallBusiness: boolean;
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<InvoiceFormValues>(() => {
    const start = initial ?? { clientId: "", serviceDate: "", dueDate: "", notes: "", lines: [] };
    return { ...start, lines: start.lines.length ? start.lines : [blankLine(region, locale)] };
  });
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const items = serialize(v.lines);
      if (!v.clientId || !items) {
        toast.error(t(!v.clientId ? "orders.chooseClient" : "lines.invalid"));
        return;
      }
      const result = await saveDraftAction(v.id ?? null, {
        clientId: v.clientId,
        serviceDate: v.serviceDate || null,
        dueDate: v.dueDate || null,
        notes: v.notes,
        items,
        currency: v.currency && v.currency !== region.currency ? v.currency : null,
        exchangeRate: v.exchangeRate ? Number(v.exchangeRate.replace(",", ".")) : null,
      });
      if (result.ok && result.id) {
        toast.success(t("common.saved"));
        router.push(`/app/invoices/${result.id}`);
      } else toast.error(t(result.error === "forbidden" ? "common.forbidden" : "common.error"));
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div className="grid gap-1.5 sm:col-span-3">
            <Label>{t("invoices.client")}</Label>
            {clients.length === 0 ? (
              <Link href="/app/clients?new=1" className="text-sm text-primary hover:underline">
                {t("orders.noClients")}
              </Link>
            ) : (
              <Select value={v.clientId} onValueChange={(clientId) => setV({ ...v, clientId })}>
                <SelectTrigger className="w-full" aria-label={t("invoices.client")}>
                  <SelectValue placeholder={t("orders.chooseClient")} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-muted-foreground">#{c.number}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("invoices.serviceDate")}</span>
            <Input type="date" value={v.serviceDate} onChange={(e) => setV({ ...v, serviceDate: e.target.value })} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("invoices.dueDate")}</span>
            <Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
            <span className="text-xs text-muted-foreground">{t("invoices.dueHint")}</span>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("company.currency")}</span>
            <Input value={v.currency ?? region.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase().slice(0, 3) })} maxLength={3} />
          </label>
          {(v.currency ?? region.currency) !== region.currency && (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("invoices.rate", { from: v.currency ?? "", to: region.currency })}</span>
              <Input inputMode="decimal" value={v.exchangeRate ?? ""} onChange={(e) => setV({ ...v, exchangeRate: e.target.value })} required />
            </label>
          )}
          <label className="grid gap-1.5 sm:col-span-3">
            <span className="text-sm font-medium">{t("invoices.notes")}</span>
            <Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("lines.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineEditor lines={v.lines} onChange={(lines) => setV({ ...v, lines })} products={products} smallBusiness={smallBusiness} />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
