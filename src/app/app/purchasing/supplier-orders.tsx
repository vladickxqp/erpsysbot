"use client";

import { CircleAlert, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { supplierActionsFor, type SupplierOrderAction, type SupplierOrderStatus } from "@/lib/dropship";
import { cn } from "@/lib/utils";
import type { SupplierOrderView } from "@/server/dropship";
import { supplierOrderStepAction } from "./dropship-actions";

const TONE: Partial<Record<SupplierOrderStatus, string>> = {
  APPROVAL: "border-warning/40 bg-warning/10 text-warning",
  READY: "border-warning/40 bg-warning/10 text-warning",
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  REJECTED: "border-destructive/30 bg-destructive/10 text-destructive",
  OUT_OF_STOCK: "border-destructive/30 bg-destructive/10 text-destructive",
  SHIPPED: "border-success/20 bg-success/10 text-success",
  DELIVERED: "border-success/20 bg-success/10 text-success",
};

/** The buttons in the order the work happens; cancel last. */
const ORDER: SupplierOrderAction[] = ["approve", "send", "markSubmitted", "confirm", "ship", "deliver", "retry", "reject", "outOfStock", "cancel"];
/** These ask for the supplier's numbers first. */
const WITH_DETAILS: SupplierOrderAction[] = ["markSubmitted", "confirm", "ship"];
/** These ask before they happen. */
const ASK: SupplierOrderAction[] = ["approve", "reject", "outOfStock", "cancel"];

type Details = { action: SupplierOrderAction; externalRef: string; carrier: string; trackingNumber: string };

export function SupplierOrderCard({ so, canManage, showOrder = false }: { so: SupplierOrderView; canManage: boolean; showOrder?: boolean }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [details, setDetails] = useState<Details | null>(null);
  const [asking, setAsking] = useState<SupplierOrderAction | null>(null);
  const money = (cents: number) => formatMoney(cents, locale, { ...region, currency: so.currency });
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const actions = canManage ? supplierActionsFor(so.status, so.method) : [];
  const margin = so.saleCents > 0 && so.currency === region.currency ? Math.round(((so.saleCents - so.costCents) / so.saleCents) * 1000) / 10 : null;
  const [code, status] = (so.lastError ?? "").split(" ");

  const step = (action: SupplierOrderAction, input: Partial<Omit<Details, "action">> = {}, done?: () => void) =>
    start(async () => {
      const result = await supplierOrderStepAction(so.id, action, input);
      if (result.ok) {
        toast.success(t(`dropship.status.${statusAfter(action)}`));
        done?.();
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });

  const press = (action: SupplierOrderAction) => {
    if (WITH_DETAILS.includes(action)) return setDetails({ action, externalRef: so.externalRef ?? "", carrier: so.carrier ?? "", trackingNumber: so.trackingNumber ?? "" });
    if (ASK.includes(action)) return setAsking(action);
    step(action);
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          #{so.number} · <Link href={`/app/purchasing/suppliers/${so.supplierId}`} className="hover:underline">{so.supplier}</Link>
        </span>
        <Badge variant="outline" className={cn(TONE[so.status])}>
          {t(`dropship.status.${so.status}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">{t(`dropship.method.${so.method}`)}</span>
        {showOrder && (
          <Link href={`/app/orders/${so.orderId}`} className="ml-auto text-sm text-muted-foreground hover:text-foreground hover:underline">
            {t("dropship.col.order")} #{so.orderNumber} · {so.client}
          </Link>
        )}
      </div>

      {so.status === "APPROVAL" && so.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {so.reasons.map((r) => (
            <Badge key={r} variant="outline" className="border-warning/40 text-xs">
              {t(`dropship.reason.${r}`)}
            </Badge>
          ))}
        </div>
      )}

      <ul className="grid gap-1 text-sm">
        {so.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {qty.format(i.quantity)} × {i.supplierSku && <span className="text-muted-foreground">{i.supplierSku} · </span>}
              {i.description}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{money(Math.round(i.quantity * (i.unitCostCents + i.shippingCostCents)))}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span>
          {t("dropship.panel.cost")}: <span className="tabular-nums">{money(so.costCents)}</span>
        </span>
        <span>
          {t("dropship.panel.sale")}: <span className="tabular-nums">{money(so.saleCents)}</span>
        </span>
        {margin !== null && (
          <span className={cn(margin < 0 && "text-destructive")}>
            {t("dropship.panel.margin")}: <span className="tabular-nums">{margin} %</span>
          </span>
        )}
        {so.externalRef && (
          <span>
            {t("dropship.panel.externalRef")}: {so.externalRef}
          </span>
        )}
        {(so.carrier || so.trackingNumber) && <span>{[so.carrier, so.trackingNumber].filter(Boolean).join(" · ")}</span>}
      </div>

      {so.lastError && (so.status === "FAILED" || so.status === "SENDING") && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-destructive">
          <CircleAlert className="size-4" />
          {t(`dropship.error.${code}`)}
          {status && <span className="tabular-nums">{status}</span>}
          {so.status === "SENDING" && so.nextAttemptAt && <span className="text-muted-foreground">· {t("dropship.panel.nextTry", { date: formatDate(so.nextAttemptAt, locale, region) })}</span>}
          <span className="text-muted-foreground">· {t("dropship.panel.attempts", { count: so.attempts })}</span>
        </p>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ORDER.filter((a) => actions.includes(a)).map((a, i) => (
            <Button
              key={a}
              size="sm"
              variant={a === "cancel" ? "ghost" : i === 0 ? "default" : "outline"}
              className={cn(a === "cancel" && "text-destructive hover:text-destructive")}
              disabled={pending}
              onClick={() => press(a)}
            >
              {t(`dropship.action.${a}`)}
            </Button>
          ))}
        </div>
      )}

      <Dialog open={!!details} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{details ? t(`dropship.action.${details.action}`) : ""}</DialogTitle>
            <DialogDescription className="sr-only">{t("dropship.panel.title")}</DialogDescription>
          </DialogHeader>
          {details && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                step(details.action, { externalRef: details.externalRef, carrier: details.carrier, trackingNumber: details.trackingNumber }, () => setDetails(null));
              }}
            >
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("dropship.panel.externalRef")}</span>
                <Input value={details.externalRef} maxLength={120} onChange={(e) => setDetails({ ...details, externalRef: e.target.value })} />
              </label>
              {details.action === "ship" && (
                <>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("orderFlow.carrier")}</span>
                    <Input value={details.carrier} maxLength={80} list="supplier-carriers" onChange={(e) => setDetails({ ...details, carrier: e.target.value })} />
                    <datalist id="supplier-carriers">
                      {["DHL", "DPD", "GLS", "Hermes", "UPS", "FedEx", "Deutsche Post"].map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("orderFlow.tracking")}</span>
                    <Input value={details.trackingNumber} maxLength={120} onChange={(e) => setDetails({ ...details, trackingNumber: e.target.value })} />
                  </label>
                </>
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {t(`dropship.action.${details.action}`)}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!asking}
        onOpenChange={(open) => !open && setAsking(null)}
        title={
          asking === "cancel"
            ? t(so.status === "SUBMITTED" || so.status === "CONFIRMED" ? "dropship.panel.askCancelSent" : "dropship.panel.askCancel")
            : asking === "approve"
              ? t("dropship.panel.askApprove")
              : asking
                ? t(`dropship.action.${asking}`)
                : ""
        }
        text={`#${so.number} · ${so.supplier} · ${money(so.costCents)}`}
        confirm={asking ? t(`dropship.action.${asking}`) : ""}
        destructive={asking === "cancel" || asking === "reject" || asking === "outOfStock"}
        onConfirm={() => asking && step(asking, {}, () => setAsking(null))}
      />
    </div>
  );
}

function statusAfter(action: SupplierOrderAction): SupplierOrderStatus {
  const after: Record<SupplierOrderAction, SupplierOrderStatus> = {
    approve: "READY",
    send: "SENDING",
    markSubmitted: "SUBMITTED",
    confirm: "CONFIRMED",
    reject: "REJECTED",
    outOfStock: "OUT_OF_STOCK",
    ship: "SHIPPED",
    deliver: "DELIVERED",
    retry: "APPROVAL",
    cancel: "CANCELLED",
  };
  return after[action];
}

export function SupplierOrderList({ orders, canManage, showOrder = false }: { orders: SupplierOrderView[]; canManage: boolean; showOrder?: boolean }) {
  const { t } = useI18n();
  if (!orders.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <PackageCheck className="size-4" /> {t("dropship.empty")}
      </p>
    );
  return (
    <div className="grid gap-3">
      {orders.map((so) => (
        <SupplierOrderCard key={so.id} so={so} canManage={canManage} showOrder={showOrder} />
      ))}
    </div>
  );
}
