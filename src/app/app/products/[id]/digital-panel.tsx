"use client";

import { Copy, Eye, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { addDigitalItemsAction, deleteDigitalItemAction, revealDigitalItemAction, saveDigitalSettingsAction, type DigitalResult } from "../digital-actions";

type Item = { id: string; variantId: string | null; status: string; mask: string; orderId: string | null; orderNumber: number | null; soldAt: string | null };

/** A digital product's delivery: the note every buyer reads, and the pool of entries each sale takes from. */
export function DigitalPanel({
  productId,
  shared,
  note,
  available,
  sold,
  waiting,
  items,
  variants,
  canManage,
}: {
  productId: string;
  shared: boolean;
  note: string;
  available: number;
  sold: number;
  waiting: number;
  items: Item[];
  variants: { id: string; label: string }[];
  canManage: boolean;
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ shared, note });
  const [text, setText] = useState("");
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const [shown, setShown] = useState<Record<string, string>>({});

  const run = (work: () => Promise<DigitalResult>, then?: (r: DigitalResult) => void) =>
    start(async () => {
      const result = await work();
      if (!result.ok) return void toast.error(t(result.error ?? "common.error"));
      if (then) then(result);
      else toast.success(t("common.saved"));
      router.refresh();
    });
  const copy = (content: string) => {
    void navigator.clipboard?.writeText(content);
    toast.success(t("digital.copied"));
  };
  const labelOf = (id: string | null) => variants.find((x) => x.id === id)?.label ?? "";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="h-fit">
        <CardContent className="grid gap-4 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={v.shared} onCheckedChange={(c) => setV({ ...v, shared: c === true })} disabled={!canManage} /> {t("digital.shared")}
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t("digital.note")}</span>
            <Textarea rows={4} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} maxLength={4000} disabled={!canManage} />
          </label>
          {canManage && (
            <div>
              <Button type="button" disabled={pending} onClick={() => run(() => saveDigitalSettingsAction(productId, v))}>
                {t("common.save")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!shared && (
        <Card className="h-fit">
          <CardContent className="grid gap-4 pt-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="border-success/20 bg-success/10 text-success">
                {t("digital.available")}: {available}
              </Badge>
              <Badge variant="outline">
                {t("digital.sold")}: {sold}
              </Badge>
              {waiting > 0 && (
                <Badge variant="outline" className="border-destructive/30 text-destructive">
                  {t("digital.waiting")}: {waiting}
                </Badge>
              )}
            </div>
            {canManage && (
              <>
                {variants.length > 0 && (
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("digital.variant")}</span>
                    <Select value={variantId} onValueChange={setVariantId}>
                      <SelectTrigger className="w-full" aria-label={t("digital.variant")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {variants.map((x) => (
                          <SelectItem key={x.id} value={x.id}>
                            {x.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("digital.entries")}</span>
                  <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-sm" autoComplete="off" spellCheck={false} />
                </label>
                <div>
                  <Button
                    type="button"
                    disabled={pending || !text.trim() || (variants.length > 0 && !variantId)}
                    onClick={() =>
                      run(
                        () => addDigitalItemsAction(productId, variants.length ? variantId : null, text),
                        (r) => {
                          setText("");
                          toast.success(t("digital.added", { count: String(r.added ?? 0) }));
                        },
                      )
                    }
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t("digital.add")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {!shared && items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card lg:col-span-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("digital.entry")}</TableHead>
                {variants.length > 0 && <TableHead>{t("digital.variant")}</TableHead>}
                <TableHead>{t("orders.status")}</TableHead>
                <TableHead>{t("digital.order")}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-72 break-all font-mono text-xs">{shown[item.id] ?? item.mask}</TableCell>
                  {variants.length > 0 && <TableCell className="text-muted-foreground">{labelOf(item.variantId)}</TableCell>}
                  <TableCell>
                    <Badge variant="outline" className={item.status === "AVAILABLE" ? "border-success/20 bg-success/10 text-success" : undefined}>
                      {t(`digital.status.${item.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.orderId ? (
                      <Link href={`/app/orders/${item.orderId}`} className="hover:underline">
                        #{item.orderNumber}
                        {item.soldAt ? ` · ${formatDate(item.soldAt, locale, region)}` : ""}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <div className="flex justify-end">
                        {shown[item.id] ? (
                          <Button type="button" variant="ghost" size="icon" aria-label={t("digital.copy")} onClick={() => copy(shown[item.id])}>
                            <Copy className="size-4" />
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("digital.show")}
                            disabled={pending}
                            onClick={() => run(() => revealDigitalItemAction(item.id), (r) => setShown((s) => ({ ...s, [item.id]: r.content ?? "" })))}
                          >
                            <Eye className="size-4" />
                          </Button>
                        )}
                        {item.status === "AVAILABLE" && (
                          <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} disabled={pending} onClick={() => run(() => deleteDigitalItemAction(item.id))}>
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
