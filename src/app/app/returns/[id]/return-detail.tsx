"use client";

import { Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { CONDITIONS, nextSteps, RECEIVED_STATES, SUPPLIER_PAID, supplierSteps, type ReturnStatus, type SupplierReturnStatus } from "@/lib/returns";
import { parseMoney } from "@/server/money";
import { Refunds } from "../../orders/[id]/after-sale";
import { moveReturnAction, moveSupplierReturnAction, openSupplierReturnsAction, saveReturnDetailsAction, type AfterSaleResult } from "../actions";

type Props = {
  ret: {
    id: string;
    number: number;
    status: ReturnStatus;
    reason: string;
    resolution: string;
    description: string | null;
    note: string | null;
    channel: string;
    refundCents: number;
    photoIds: string[];
    createdAt: string;
  };
  order: { id: string; number: number; grossCents: number; paymentStatus: string };
  client: string | null;
  items: { id: string; description: string; quantity: number; condition: string | null; restocked: number }[];
  events: { id: string; kind: string; at: string; note: string | null }[];
  supplierReturns: { id: string; supplier: string; conditions: string | null; supplierOrder: number | null; status: SupplierReturnStatus; expectedCents: number; settledCents: number | null; currency: string; reference: string | null }[];
  canSupplierReturn: boolean;
  refunds: { list: { id: string; returnId: string | null; amountCents: number; provider: string; status: string; reason: string | null; reference: string | null; createdAt: string }[]; leftCents: number; canStripe: boolean };
  can: { update: boolean; refund: boolean };
};

function useRun() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (work: () => Promise<AfterSaleResult>) =>
    start(async () => {
      const r = await work();
      if (r.ok) {
        toast.success(t("common.saved"));
        router.refresh();
      } else toast.error(t(r.error ?? "common.error"));
    });
  return { pending, run };
}

