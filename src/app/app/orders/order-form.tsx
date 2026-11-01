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
import { ORDER_STATUSES } from "@/lib/domain";
import { saveOrderAction } from "./actions";

export type OrderFormValues = {
  id?: string;
  clientId: string;
  status: (typeof ORDER_STATUSES)[number];
  title: string;
  notes: string;
  dueDate: string;
  lines: EditableLine[];
};

export function OrderForm({
  initial,
  clients,
  products,
  smallBusiness,
}: {
  initial?: OrderFormValues;
  clients: { id: string; name: string; number: number }[];
  products: ProductOption[];
  smallBusiness: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<OrderFormValues>(() => {
    const start = initial ?? { clientId: "", status: "NEW", title: "", notes: "", dueDate: "", lines: [] };
    return { ...start, lines: start.lines.length ? start.lines : [blankLine()] };
  });
  const [pending, start] = useTransition();
  const items = serialize(v.lines);

  const submit = () =>
    start(async () => {
      if (!v.clientId || !items) {
        toast.error(t(!v.clientId ? "orders.chooseClient" : "lines.invalid"));
        return;
      }
      const result = await saveOrderAction(v.id ?? null, {
        clientId: v.clientId,
        status: v.status,
        title: v.title,
        notes: v.notes,
        dueDate: v.dueDate || null,
        items,
      });
      if (result.ok && result.id) {
        toast.success(t("common.saved"));
        router.push(`/app/orders/${result.id}`);
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
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{t("orders.client")}</Label>
            {clients.length === 0 ? (
              <p className="text-sm">
                <Link href="/app/clients?new=1" className="text-primary hover:underline">
                  {t("orders.noClients")}
                </Link>
              </p>
            ) : (
              <Select value={v.clientId} onValueChange={(clientId) => setV({ ...v, clientId })}>
                <SelectTrigger className="w-full" aria-label={t("orders.client")}>
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
            <span className="text-sm font-medium">{t("orders.orderTitle")}</span>
            <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={200} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("orders.status")}</Label>
              <Select value={v.status} onValueChange={(status) => setV({ ...v, status: status as OrderFormValues["status"] })}>
                <SelectTrigger className="w-full" aria-label={t("orders.status")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`orders.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("orders.dueDate")}</span>
              <Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
            </label>
          </div>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">{t("orders.notes")}</span>
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
