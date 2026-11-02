"use client";

import { Download, Plus, Receipt, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/client";
import { formatDate, formatMoney } from "@/i18n";
import { EXPENSE_CATEGORIES, TRANSACTION_TYPES, type TransactionType } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { addTransactionAction, deleteTransactionAction } from "./actions";

type Row = {
  id: string;
  type: TransactionType;
  amountCents: number;
  bookedOn: string;
  category: string | null;
  description: string | null;
  fromInvoice: boolean;
  invoiceId: string | null;
};

const SIGN: Record<TransactionType, number> = { INCOME: 1, EXPENSE: -1, REFUND: -1, ADJUSTMENT: 1 };

export function Transactions({
  rows,
  total,
  today,
  canCreate,
  canExport,
  from,
  to,
}: {
  rows: Row[];
  total: number;
  today: string;
  canCreate: boolean;
  canExport: boolean;
  from: string;
  to: string;
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ type: "EXPENSE", amount: "", bookedOn: today, category: "material", description: "", method: "" });
  const category = (c: string | null) => (c ? t(`finance.cat_${c}`).replace(/^finance\.cat_/, "") : "—");

  const save = () =>
    start(async () => {
      const result = await addTransactionAction(form);
      if (result.ok) {
        toast.success(t("common.saved"));
        setOpen(false);
        setForm({ ...form, amount: "", description: "" });
        router.refresh();
      } else toast.error(t(result.error === "forbidden" ? "common.forbidden" : "auth.check"));
    });

  const remove = (id: string) =>
    start(async () => {
      const result = await deleteTransactionAction(id);
      if (result.ok) router.refresh();
      else toast.error(t("common.error"));
    });

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("finance.count", { count: total })}</h2>
        <div className="flex gap-2">
          {canExport && (
            <Button variant="outline" asChild>
              <a href={`/app/finance/export?from=${from}&to=${to}`} download>
                <Download className="size-4" /> <span className="hidden sm:inline">{t("common.export")}</span>
              </a>
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t("finance.add")}
            </Button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Receipt} title={t("finance.emptyTitle")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("finance.date")}</TableHead>
                <TableHead>{t("finance.type")}</TableHead>
                <TableHead>{t("finance.category")}</TableHead>
                <TableHead>{t("finance.description")}</TableHead>
                <TableHead className="text-right">{t("invoices.amount")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const signed = r.amountCents * SIGN[r.type];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.bookedOn, locale, region)}</TableCell>
                    <TableCell>{t(`finance.${r.type}`)}</TableCell>
                    <TableCell className="text-muted-foreground">{category(r.category)}</TableCell>
                    <TableCell>
                      {r.invoiceId ? (
                        <Link href={`/app/invoices/${r.invoiceId}`} className="text-primary hover:underline">
                          {r.description ?? t("finance.fromInvoice")}
                        </Link>
                      ) : (
                        (r.description ?? "—")
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", signed < 0 ? "text-destructive" : "text-success")}>
                      {formatMoney(signed, locale, region)}
                    </TableCell>
                    <TableCell>
                      {canCreate && !r.fromInvoice && (
                        <Button variant="ghost" size="icon" aria-label={t("common.delete")} disabled={pending} onClick={() => remove(r.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("finance.addTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("finance.addTitle")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t("finance.type")}</Label>
                <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
                  <SelectTrigger className="w-full" aria-label={t("finance.type")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSACTION_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`finance.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("finance.amount")}</span>
                <Input inputMode="decimal" required value={form.amount} placeholder="0,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("finance.date")}</span>
                <Input type="date" required value={form.bookedOn} onChange={(e) => setForm({ ...form, bookedOn: e.target.value })} />
              </label>
              <div className="grid gap-1.5">
                <Label>{t("finance.category")}</Label>
                <Select value={form.category} onValueChange={(c) => setForm({ ...form, category: c })}>
                  <SelectTrigger className="w-full" aria-label={t("finance.category")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...EXPENSE_CATEGORIES, "cash"].map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`finance.cat_${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t("finance.description")}</span>
              <Input value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
