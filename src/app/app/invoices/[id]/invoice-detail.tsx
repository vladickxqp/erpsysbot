"use client";

import { AlertTriangle, ArrowLeft, Ban, BellRing, Download, Lock, Pencil, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InvoiceStatusBadge } from "@/components/app/badges";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ItemsTable, type ItemRow } from "@/components/app/items-table";
import { SendButton } from "@/components/app/send-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { formatDate, formatMoney } from "@/i18n";
import { PAYMENT_METHODS } from "@/lib/domain";
import type { Totals } from "@/server/money";
import { cancelAction, deleteDraftAction, issueAction, paymentAction, reminderAction, type InvoiceResult } from "../actions";

type Detail = {
  id: string;
  kind: "INVOICE" | "CREDIT_NOTE";
  status: string;
  number: string | null;
  clientId: string;
  orderId: string | null;
  issueDate: string | null;
  serviceDate: string | null;
  dueDate: string | null;
  notes: string | null;
  grossCents: number;
  paidCents: number;
  smallBusiness: boolean;
  overdue: boolean;
};

export function InvoiceDetail({
  invoice,
  clientName,
  items,
  totals,
  payments,
  related,
  missingCompany,
  today,
  clientEmail,
  mail,
  reminders,
  can,
}: {
  invoice: Detail;
  clientName: string;
  items: ItemRow[];
  totals: Totals;
  payments: { id: string; amountCents: number; paidOn: string; method: string }[];
  related: { id: string; number: string | null; kind: string }[];
  missingCompany: string[];
  today: string;
  clientEmail: string | null;
  mail: boolean;
  reminders: { id: string; level: number; issueDate: string; dueDate: string; openCents: number; sentAt: string | null }[];
  can: { edit: boolean; issue: boolean; cancel: boolean; pay: boolean; settings: boolean };
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const money = (c: number) => formatMoney(c, locale);
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "issue" | "cancel" | "delete" | "pay">(null);
  const remaining = invoice.grossCents - invoice.paidCents;
  const [amount, setAmount] = useState((remaining / 100).toFixed(2).replace(".", ","));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<string>("TRANSFER");
  const draft = invoice.status === "DRAFT";
  const open = invoice.kind === "INVOICE" && ["ISSUED", "PARTIALLY_PAID"].includes(invoice.status);
  const cancellable = invoice.kind === "INVOICE" && ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(invoice.status);

  const explain = (r: InvoiceResult) => {
    if (r.error === "forbidden") return t("common.forbidden");
    if (r.code === "COMPANY_INCOMPLETE") return t("invoices.companyIncomplete", { fields: (r.missing ?? []).map((f) => t(`invoices.field_${f}`)).join(", ") });
    if (r.code === "OVERPAID") return t("invoices.overpaid");
    if (r.code === "NOT_OPEN") return t("invoices.notOpen");
    return t("common.error");
  };

  const run = (work: () => Promise<InvoiceResult>, then: (r: InvoiceResult) => void) =>
    start(async () => {
      const result = await work();
      setDialog(null);
      if (result.ok) then(result);
      else toast.error(explain(result));
    });

  return (
    <>
      <Link href="/app/invoices" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("invoices.title")}
      </Link>

      {draft && missingCompany.length > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="size-4 text-warning" />
          <span className="flex-1">
            {t("invoices.companyIncomplete", { fields: missingCompany.map((f) => t(`invoices.field_${f}`)).join(", ") })}
          </span>
          {can.settings && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/app/settings">{t("invoices.completeCompany")}</Link>
            </Button>
          )}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {invoice.kind === "CREDIT_NOTE" ? `${t("invoices.creditNote")} ` : ""}
              {invoice.number ?? t("invoices.draftNumber")}
            </h1>
            <InvoiceStatusBadge status={invoice.status} overdue={invoice.overdue} kind={invoice.kind} />
            {!draft && <Lock className="size-4 text-muted-foreground" aria-hidden />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/app/clients/${invoice.clientId}`} className="text-primary hover:underline">
              {clientName}
            </Link>
            {invoice.issueDate && ` · ${t("invoices.issueDate")} ${formatDate(invoice.issueDate, locale)}`}
            {invoice.dueDate && invoice.kind === "INVOICE" && ` · ${t("invoices.dueDate")} ${formatDate(invoice.dueDate, locale)}`}
          </p>
          {related.length > 0 && (
            <p className="mt-1 text-sm">
              {t("invoices.related")}:{" "}
              {related.map((r) => (
                <Link key={r.id} href={`/app/invoices/${r.id}`} className="mr-2 text-primary hover:underline">
                  {r.number ?? t("invoices.draftNumber")}
                </Link>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && can.issue && (
            <Button onClick={() => setDialog("issue")} disabled={pending || missingCompany.length > 0}>
              <Lock className="size-4" /> {t("invoices.issue")}
            </Button>
          )}
          {open && can.pay && (
            <Button onClick={() => setDialog("pay")} disabled={pending}>
              <Wallet className="size-4" /> {t("invoices.payment")}
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href={`/app/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener">
              <Download className="size-4" /> {t("invoices.pdf")}
            </a>
          </Button>
          {!draft && invoice.kind === "INVOICE" && (
            <Button variant="outline" asChild>
              <a href={`/app/invoices/${invoice.id}/xrechnung`} download>
                <Download className="size-4" /> XRechnung
              </a>
            </Button>
          )}
          {!draft && mail && can.edit && <SendButton kind="invoice" id={invoice.id} email={clientEmail} />}
          {invoice.overdue && can.issue && reminders.length < 3 && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(() => reminderAction(invoice.id), () => router.refresh())}
            >
              <BellRing className="size-4" /> {t(reminders.length === 0 ? "reminders.create1" : "reminders.createN")}
            </Button>
          )}
          {draft && can.edit && (
            <Button variant="outline" asChild>
              <Link href={`/app/invoices/${invoice.id}/edit`}>
                <Pencil className="size-4" /> {t("common.edit")}
              </Link>
            </Button>
          )}
          {draft && can.edit && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDialog("delete")}>
              <Trash2 className="size-4" /> <span className="sr-only">{t("common.delete")}</span>
            </Button>
          )}
          {cancellable && can.cancel && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDialog("cancel")}>
              <Ban className="size-4" /> {t("invoices.cancel")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ItemsTable items={items} totals={totals} smallBusiness={invoice.smallBusiness} />
          {invoice.notes && <p className="mt-4 whitespace-pre-wrap rounded-xl border bg-card p-4 text-sm">{invoice.notes}</p>}
        </div>
        <div className="grid h-fit gap-4">
        {invoice.kind === "INVOICE" && !draft && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("invoices.payments")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {payments.length === 0 ? (
                <p className="text-muted-foreground">{t("invoices.noPayments")}</p>
              ) : (
                payments.map((p) => (
                  <div key={p.id} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      {formatDate(p.paidOn, locale)} · {t(`invoices.${p.method}`)}
                    </span>
                    <span className="tabular-nums">{money(p.amountCents)}</span>
                  </div>
                ))
              )}
              {invoice.status !== "CANCELLED" && (
                <div className="mt-2 flex justify-between border-t pt-2 font-medium">
                  <span>{t("invoices.remaining", { amount: "" }).replace(/[:\s]+$/, "")}</span>
                  <span className="tabular-nums">{money(remaining)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {reminders.length > 0 && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("reminders.title")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {reminders.map((r) => (
                <div key={r.id} className="grid gap-2">
                  <div className="flex justify-between gap-4">
                    <span className="font-medium">{t(r.level === 1 ? "reminders.level1" : "reminders.levelN", { n: r.level })}</span>
                    <span className="tabular-nums">{money(r.openCents)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(r.issueDate, locale)} · {t("invoices.dueDate")} {formatDate(r.dueDate, locale)}
                    {r.sentAt && ` · ${t("send.sentOn", { date: formatDate(r.sentAt, locale) })}`}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/app/reminders/${r.id}/pdf`} target="_blank" rel="noopener">
                        <Download className="size-4" /> PDF
                      </a>
                    </Button>
                    {mail && can.edit && <SendButton kind="reminder" id={r.id} email={clientEmail} />}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        </div>
      </div>

      <ConfirmDialog
        open={dialog === "issue"}
        onOpenChange={(o) => setDialog(o ? "issue" : null)}
        title={t("invoices.issueTitle")}
        text={t("invoices.issueText")}
        confirm={t("invoices.issue")}
        onConfirm={() =>
          run(() => issueAction(invoice.id), () => {
            toast.success(t("common.saved"));
            router.refresh();
          })
        }
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title={t("invoices.cancelTitle")}
        text={t("invoices.cancelText")}
        confirm={t("invoices.cancel")}
        destructive
        onConfirm={() => run(() => cancelAction(invoice.id), (r) => router.push(`/app/invoices/${r.id}`))}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
        title={t("invoices.deleteTitle")}
        text={t("invoices.deleteText")}
        confirm={t("common.delete")}
        destructive
        onConfirm={() =>
          run(() => deleteDraftAction(invoice.id), () => {
            toast.success(t("common.deleted"));
            router.push("/app/invoices");
          })
        }
      />

      <Dialog open={dialog === "pay"} onOpenChange={(o) => setDialog(o ? "pay" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("invoices.payment")}</DialogTitle>
            <DialogDescription>{t("invoices.remaining", { amount: money(remaining) })}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => paymentAction(invoice.id, amount, paidOn, method), () => {
                toast.success(t("common.saved"));
                router.refresh();
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("invoices.amount")}</span>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("invoices.paidOn")}</span>
                <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("invoices.method")}</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-full" aria-label={t("invoices.method")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`invoices.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
