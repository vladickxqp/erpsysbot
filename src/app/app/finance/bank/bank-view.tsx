"use client";

import { Check, EyeOff, Landmark, Undo2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FilterChips } from "@/components/app/list-controls";
import { EmptyState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { EXPENSE_CATEGORIES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { bookAction, ignoreAction, matchAction, type BankResult } from "./actions";

type Row = {
  id: string;
  bookedOn: string;
  amountCents: number;
  counterparty: string | null;
  purpose: string | null;
  invoiceId: string | null;
  suggestions: { invoiceId: string; label: string; sure: boolean }[];
};

function Line({ row, open, canBook, status }: { row: Row; open: { id: string; label: string; openCents: number }[]; canBook: boolean; status: string }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [invoice, setInvoice] = useState(row.suggestions[0]?.invoiceId ?? "");
  const [category, setCategory] = useState("other");
  const [pending, start] = useTransition();
  const incoming = row.amountCents > 0;
  const run = (work: () => Promise<BankResult>) =>
    start(async () => {
      const res = await work();
      if (res.error) toast.error(t(res.error));
      router.refresh();
    });

  return (
    <div className={cn("grid gap-2 px-4 py-3 text-sm", pending && "opacity-60")}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{formatDate(row.bookedOn, locale, region)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{row.counterparty ?? "—"}</div>
          <div className="line-clamp-2 text-xs text-muted-foreground">{row.purpose}</div>
        </div>
        <span className={cn("tabular-nums font-medium", incoming ? "text-success" : "text-destructive")}>
          {incoming ? "+" : "−"}
          {formatMoney(Math.abs(row.amountCents), locale, region)}
        </span>
      </div>
      {status === "NEW" && canBook && (
        <div className="flex flex-wrap items-center gap-2 sm:pl-27">
          {incoming && open.length > 0 && (
            <>
              <Select value={invoice} onValueChange={setInvoice}>
                <SelectTrigger className="w-full sm:w-72" aria-label={t("bank.invoice")}>
                  <SelectValue placeholder={t("bank.chooseInvoice")} />
                </SelectTrigger>
                <SelectContent>
                  {row.suggestions.map((s) => (
                    <SelectItem key={`s-${s.invoiceId}`} value={s.invoiceId}>
                      ★ {s.label}
                    </SelectItem>
                  ))}
                  {open
                    .filter((o) => !row.suggestions.some((s) => s.invoiceId === o.id))
                    .map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label} · {formatMoney(o.openCents, locale, region)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!invoice || pending} onClick={() => run(() => matchAction(row.id, invoice))}>
                <Check className="size-4" /> {t("bank.match")}
              </Button>
            </>
          )}
          {!incoming && (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44" aria-label={t("finance.category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`finance.cat_${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => bookAction(row.id, incoming ? null : category))}>
            {t(incoming ? "bank.bookIncome" : "bank.bookExpense")}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => ignoreAction(row.id, true))}>
            <EyeOff className="size-4" /> {t("bank.ignore")}
          </Button>
        </div>
      )}
      {status === "MATCHED" && row.invoiceId && (
        <Link href={`/app/invoices/${row.invoiceId}`} className="text-xs text-primary hover:underline sm:pl-27">
          {t("bank.toInvoice")}
        </Link>
      )}
      {status === "IGNORED" && canBook && (
        <div className="sm:pl-27">
          <Button size="sm" variant="ghost" onClick={() => run(() => ignoreAction(row.id, false))}>
            <Undo2 className="size-4" /> {t("bank.restore")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function BankView({ rows, open, status, canBook }: { rows: Row[]; open: { id: string; label: string; openCents: number }[]; status: string; canBook: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const res = await fetch("/app/finance/bank/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; imported?: number; skipped?: number; matched?: number };
      if (body.ok) toast.success(t("bank.imported", { imported: String(body.imported ?? 0), skipped: String(body.skipped ?? 0), matched: String(body.matched ?? 0) }));
      else toast.error(t(body.error === "forbidden" ? "common.forbidden" : `bank.${body.error ?? "UNREADABLE"}`));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips name="status" options={["NEW", "MATCHED", "BOOKED", "IGNORED"].map((s) => ({ value: s === "NEW" ? null : s, label: t(`bank.status.${s}`) }))} />
        {canBook && (
          <>
            <input
              ref={input}
              type="file"
              accept=".xml,.csv,.txt,application/xml,text/xml,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <Button disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="size-4" /> {busy ? t("common.loading") : t("bank.upload")}
            </Button>
          </>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Landmark} title={t(status === "NEW" ? "bank.emptyNew" : "bank.empty")} />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <Line key={r.id} row={r} open={open} canBook={canBook} status={status} />
          ))}
        </div>
      )}
    </div>
  );
}
