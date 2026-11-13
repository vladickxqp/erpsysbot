"use client";

import { ExternalLink, Package, Plus, Undo2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { RESOLUTIONS, RETURN_REASONS, type ReturnStatus } from "@/lib/returns";
import { CARRIERS, SHIPMENT_STATUSES } from "@/lib/shipping";
import { cn } from "@/lib/utils";
import { parseMoney } from "@/server/money";
import type { ShipmentView } from "@/server/shipments";
import { addShipmentAction, addShipmentEventAction, cancelRefundAction, createReturnAction, markRefundSentAction, refundAction, type AfterSaleResult } from "../../returns/actions";

type Line = { orderItemId: string; description: string; left: number; allowed: boolean; until: string | null };
type RefundRow = { id: string; returnId: string | null; amountCents: number; provider: string; status: string; reason: string | null; reference: string | null; createdAt: string };

type Props = {
  orderId: string;
  shipments: ShipmentView[];
  returns: { id: string; number: number; status: ReturnStatus }[];
  lines: Line[];
  refunds: { list: RefundRow[]; leftCents: number; canStripe: boolean };
  can: { update: boolean; refund: boolean };
};

function useRun() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (work: () => Promise<AfterSaleResult>, then?: () => void) =>
    start(async () => {
      const r = await work();
      if (r.ok) {
        toast.success(t("common.saved"));
        then?.();
        router.refresh();
      } else toast.error(t(r.error ?? "common.error"));
    });
  return { pending, run };
}

const STATUS_TONE: Partial<Record<string, string>> = {
  DELIVERED: "border-success/20 bg-success/10 text-success",
  EXCEPTION: "border-destructive/20 bg-destructive/10 text-destructive",
  FAILED_ATTEMPT: "border-warning/30 bg-warning/10 text-warning",
  LOST: "border-destructive/20 bg-destructive/10 text-destructive",
};

export function AfterSale(props: Props) {
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <Shipments {...props} />
      <div className="grid content-start gap-4">
        <Returns {...props} />
        <Refunds {...props} />
      </div>
    </div>
  );
}

// --- Shipments ------------------------------------------------------------------------------------

