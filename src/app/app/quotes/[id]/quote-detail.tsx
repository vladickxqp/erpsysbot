"use client";

import { ShareButton } from "@/components/app/share-button";
import { ArrowLeft, Check, ClipboardList, Download, FileText, Pencil, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { QuoteStatusBadge } from "@/components/app/badges";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ItemsTable, type ItemRow } from "@/components/app/items-table";
import { SendButton } from "@/components/app/send-dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { Totals } from "@/server/money";
import { deleteQuoteAction, quoteStatusAction, quoteToInvoiceAction, quoteToOrderAction, type QuoteResult } from "../actions";

type Quote = {
  id: string;
  number: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED";
  title: string | null;
  notes: string | null;
  issueDate: string;
  validUntil: string | null;
  clientId: string;
  orderId: string | null;
  invoiceId: string | null;
  expired: boolean;
};

export function QuoteDetail({
  quote,
  clientName,
  clientEmail,
  items,
  totals,
  smallBusiness,
  mail,
  can,
}: {
  quote: Quote;
  clientName: string;
  clientEmail: string | null;
  items: ItemRow[];
  totals: Totals;
  smallBusiness: boolean;
  mail: boolean;
  can: { update: boolean; delete: boolean; order: boolean; invoice: boolean };
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = quote.status === "DRAFT" || quote.status === "SENT";

  const run = (work: () => Promise<QuoteResult>, then: (r: QuoteResult) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) then(result);
      else toast.error(t(result.error === "forbidden" ? "common.forbidden" : result.code ? `quotes.${result.code}` : "common.error"));
    });

  return (
    <>
      <Link href="/app/quotes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("quotes.title")}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {quote.number} {quote.title ?? ""}
            </h1>
            <QuoteStatusBadge status={quote.status} expired={quote.expired} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/app/clients/${quote.clientId}`} className="text-primary hover:underline">
              {clientName}
            </Link>
            {" · "}
            {formatDate(quote.issueDate, locale, region)}
            {quote.validUntil && ` · ${t("quotes.validUntil")} ${formatDate(quote.validUntil, locale, region)}`}
          </p>
          {(quote.orderId || quote.invoiceId) && (
            <p className="mt-1 flex gap-3 text-sm">
              {quote.orderId && (
                <Link href={`/app/orders/${quote.orderId}`} className="text-primary hover:underline">
                  → {t("quotes.toOrder")}
                </Link>
              )}
              {quote.invoiceId && (
                <Link href={`/app/invoices/${quote.invoiceId}`} className="text-primary hover:underline">
                  → {t("quotes.toInvoice")}
                </Link>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {can.order && !quote.orderId && quote.status !== "DECLINED" && (
            <Button disabled={pending} onClick={() => run(() => quoteToOrderAction(quote.id), (r) => router.push(`/app/orders/${r.id}`))}>
              <ClipboardList className="size-4" /> {t("quotes.toOrder")}
            </Button>
          )}
          {can.invoice && !quote.invoiceId && quote.status !== "DECLINED" && (
            <Button variant="outline" disabled={pending} onClick={() => run(() => quoteToInvoiceAction(quote.id), (r) => router.push(`/app/invoices/${r.id}`))}>
              <FileText className="size-4" /> {t("quotes.toInvoice")}
            </Button>
          )}
          {mail && can.order && <SendButton kind="quote" id={quote.id} email={clientEmail} />}
          <Button variant="outline" asChild>
            <a href={`/app/quotes/${quote.id}/pdf`} target="_blank" rel="noopener">
              <Download className="size-4" /> PDF
            </a>
          </Button>
          <ShareButton kind="quote" id={quote.id} />
          {can.update && open && (
            <>
              {quote.status === "DRAFT" && (
                <Button variant="outline" disabled={pending} onClick={() => run(() => quoteStatusAction(quote.id, "SENT"), () => router.refresh())}>
                  <Send className="size-4" /> {t("quotes.markSent")}
                </Button>
              )}
              <Button variant="outline" disabled={pending} onClick={() => run(() => quoteStatusAction(quote.id, "ACCEPTED"), () => router.refresh())}>
                <Check className="size-4" /> {t("quotes.accept")}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => run(() => quoteStatusAction(quote.id, "DECLINED"), () => router.refresh())}>
                <X className="size-4" /> {t("quotes.decline")}
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/app/quotes/${quote.id}/edit`}>
                  <Pencil className="size-4" /> {t("common.edit")}
                </Link>
              </Button>
            </>
          )}
          {can.delete && quote.status === "DRAFT" && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> <span className="sr-only">{t("common.delete")}</span>
            </Button>
          )}
        </div>
      </div>

      <ItemsTable items={items} totals={totals} smallBusiness={smallBusiness} />
      {quote.notes && <p className="mt-6 whitespace-pre-wrap rounded-xl border bg-card p-4 text-sm">{quote.notes}</p>}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("quotes.deleteTitle")}
        text={t("quotes.deleteText", { number: quote.number })}
        confirm={t("common.delete")}
        destructive
        onConfirm={() =>
          run(() => deleteQuoteAction(quote.id), () => {
            toast.success(t("common.deleted"));
            router.push("/app/quotes");
          })
        }
      />
    </>
  );
}
