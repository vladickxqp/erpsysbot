"use client";

import { Ban, Copy, Download, Eye, FileMinus2, Mail, MoreHorizontal, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { sendInvoiceAction } from "@/app/app/send-actions";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { InvoicePaper, type PaperData } from "@/components/app/invoice-paper";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { INVOICE_FILE_KINDS, type InvoiceFileKind } from "@/lib/invoicing";
import { lineNet, totals } from "@/server/money";
import { cancelAction, creditLinesAction, creditNoteAction, duplicateAction, invoicePaperAction, type CreditLine, type InvoiceResult } from "./actions";

function useExplain() {
  const { t } = useI18n();
  return (r: InvoiceResult) => {
    if (r.error === "forbidden") return t("common.forbidden");
    if (r.code === "COMPANY_INCOMPLETE") return t("invoices.companyIncomplete", { fields: (r.missing ?? []).map((f) => t(`invoices.field_${f}`)).join(", ") });
    if (r.code === "OVER_CREDITED") return t("invoicing.overCredited");
    if (r.code === "NOT_CANCELLABLE") return t("invoicing.notCancellable");
    return t("common.error");
  };
}

/** Sends the invoice in the format the customer takes. */
export function SendInvoiceDialog({
  id,
  email,
  format,
  resend,
  onClose,
}: {
  id: string;
  email: string | null;
  format: InvoiceFileKind;
  resend?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [to, setTo] = useState(email ?? "");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<InvoiceFileKind>(format);
  const [pending, start] = useTransition();
  const title = t(resend ? "invoicing.resend" : "invoicing.send");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await sendInvoiceAction(id, to, message, kind);
              router.refresh();
              if (result.ok) {
                toast.success(t("send.sent"));
                onClose();
              } else if (result.error === "NOT_READY") {
                toast.error(t("invoicing.send_NOT_READY", { fields: (result.missing ?? []).map((m) => t(`invoicing.missing_${m}`)).join(", ") }));
              } else if (result.error === "REFUSED" || result.error === "DAMAGED") {
                toast.error(t(`invoicing.send_${result.error}`));
              } else toast.error(t(`send.${result.error ?? "failed"}`));
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`invoice-to-${id}`}>{t("send.to")}</Label>
            <Input id={`invoice-to-${id}`} type="email" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("invoicing.format")}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as InvoiceFileKind)}>
              <SelectTrigger className="w-full" aria-label={t("invoicing.format")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_FILE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`invoicing.format_${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`invoice-text-${id}`}>{t("send.message")}</Label>
            <Textarea id={`invoice-text-${id}`} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("send.standard")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              <Send className="size-4" /> {pending ? t("common.loading") : t("send.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Takes back some lines of an invoice, or some of their quantity. */
export function CreditNoteDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const explain = useExplain();
  const [data, setData] = useState<{ lines: CreditLine[]; openCents: number; currency: string | null; smallBusiness: boolean } | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    void creditLinesAction(id).then((result) => {
      if (result) setData(result);
      else onClose();
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const money = (c: number) => formatMoney(c, locale, { ...region, currency: data?.currency ?? region.currency });
  const quantity = (text: string | undefined) => Number((text ?? "").replace(",", ".")) || 0;
  const picked = (data?.lines ?? []).filter((l) => quantity(chosen[l.id]) > 0).map((l) => ({ ...l, quantity: quantity(chosen[l.id]) }));
  const sum = totals(picked, data?.smallBusiness ?? false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("invoicing.credit")}</DialogTitle>
          <DialogDescription className="sr-only">{t("invoicing.credit")}</DialogDescription>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await creditNoteAction(id, { reason, lines: picked.map((l) => ({ itemId: l.id, quantity: l.quantity })) });
                if (result.ok && result.id) {
                  toast.success(t("common.saved"));
                  router.push(`/app/invoices/${result.id}`);
                  onClose();
                } else toast.error(explain(result));
              });
            }}
          >
            <ul className="grid gap-2">
              {data.lines.map((line) => (
                <li key={line.id} className="grid grid-cols-[auto_minmax(0,1fr)_5.5rem] items-center gap-3 rounded-lg border bg-background p-2 text-sm">
                  <Checkbox
                    aria-label={line.description}
                    checked={quantity(chosen[line.id]) > 0}
                    onCheckedChange={(on) => setChosen({ ...chosen, [line.id]: on === true ? String(line.quantity) : "" })}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{line.description}</span>
                    <span className="text-xs text-muted-foreground">
                      {line.quantity} {line.unit} · {money(lineNet(line))}
                    </span>
                  </span>
                  <Input inputMode="decimal" aria-label={t("lines.quantity")} value={chosen[line.id] ?? ""} placeholder="0" onChange={(e) => setChosen({ ...chosen, [line.id]: e.target.value })} />
                </li>
              ))}
            </ul>
            <div className="grid gap-1.5">
              <Label htmlFor={`credit-reason-${id}`}>{t("invoicing.creditReason")}</Label>
              <Input id={`credit-reason-${id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <div className="flex justify-between text-sm font-medium">
              <span>{t("invoicing.creditTotal")}</span>
              <span className="tabular-nums">{money(sum.grossCents)}</span>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending || !picked.length}>
                {pending ? t("common.loading") : t("invoicing.creditCreate")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The invoice on screen, without leaving the list. */
function PaperDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const [paper, setPaper] = useState<PaperData | null>(null);
  useEffect(() => {
    void invoicePaperAction(id).then((result) => {
      if (result) setPaper(result);
      else onClose();
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("invoicing.preview")}</DialogTitle>
          <DialogDescription className="sr-only">{t("invoicing.preview")}</DialogDescription>
        </DialogHeader>
        {paper ? <InvoicePaper data={paper} /> : <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        <DialogFooter>
          <Button variant="outline" asChild>
            <a href={`/app/invoices/${id}/pdf`} target="_blank" rel="noopener">
              <Download className="size-4" /> {t("invoices.pdf")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type InvoiceRow = { id: string; kind: string; status: string; number: string | null; sentAt: Date | string | null; creditedCents: number; clientEmail: string | null };

/** What can be done with one invoice of the list. */
export function InvoiceRowActions({
  invoice,
  can,
  mail,
  format,
}: {
  invoice: InvoiceRow;
  can: { edit: boolean; cancel: boolean };
  mail: boolean;
  format: InvoiceFileKind;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const explain = useExplain();
  const [dialog, setDialog] = useState<null | "paper" | "send" | "credit" | "cancel">(null);
  const [pending, start] = useTransition();
  const issued = invoice.status !== "DRAFT";
  const isInvoice = invoice.kind === "INVOICE";
  const creditable = isInvoice && ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(invoice.status);
  const run = (work: () => Promise<InvoiceResult>) =>
    start(async () => {
      const result = await work();
      setDialog(null);
      if (result.ok && result.id) router.push(`/app/invoices/${result.id}`);
      else toast.error(explain(result));
    });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("invoicing.actions")} disabled={pending}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("paper")}>
            <Eye className="size-4" /> {t("invoicing.preview")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/app/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener">
              <Download className="size-4" /> {t("invoicing.downloadPdf")}
            </a>
          </DropdownMenuItem>
          {issued && mail && can.edit && (
            <DropdownMenuItem onSelect={() => setDialog("send")}>
              <Mail className="size-4" /> {t(invoice.sentAt ? "invoicing.resend" : "invoicing.send")}
            </DropdownMenuItem>
          )}
          {isInvoice && can.edit && (
            <DropdownMenuItem onSelect={() => run(() => duplicateAction(invoice.id))}>
              <Copy className="size-4" /> {t("invoicing.duplicate")}
            </DropdownMenuItem>
          )}
          {creditable && can.cancel && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog("credit")}>
                <FileMinus2 className="size-4" /> {t("invoicing.credit")}
              </DropdownMenuItem>
              {!invoice.creditedCents && (
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("cancel")}>
                  <Ban className="size-4" /> {t("invoices.cancel")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "paper" && <PaperDialog id={invoice.id} onClose={() => setDialog(null)} />}
      {dialog === "send" && <SendInvoiceDialog id={invoice.id} email={invoice.clientEmail} format={format} resend={!!invoice.sentAt} onClose={() => setDialog(null)} />}
      {dialog === "credit" && <CreditNoteDialog id={invoice.id} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("invoices.cancelTitle")}
        text={t("invoices.cancelText")}
        confirm={t("invoices.cancel")}
        destructive
        onConfirm={() => run(() => cancelAction(invoice.id))}
      />
    </>
  );
}