function Shipments({ orderId, shipments, can }: Props) {
  const { t, locale } = useI18n();
  const { pending, run } = useRun();
  const [adding, setAdding] = useState(false);
  const [parcel, setParcel] = useState({ carrier: "dhl", carrierName: "", trackingNumber: "", cost: "" });
  const [eventFor, setEventFor] = useState<string | null>(null);
  const [ev, setEv] = useState({ status: "IN_TRANSIT", location: "", note: "" });
  const date = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("aftersales.shipping.title")}</CardTitle>
        {can.update && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Package className="size-4" /> {t("aftersales.shipping.add")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {!shipments.length && <p className="text-sm text-muted-foreground">{t("aftersales.shipping.none")}</p>}
        {shipments.map((s) => (
          <div key={s.id} className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.carrier === "other" ? (s.carrierName ?? t("aftersales.carrier.other")) : t(`aftersales.carrier.${s.carrier}`)}</span>
              {s.trackingNumber && <span className="font-mono text-xs">{s.trackingNumber}</span>}
              {s.trackingUrl && (
                <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                  {t("aftersales.shipping.track")} <ExternalLink className="size-3" />
                </a>
              )}
              <Badge variant="outline" className={cn("ml-auto", STATUS_TONE[s.status])}>
                {t(`aftersales.shipment.${s.status}`)}
              </Badge>
              {s.problem && <Badge className="bg-destructive text-white">{t(`aftersales.problem.${s.problem}`)}</Badge>}
            </div>
            <ol className="grid gap-1 border-l pl-3 text-xs text-muted-foreground">
              {s.events.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <span className="text-foreground">{t(`aftersales.shipment.${e.status}`)}</span> · {date(e.at)}
                  {e.location && ` · ${e.location}`}
                  {e.note && ` · ${e.note}`} · {t(`aftersales.shipping.source.${e.source}`)}
                </li>
              ))}
            </ol>
            {can.update && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setEventFor(s.id)}>
                  <Plus className="size-4" /> {t("aftersales.shipping.addEvent")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("aftersales.shipping.add")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("aftersales.shipping.carrier")}</span>
              <Select value={parcel.carrier} onValueChange={(carrier) => setParcel({ ...parcel, carrier })}>
                <SelectTrigger className="w-full" aria-label={t("aftersales.shipping.carrier")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARRIERS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`aftersales.carrier.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {parcel.carrier === "other" && (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("aftersales.shipping.carrierName")}</span>
                <Input value={parcel.carrierName} onChange={(e) => setParcel({ ...parcel, carrierName: e.target.value })} maxLength={80} />
              </label>
            )}
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("aftersales.shipping.tracking")}</span>
              <Input value={parcel.trackingNumber} onChange={(e) => setParcel({ ...parcel, trackingNumber: e.target.value })} maxLength={60} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("aftersales.shipping.cost")}</span>
              <Input inputMode="decimal" value={parcel.cost} onChange={(e) => setParcel({ ...parcel, cost: e.target.value })} />
            </label>
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    addShipmentAction(orderId, {
                      carrier: parcel.carrier as (typeof CARRIERS)[number],
                      carrierName: parcel.carrierName || null,
                      trackingNumber: parcel.trackingNumber || null,
                      costCents: parcel.cost.trim() ? (parseMoney(parcel.cost) ?? null) : null,
                    }),
                  () => setAdding(false),
                )
              }
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!eventFor} onOpenChange={(o) => !o && setEventFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("aftersales.shipping.addEvent")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Select value={ev.status} onValueChange={(status) => setEv({ ...ev, status })}>
              <SelectTrigger className="w-full" aria-label={t("aftersales.shipping.addEvent")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIPMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`aftersales.shipment.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("aftersales.shipping.location")}</span>
              <Input value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })} maxLength={120} />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{t("aftersales.note")}</span>
              <Textarea rows={2} value={ev.note} onChange={(e) => setEv({ ...ev, note: e.target.value })} maxLength={500} />
            </label>
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                eventFor &&
                run(
                  () => addShipmentEventAction(eventFor, { status: ev.status as (typeof SHIPMENT_STATUSES)[number], location: ev.location || null, note: ev.note || null }),
                  () => setEventFor(null),
                )
              }
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --- Returns --------------------------------------------------------------------------------------

