"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { blankLine, LineEditor, serialize, toEditable, type EditableLine, type ProductOption } from "@/components/app/line-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { saveRecurringAction } from "../actions";

const INTERVALS = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
type Interval = (typeof INTERVALS)[number];

type Values = {
  clientId: string;
  title: string;
  interval: Interval;
  startDate: string;
  endDate: string;
  autoIssue: boolean;
  autoSend: boolean;
  items: { productId?: string | null; description: string; quantity: number; unit: string; unitPriceCents: number; discountPercent: number; vatRate: number }[];
};

export function RecurringForm({
  id,
  initial,
  clients,
  products,
  smallBusiness,
  canIssue,
}: {
  id: string | null;
  initial: Values;
  clients: { id: string; name: string; number: number }[];
  products: ProductOption[];
  smallBusiness: boolean;
  canIssue: boolean;
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [v, setV] = useState({ ...initial });
  const [lines, setLines] = useState<EditableLine[]>(() =>
    initial.items.length ? toEditable(initial.items.map((i) => ({ ...i, productId: i.productId ?? null }))) : [blankLine(region, locale)],
  );
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const items = serialize(lines);
      if (!v.clientId || !items) {
        toast.error(t(!v.clientId ? "orders.chooseClient" : "lines.invalid"));
        return;
      }
      const res = await saveRecurringAction(id, {
        clientId: v.clientId,
        title: v.title,
        interval: v.interval,
        startDate: v.startDate,
        endDate: v.endDate || null,
        autoIssue: v.autoIssue,
        autoSend: v.autoIssue && v.autoSend,
        items,
      });
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t("common.saved"));
        router.push("/app/invoices/recurring");
      }
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
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{t("invoices.client")}</Label>
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
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="r-title">{t("recurring.titleLabel")}</Label>
            <Input id="r-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={300} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("recurring.every")}</Label>
            <Select value={v.interval} onValueChange={(interval) => setV({ ...v, interval: interval as Interval })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((i) => (
                  <SelectItem key={i} value={i}>
                    {t(`recurring.interval.${i}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="r-start">{id ? t("recurring.nextLabel") : t("recurring.start")}</Label>
              <Input id="r-start" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-end">{t("recurring.end")}</Label>
              <Input id="r-end" type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
            </div>
          </div>
          {canIssue && (
            <div className="grid gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={v.autoIssue} onCheckedChange={(c) => setV({ ...v, autoIssue: c === true, autoSend: c === true && v.autoSend })} />
                {t("recurring.autoIssue")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={v.autoSend} disabled={!v.autoIssue} onCheckedChange={(c) => setV({ ...v, autoSend: c === true })} />
                {t("recurring.autoSend")}
              </label>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("lines.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <LineEditor lines={lines} onChange={setLines} products={products} smallBusiness={smallBusiness} />
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