export function ReturnDetail(props: Props) {
  const { ret, order, items, can } = props;
  const { t, locale, region } = useI18n();
  const { pending, run } = useRun();
  const money = (c: number) => formatMoney(c, locale, region);
  const [note, setNote] = useState("");
  const [inspect, setInspect] = useState<Record<string, { condition: string; restock: string }>>(Object.fromEntries(items.map((i) => [i.id, { condition: i.condition ?? "AS_NEW", restock: String(i.restocked || i.quantity) }])));
  const [details, setDetails] = useState({ note: ret.note ?? "", refund: (ret.refundCents / 100).toFixed(2).replace(".", locale === "en" ? "." : ",") });
  const inspecting = ret.status === "RECEIVED" || ret.status === "INSPECTION";
  const steps = nextSteps(ret.status).filter((s) => s !== "REFUNDED");

  const step = (to: ReturnStatus) => {
    if ((to === "REJECTED" || to === "CLOSED") && !window.confirm(t(`aftersales.ask.${to}`))) return;
    const inspection =
      inspecting && (to === "INSPECTION" || to === "REFUND_PENDING")
        ? items.map((i) => ({ itemId: i.id, condition: inspect[i.id].condition as (typeof CONDITIONS)[number], restock: Number(inspect[i.id].restock.replace(",", ".")) || 0 }))
        : [];
    run(() => moveReturnAction(ret.id, to, { note: note || null, inspection }));
    setNote("");
  };

  return (
    <>
      <PageHeader
        title={t("aftersales.number", { number: ret.number })}
        actions={
          <>
            <Badge variant="outline">{t(`aftersales.status.${ret.status}`)}</Badge>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/app/orders/${order.id}`}>
                {t("aftersales.order")} {order.number}
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardContent className="grid gap-3 pt-6 text-sm">
              <div className="grid gap-1 sm:grid-cols-2">
                <span>
                  <span className="text-muted-foreground">{t("aftersales.client")}:</span> {props.client ?? "—"}
                </span>
                <span>
                  <span className="text-muted-foreground">{t("aftersales.reasonLabel")}:</span> {t(`aftersales.reason.${ret.reason}`)}
                </span>
                <span>
                  <span className="text-muted-foreground">{t("aftersales.resolutionLabel")}:</span> {t(`aftersales.resolution.${ret.resolution}`)}
                </span>
                <span>
                  <span className="text-muted-foreground">{t("aftersales.channelLabel")}:</span> {t(`aftersales.channel.${ret.channel}`)}
                </span>
              </div>
              {ret.description && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3">{ret.description}</p>}
              {ret.photoIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {ret.photoIds.map((id) => (
                    <a key={id} href={`/app/documents/${id}/file`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/app/documents/${id}/file`} alt={t("aftersales.photos")} className="size-24 rounded-md border object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("aftersales.lines")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {items.map((i) => (
                <div key={i.id} className="grid items-center gap-2 sm:grid-cols-[1fr_140px_110px]">
                  <span>
                    {i.quantity} × {i.description}
                    {i.condition && !inspecting && (
                      <span className="block text-xs text-muted-foreground">
                        {t(`aftersales.condition.${i.condition}`)} · {t("aftersales.restock")}: {i.restocked}
                      </span>
                    )}
                  </span>
                  {inspecting && can.update && (
                    <>
                      <Select value={inspect[i.id].condition} onValueChange={(condition) => setInspect({ ...inspect, [i.id]: { ...inspect[i.id], condition } })}>
                        <SelectTrigger className="w-full" aria-label={t("aftersales.conditionLabel")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONDITIONS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {t(`aftersales.condition.${c}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        value={inspect[i.id].restock}
                        onChange={(e) => setInspect({ ...inspect, [i.id]: { ...inspect[i.id], restock: e.target.value } })}
                        aria-label={t("aftersales.restock")}
                        title={t("aftersales.restock")}
                      />
                    </>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {can.update && steps.length > 0 && (
            <Card>
              <CardContent className="grid gap-3 pt-6">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("aftersales.note")} aria-label={t("aftersales.note")} maxLength={2000} />
                <div className="flex flex-wrap gap-2">
                  {steps.map((s) => (
                    <Button key={s} size="sm" variant={s === "REJECTED" || s === "CLOSED" ? "ghost" : "default"} disabled={pending} onClick={() => step(s)}>
                      {t(`aftersales.step.${s}`)}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <SupplierSide {...props} />
        </div>

        <div className="grid content-start gap-4">
          {can.update && (
            <Card>
              <CardContent className="grid gap-3 pt-6 text-sm">
                <label className="grid gap-1.5">
                  <span className="font-medium">{t("aftersales.refundPlanned")}</span>
                  <Input inputMode="decimal" value={details.refund} onChange={(e) => setDetails({ ...details, refund: e.target.value })} />
                </label>
                <label className="grid gap-1.5">
                  <span className="font-medium">{t("aftersales.note")}</span>
                  <Textarea rows={3} value={details.note} onChange={(e) => setDetails({ ...details, note: e.target.value })} maxLength={4000} />
                </label>
                <div>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => saveReturnDetailsAction(ret.id, { note: details.note || null, refundCents: parseMoney(details.refund) ?? 0 }))}>
                    {t("common.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {RECEIVED_STATES.includes(ret.status) && <Refunds orderId={order.id} refunds={props.refunds} can={can} returnId={ret.id} plannedCents={ret.refundCents} />}
          {!RECEIVED_STATES.includes(ret.status) && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {t("aftersales.refundPlanned")}: <span className="tabular-nums text-foreground">{money(ret.refundCents)}</span>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("aftersales.history")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-2 border-l pl-3 text-sm">
                {props.events.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{eventLabel(t, e.kind)}</span>
                    <span className="block text-xs text-muted-foreground">{new Date(e.at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span>
                    {e.note && <span className="block text-xs">{e.note}</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function eventLabel(t: (key: string, vars?: Record<string, string | number>) => string, kind: string): string {
  if (kind.startsWith("supplier.")) return `${t("aftersales.supplier.title")}: ${t(`aftersales.supplier.status.${kind.slice(9)}`)}`;
  if (kind === "requested" || kind === "created" || kind === "supplierReturn") return t(`aftersales.event.${kind}`);
  return t(`aftersales.status.${kind}`);
}

function SupplierSide({ supplierReturns, canSupplierReturn, ret, can }: Props) {
  const { t, locale } = useI18n();
  const { pending, run } = useRun();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  if (!supplierReturns.length && !canSupplierReturn) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("aftersales.supplier.title")}</CardTitle>
        {can.update && canSupplierReturn && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => openSupplierReturnsAction(ret.id))}>
            <Truck className="size-4" /> {t("aftersales.supplier.open")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {supplierReturns.map((s) => {
          const fmt = (c: number) => formatMoney(c, locale, { country: "DE", currency: s.currency });
          return (
            <div key={s.id} className="grid gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.supplier}</span>
                {s.supplierOrder && <span className="text-xs text-muted-foreground">#{s.supplierOrder}</span>}
                <Badge variant="outline" className="ml-auto">
                  {t(`aftersales.supplier.status.${s.status}`)}
                </Badge>
              </div>
              <span className="text-muted-foreground">
                {t("aftersales.supplier.expected")}: {fmt(s.expectedCents)}
                {s.settledCents !== null && ` · ${t("aftersales.supplier.settled")}: ${fmt(s.settledCents)}`}
                {s.reference && ` · ${s.reference}`}
              </span>
              {s.conditions && <span className="whitespace-pre-wrap text-xs text-muted-foreground">{s.conditions}</span>}
              {can.update && supplierSteps(s.status).length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input inputMode="decimal" placeholder={t("aftersales.supplier.settled")} aria-label={t("aftersales.supplier.settled")} value={amounts[s.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [s.id]: e.target.value })} />
                  <Input placeholder={t("aftersales.supplier.reference")} aria-label={t("aftersales.supplier.reference")} value={refs[s.id] ?? ""} onChange={(e) => setRefs({ ...refs, [s.id]: e.target.value })} maxLength={200} />
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    {supplierSteps(s.status).map((to) => (
                      <Button
                        key={to}
                        size="sm"
                        variant={to === "REJECTED" || to === "CLOSED" ? "ghost" : "outline"}
                        disabled={pending}
                        onClick={() => {
                          const settled = amounts[s.id]?.trim() ? (parseMoney(amounts[s.id]) ?? null) : null;
                          if (SUPPLIER_PAID.includes(to) && settled === null) return toast.error(t("aftersales.error.AMOUNT"));
                          run(() => moveSupplierReturnAction(s.id, to, { settledCents: settled, reference: refs[s.id] || null }));
                        }}
                      >
                        {t(`aftersales.supplier.status.${to}`)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
