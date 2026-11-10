"use client";

import { Check, CircleAlert, FileDown, MapPin, Pencil, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { actionsFor, CHANNELS, STEPS, type Channel, type Fulfillment, type OrderAction, type Payment } from "@/lib/order-flow";
import { cn } from "@/lib/utils";
import { orderStepAction, saveShippingAction, type FlowResult } from "../flow-actions";

type Address = { shipName: string; shipStreet: string; shipPostalCode: string; shipCity: string; shipCountry: string };
type Short = NonNullable<FlowResult["short"]>;

export type FlowPanelProps = {
  orderId: string;
  fulfillment: Fulfillment;
  payment: Payment;
  channel: Channel;
  externalRef: string | null;
  address: Address;
  carrier: string | null;
  trackingNumber: string | null;
  lines: { id: string; description: string; needed: number; available: number; enough: boolean }[];
  events: { id: string; kind: string; at: string; note: string | null; carrier: string | null; trackingNumber: string | null }[];
  hasLines: boolean;
  canUpdate: boolean;
};

/** Buttons in the order the work happens; the money's own two at the end. */
const PRIMARY: OrderAction[] = ["confirm", "pick", "pack", "ship", "deliver"];

export function OrderFlowPanel(p: FlowPanelProps) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [short, setShort] = useState<Short | null>(null);
  const [shipping, setShipping] = useState<{ carrier: string; trackingNumber: string } | null>(null);
  const [asking, setAsking] = useState<OrderAction | null>(null);
  const [editing, setEditing] = useState<(Address & { channel: Channel; externalRef: string }) | null>(null);
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const actions = p.canUpdate ? actionsFor({ fulfillment: p.fulfillment, payment: p.payment }) : [];
  const stepAt = STEPS.indexOf(p.fulfillment);
  const sent = p.fulfillment === "SHIPPED" || p.fulfillment === "DELIVERED";

  const step = (action: OrderAction, input: Parameters<typeof orderStepAction>[2] = {}, done?: () => void) =>
    start(async () => {
      const result = await orderStepAction(p.orderId, action, input);
      if (result.ok) {
        toast.success(t(`orderFlow.done.${action}`));
        done?.();
        router.refresh();
      } else if (result.short) setShort(result.short);
      else toast.error(t(result.error ?? "common.error"));
    });

  const press = (action: OrderAction) => {
    if (action === "ship") return setShipping({ carrier: p.carrier ?? "", trackingNumber: p.trackingNumber ?? "" });
    if (action === "cancel" || action === "refund" || action === "markUnpaid") return setAsking(action);
    step(action);
  };

  const address = [p.address.shipName, p.address.shipStreet, [p.address.shipPostalCode, p.address.shipCity].filter(Boolean).join(" "), p.address.shipCountry].filter(Boolean);

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="size-4" /> {t("orderFlow.title")}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={p.payment === "PAID" ? "secondary" : "outline"} className={cn(p.payment === "PAID" && "border-success/20 bg-success/10 text-success")}>
            {t(`orderFlow.payment.${p.payment}`)}
          </Badge>
          <Badge variant="outline">{t(`orderFlow.channel.${p.channel}`)}</Badge>
          {p.externalRef && <Badge variant="outline">{p.externalRef}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {p.fulfillment === "CANCELLED" ? (
          <Badge variant="outline" className="w-fit border-destructive/30 text-destructive">
            {t("orderFlow.fulfillment.CANCELLED")}
          </Badge>
        ) : (
          <ol className="grid grid-cols-5 gap-1" aria-label={t("orderFlow.title")}>
            {STEPS.map((s, i) => (
              <li key={s} className="grid gap-1.5" aria-current={i === stepAt ? "step" : undefined}>
                <span className={cn("h-1.5 rounded-full bg-muted", i <= stepAt && "bg-primary")} />
                <span className={cn("truncate text-xs", i === stepAt ? "font-medium" : "text-muted-foreground")}>{t(`orderFlow.fulfillment.${s}`)}</span>
              </li>
            ))}
          </ol>
        )}

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {PRIMARY.filter((a) => actions.includes(a)).map((a, i) => (
              <Button key={a} size="sm" variant={i === 0 ? "default" : "outline"} disabled={pending || (a === "confirm" && !p.hasLines)} onClick={() => press(a)}>
                {t(`orderFlow.action.${a}`)}
              </Button>
            ))}
            {(["markPaid", "markUnpaid", "refund"] as const)
              .filter((a) => actions.includes(a))
              .map((a) => (
                <Button key={a} size="sm" variant="outline" disabled={pending} onClick={() => press(a)}>
                  {t(`orderFlow.action.${a}`)}
                </Button>
              ))}
            {actions.includes("cancel") && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => press("cancel")}>
                {t("orderFlow.action.cancel")}
              </Button>
            )}
          </div>
        )}

        {p.lines.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {p.lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  {l.enough ? <Check className="size-4 shrink-0 text-success" aria-hidden /> : <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />}
                  <span className="truncate">{l.description}</span>
                </span>
                <span className={cn("shrink-0 tabular-nums", !l.enough && "text-destructive")}>
                  {qty.format(l.needed)} / {t("orderFlow.available", { count: qty.format(Math.max(0, l.available)) })}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <MapPin className="size-4" /> {t("orderFlow.shipTo")}
              </span>
              {p.canUpdate && (
                <Button variant="ghost" size="icon" aria-label={t("common.edit")} onClick={() => setEditing({ ...p.address, channel: p.channel, externalRef: p.externalRef ?? "" })}>
                  <Pencil className="size-4" />
                </Button>
              )}
            </div>
            {address.length ? address.map((line) => <span key={line} className="text-muted-foreground">{line}</span>) : <span className="text-muted-foreground">—</span>}
            {(p.carrier || p.trackingNumber) && (
              <span className="mt-1">
                {[p.carrier, p.trackingNumber].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          {p.events.length > 0 && (
            <ol className="grid gap-1 text-sm">
              {p.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {t(`orderFlow.event.${e.kind}`)}
                    {(e.carrier || e.trackingNumber) && <span className="text-muted-foreground"> · {[e.carrier, e.trackingNumber].filter(Boolean).join(" ")}</span>}
                    {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{formatDate(e.at, locale, region)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {p.hasLines && (
          <Button variant="outline" size="sm" className="w-fit" asChild>
            <a href={`/app/orders/${p.orderId}/packing-slip`} target="_blank" rel="noopener">
              <FileDown className="size-4" /> {t("orderFlow.packingSlip")}
            </a>
          </Button>
        )}
      </CardContent>

      <Dialog open={!!short} onOpenChange={(open) => !open && setShort(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("orderFlow.error.SHORT")}</DialogTitle>
            <DialogDescription className="sr-only">{t("orderFlow.title")}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1 text-sm">
            {short?.map((l) => (
              <li key={l.description} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{l.description}</span>
                <span className="shrink-0 tabular-nums text-destructive">
                  {qty.format(l.needed)} / {qty.format(Math.max(0, l.available))}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShort(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={pending} onClick={() => step("confirm", { allowShort: true }, () => setShort(null))}>
              {t("orderFlow.confirmAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shipping} onOpenChange={(open) => !open && setShipping(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("orderFlow.action.ship")}</DialogTitle>
            <DialogDescription className="sr-only">{t("orderFlow.title")}</DialogDescription>
          </DialogHeader>
          {shipping && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                step("ship", shipping, () => setShipping(null));
              }}
            >
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("orderFlow.carrier")}</span>
                <Input value={shipping.carrier} maxLength={80} list="carriers" onChange={(e) => setShipping({ ...shipping, carrier: e.target.value })} />
                <datalist id="carriers">
                  {["DHL", "DPD", "GLS", "Hermes", "UPS", "FedEx", "Deutsche Post"].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("orderFlow.tracking")}</span>
                <Input value={shipping.trackingNumber} maxLength={120} onChange={(e) => setShipping({ ...shipping, trackingNumber: e.target.value })} />
              </label>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {t("orderFlow.action.ship")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("orderFlow.shipTo")}</DialogTitle>
            <DialogDescription className="sr-only">{t("orderFlow.title")}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="grid grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const result = await saveShippingAction(p.orderId, { ...editing, shipCountry: editing.shipCountry || null });
                  if (result.ok) {
                    toast.success(t("common.saved"));
                    setEditing(null);
                    router.refresh();
                  } else toast.error(t(result.error ?? "common.error"));
                });
              }}
            >
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("orderFlow.channelLabel")}</span>
                <Select value={editing.channel} onValueChange={(c) => setEditing({ ...editing, channel: c as Channel })}>
                  <SelectTrigger className="w-full" aria-label={t("orderFlow.channelLabel")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`orderFlow.channel.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("orderFlow.externalRef")}</span>
                <Input value={editing.externalRef} maxLength={120} onChange={(e) => setEditing({ ...editing, externalRef: e.target.value })} />
              </label>
              {(
                [
                  ["shipName", "orderFlow.name", 2, 200],
                  ["shipStreet", "company.street", 2, 200],
                  ["shipPostalCode", "company.postalCode", 1, 20],
                  ["shipCity", "company.city", 1, 120],
                  ["shipCountry", "company.country", 1, 2],
                ] as const
              ).map(([key, label, span, max]) => (
                <label key={key} className={cn("grid gap-1.5", span === 2 && "col-span-2")}>
                  <span className="text-sm font-medium">{t(label)}</span>
                  <Input
                    value={editing[key]}
                    maxLength={max}
                    disabled={sent}
                    onChange={(e) => setEditing({ ...editing, [key]: key === "shipCountry" ? e.target.value.toUpperCase() : e.target.value })}
                  />
                </label>
              ))}
              <DialogFooter className="col-span-2">
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!asking}
        onOpenChange={(open) => !open && setAsking(null)}
        title={asking ? t(`orderFlow.ask.${asking}`) : ""}
        text={asking ? t(`orderFlow.action.${asking}`) : ""}
        confirm={asking ? t(`orderFlow.action.${asking}`) : ""}
        destructive={asking === "cancel"}
        onConfirm={() => asking && step(asking, {}, () => setAsking(null))}
      />
    </Card>
  );
}