function Returns({ orderId, returns, lines, can }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ reason: "CHANGED_MIND", resolution: "REFUND", description: "" });
  const possible = lines.filter((l) => l.left > 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("aftersales.title")}</CardTitle>
        {can.update && possible.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Undo2 className="size-4" /> {t("aftersales.newReturn")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {!returns.length && <p className="text-muted-foreground">{t("aftersales.empty")}</p>}
        {returns.map((r) => (
          <Link key={r.id} href={`/app/returns/${r.id}`} className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-accent">
            <span className="font-medium">{t("aftersales.number", { number: r.number })}</span>
            <Badge variant="outline">{t(`aftersales.status.${r.status}`)}</Badge>
          </Link>
        ))}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("aftersales.newReturn")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            {possible.map((l) => (
              <div key={l.orderItemId} className="grid grid-cols-[1fr_96px] items-center gap-2">
                <span className={cn(!l.allowed && "text-muted-foreground")}>
                  {l.description}
                  <span className="block text-xs text-muted-foreground">
                    {l.left} {t("aftersales.left")}
                  </span>
                </span>
                <Input type="number" min={0} max={l.left} step="any" value={qty[l.orderItemId] ?? ""} onChange={(e) => setQty({ ...qty, [l.orderItemId]: e.target.value })} aria-label={l.description} />
              </div>
            ))}
            <Select value={form.reason} onValueChange={(reason) => setForm({ ...form, reason })}>
              <SelectTrigger className="w-full" aria-label={t("aftersales.reasonLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`aftersales.reason.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.resolution} onValueChange={(resolution) => setForm({ ...form, resolution })}>
              <SelectTrigger className="w-full" aria-label={t("aftersales.resolutionLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`aftersales.resolution.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("aftersales.descriptionLabel")} aria-label={t("aftersales.descriptionLabel")} maxLength={4000} />
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                const chosen = Object.entries(qty)
                  .map(([orderItemId, v]) => ({ orderItemId, quantity: Number(v.replace(",", ".")) }))
                  .filter((l) => l.quantity > 0);
                if (!chosen.length) return toast.error(t("aftersales.error.QUANTITY"));
                run(
                  async () => {
                    const r = await createReturnAction(orderId, {
                      lines: chosen,
                      reason: form.reason as (typeof RETURN_REASONS)[number],
                      resolution: form.resolution as (typeof RESOLUTIONS)[number],
                      description: form.description || null,
                    });
                    if (r.ok && r.id) router.push(`/app/returns/${r.id}`);
                    return r;
                  },
                  () => setOpen(false),
                );
              }}
            >
              {t("aftersales.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --- Refunds --------------------------------------------------------------------------------------

export function Refunds({ orderId, refunds, can, returnId, plannedCents }: Pick<Props, "orderId" | "refunds" | "can"> & { returnId?: string; plannedCents?: number }) {
  const { t, locale, region } = useI18n();
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const money = (c: number) => formatMoney(c, locale, region);
  const start = Math.min(plannedCents ?? refunds.leftCents, refunds.leftCents);
  const [v, setV] = useState({ amount: (start / 100).toFixed(2).replace(".", locale === "en" ? "." : ","), provider: refunds.canStripe ? "stripe" : "bank", reason: "", reference: "" });
  const list = returnId ? refunds.list.filter((r) => r.returnId === returnId) : refunds.list;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("aftersales.refund.title")}</CardTitle>
        {can.refund && refunds.leftCents > 0 && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Wallet className="size-4" /> {t("aftersales.refund.new")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <span className="text-muted-foreground">
          {t("aftersales.refund.left")}: <span className="tabular-nums text-foreground">{money(refunds.leftCents)}</span>
        </span>
        {list.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
            <span className="font-medium tabular-nums">{money(r.amountCents)}</span>
            <span className="text-muted-foreground">{t(`aftersales.refund.provider.${r.provider}`)}</span>
            {r.reference && <span className="font-mono text-xs">{r.reference}</span>}
            <Badge variant="outline" className="ml-auto">
              {t(`aftersales.refund.status.${r.status}`)}
            </Badge>
            {can.refund && r.provider === "bank" && r.status === "PENDING" && (
              <div className="flex w-full justify-end gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const reference = window.prompt(t("aftersales.refund.reference")) ?? null;
                    run(() => markRefundSentAction(r.id, reference));
                  }}
                >
                  {t("aftersales.refund.sent")}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelRefundAction(r.id))}>
                  {t("aftersales.refund.cancel")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("aftersales.refund.new")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <label className="grid gap-1.5">
              <span className="font-medium">{t("aftersales.refund.amount")}</span>
              <Input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
            </label>
            <Select value={v.provider} onValueChange={(provider) => setV({ ...v, provider })}>
              <SelectTrigger className="w-full" aria-label={t("aftersales.refund.way")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(refunds.canStripe ? ["stripe", "bank", "manual"] : ["bank", "manual"]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`aftersales.refund.provider.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="grid gap-1.5">
              <span className="font-medium">{t("aftersales.refund.reason")}</span>
              <Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={500} />
            </label>
            {v.provider === "manual" && (
              <label className="grid gap-1.5">
                <span className="font-medium">{t("aftersales.refund.reference")}</span>
                <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} maxLength={200} />
              </label>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => {
                const amountCents = parseMoney(v.amount) ?? 0;
                if (amountCents <= 0 || amountCents > refunds.leftCents) return toast.error(t("aftersales.error.AMOUNT"));
                if (!window.confirm(t("aftersales.refund.confirm", { amount: money(amountCents) }))) return;
                run(
                  () =>
                    refundAction(orderId, {
                      amountCents,
                      provider: v.provider as "stripe" | "bank" | "manual",
                      reason: v.reason || null,
                      reference: v.reference || null,
                      returnId: returnId ?? null,
                    }),
                  () => setOpen(false),
                );
              }}
            >
              {t("aftersales.refund.new")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
