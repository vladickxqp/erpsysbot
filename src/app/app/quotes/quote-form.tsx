"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { blankLine, LineEditor, serialize, toEditable, type EditableLine, type ProductOption } from "@/components/app/line-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { saveQuoteAction } from "./actions";

export type QuoteFormValues = { id?: string; clientId: string; title: string; notes: string; validUntil: string; lines: EditableLine[] };

type Props = {
  clients: { id: string; name: string; number: number }[];
  products: ProductOption[];
  smallBusiness: boolean;
};

export function QuoteForm({ initial, clients, products, smallBusiness }: Props & { initial?: QuoteFormValues }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<QuoteFormValues>(() => {
    const start = initial ?? { clientId: "", title: "", notes: "", validUntil: "", lines: [] };
    return { ...start, lines: start.lines.length ? start.lines : [blankLine(region, locale)] };
  });
  const [pending, start] = useTransition();
  const items = serialize(v.lines);

  const submit = () =>
    start(async () => {
      if (!v.clientId || !items) {
        toast.error(t(!v.clientId ? "orders.chooseClient" : "lines.invalid"));
        return;
      }
      const result = await saveQuoteAction(v.id ?? null, {
        clientId: v.clientId,
        title: v.title,
        notes: v.notes,
        validUntil: v.validUntil || null,
        items,
      });
      if (result.ok && result.id) {
        toast.success(t("common.saved"));
        router.push(`/app/quotes/${result.id}`);
      } else toast.error(t(result.error === "forbidden" ? "common.forbidden" : result.code === "CLOSED" ? "quotes.closed" : "common.error"));
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
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("quotes.validUntil")}</span>
            <Input type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} />
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">{t("quotes.notes")}</span>
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

/** The form filled with a stored quote (lines made editable here, in the browser). */
export function QuoteEditor({
  quote,
  items,
  ...props
}: Props & { quote: Omit<QuoteFormValues, "lines">; items: Parameters<typeof toEditable>[0] }) {
  return <QuoteForm initial={{ ...quote, lines: toEditable(items) }} {...props} />;
}
