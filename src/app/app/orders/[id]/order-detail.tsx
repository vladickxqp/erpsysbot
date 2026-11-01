"use client";

import { ArrowLeft, Copy, FileText, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { OrderStatusBadge } from "@/components/app/badges";
import { ItemsTable, type ItemRow } from "@/components/app/items-table";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { formatDate } from "@/i18n";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/domain";
import type { Totals } from "@/server/money";
import { deleteOrderAction, duplicateOrderAction, orderStatusAction, orderToInvoiceAction, type ActionResult } from "../actions";

export function OrderDetail({
  order,
  clientName,
  items,
  totals,
  smallBusiness,
  can,
}: {
  order: { id: string; number: number; status: OrderStatus; title: string | null; notes: string | null; dueDate: string | null; clientId: string; createdAt: string };
  clientName: string;
  items: ItemRow[];
  totals: Totals;
  smallBusiness: boolean;
  can: { update: boolean; delete: boolean; create: boolean; invoice: boolean };
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = (work: () => Promise<ActionResult>, then: (r: ActionResult) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) then(result);
      else toast.error(t(result.error === "forbidden" ? "common.forbidden" : "common.error"));
    });

  return (
    <>
      <Link href="/app/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("orders.title")}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              #{order.number} {order.title ?? ""}
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/app/clients/${order.clientId}`} className="text-primary hover:underline">
              {clientName}
            </Link>
            {" · "}
            {t("orders.created")} {formatDate(order.createdAt, locale)}
            {order.dueDate && ` · ${t("orders.dueDate")} ${formatDate(order.dueDate, locale)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can.update && (
            <Select
              value={order.status}
              onValueChange={(status) => run(() => orderStatusAction(order.id, status as OrderStatus), () => router.refresh())}
              disabled={pending}
            >
              <SelectTrigger className="w-40" aria-label={t("orders.status")}>
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
          )}
          {can.invoice && (
            <Button
              disabled={pending}
              onClick={() => run(() => orderToInvoiceAction(order.id), (r) => router.push(`/app/invoices/${r.id}`))}
            >
              <FileText className="size-4" /> {t("orders.toInvoice")}
            </Button>
          )}
          {can.update && (
            <Button variant="outline" asChild>
              <Link href={`/app/orders/${order.id}/edit`}>
                <Pencil className="size-4" /> {t("common.edit")}
              </Link>
            </Button>
          )}
          {can.create && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(() => duplicateOrderAction(order.id), (r) => router.push(`/app/orders/${r.id}`))}
            >
              <Copy className="size-4" /> <span className="sr-only sm:not-sr-only">{t("orders.duplicate")}</span>
            </Button>
          )}
          {can.delete && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> <span className="sr-only">{t("common.delete")}</span>
            </Button>
          )}
        </div>
      </div>

      <ItemsTable items={items} totals={totals} smallBusiness={smallBusiness} />
      {order.notes && <p className="mt-6 whitespace-pre-wrap rounded-xl border bg-card p-4 text-sm">{order.notes}</p>}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("orders.deleteTitle")}
        text={t("orders.deleteText", { number: order.number })}
        confirm={t("common.delete")}
        destructive
        onConfirm={() =>
          run(() => deleteOrderAction(order.id), () => {
            toast.success(t("common.deleted"));
            router.push("/app/orders");
          })
        }
      />
    </>
  );
}
