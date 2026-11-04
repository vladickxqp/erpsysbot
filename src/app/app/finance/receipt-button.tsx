"use client";

import { ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { EXPENSE_CATEGORIES } from "@/lib/domain";
import { addTransactionAction } from "./actions";

type Fields = { vendor: string; date: string; amount: string; category: string };

/** A receipt in, the figures to check, and only then an expense. */
export function ReceiptButton({ today }: { today: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Fields | null>(null);
  const [pending, start] = useTransition();

  const read = async (file: File) => {
    const data = new FormData();
    data.append("file", file);
    setBusy(true);
    try {
      const res = await fetch("/app/finance/receipt", { method: "POST", body: data });
      const body = (await res.json().catch(() => ({}))) as { vendor?: string; date?: string | null; amountCents?: number | null; category?: string; error?: string };
      if (body.error) toast.error(t(body.error));
      else
        setForm({
          vendor: body.vendor ?? "",
          date: body.date ?? today,
          amount: body.amountCents ? (body.amountCents / 100).toFixed(2).replace(".", ",") : "",
          category: body.category ?? "other",
        });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        <ScanLine className="size-4" /> {busy ? t("common.loading") : t("receipt.read")}
      </Button>
      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("receipt.read")}</DialogTitle>
          </DialogHeader>
          {form && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const res = await addTransactionAction({ type: "EXPENSE", amount: form.amount, bookedOn: form.date, category: form.category, description: form.vendor, method: "" });
                  if (res.error) toast.error(t("common.error"));
                  else {
                    toast.success(t("common.saved"));
                    setForm(null);
                    router.refresh();
                  }
                });
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="rc-vendor">{t("receipt.vendor")}</Label>
                <Input id="rc-vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="rc-date">{t("studio.date")}</Label>
                  <Input id="rc-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rc-amount">{t("finance.amount")}</Label>
                  <Input id="rc-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("finance.category")}</Label>
                <Select value={form.category} onValueChange={(category) => setForm({ ...form, category })}>
                  <SelectTrigger className="w-full">
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
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
