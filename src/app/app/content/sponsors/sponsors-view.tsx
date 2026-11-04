"use client";

import { ArrowLeft, Handshake, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState, PageHeader, StatCard } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { SPONSOR_STATUSES, type SponsorStatus } from "@/lib/content";
import { deleteSponsorAction, invoiceSponsorAction, saveSponsorAction } from "../actions";

type Option = { id: string; name: string };
type Deal = {
  id: string;
  brand: string;
  title: string | null;
  status: string;
  amountCents: number;
  dueDate: string | null;
  clientId: string | null;
  contentId: string | null;
  contentTitle: string | null;
  invoiceId: string | null;
  notes: string | null;
};
type Form = { id: string | null; brand: string; title: string; status: string; amount: string; dueDate: string; clientId: string; contentId: string; notes: string };

const blank: Form = { id: null, brand: "", title: "", status: "LEAD", amount: "", dueDate: "", clientId: "", contentId: "", notes: "" };

function Pick({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select value={value || "NONE"} onValueChange={(v) => onChange(v === "NONE" ? "" : v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="NONE">{t("common.none")}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SponsorsView({ deals, clients, content, canManage, canInvoice }: { deals: Deal[]; clients: Option[]; content: Option[]; canManage: boolean; canInvoice: boolean }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [removing, setRemoving] = useState<Deal | null>(null);
  const [pending, start] = useTransition();
  const money = (c: number) => formatMoney(c, locale, region);
  const open = deals.filter((d) => ["LEAD", "NEGOTIATION"].includes(d.status));
  const agreed = deals.filter((d) => ["CONFIRMED", "DELIVERED"].includes(d.status));
  const sum = (list: Deal[]) => list.reduce((s, d) => s + d.amountCents, 0);

  const save = () =>
    form &&
    start(async () => {
      const res = await saveSponsorAction(form.id, {
        brand: form.brand,
        title: form.title,
        status: form.status as SponsorStatus,
        amount: form.amount,
        dueDate: form.dueDate || null,
        clientId: form.clientId || null,
        contentId: form.contentId || null,
        notes: form.notes,
      });
      if (res.error) toast.error(t(res.error));
      else {
        setForm(null);
        router.refresh();
      }
    });

  return (
    <>
      <PageHeader
        title={t("sponsors.title")}
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/app/content">
                <ArrowLeft className="size-4" /> {t("studio.title")}
              </Link>
            </Button>
            {canManage && (
              <Button onClick={() => setForm(blank)}>
                <Plus className="size-4" /> {t("sponsors.new")}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label={t("sponsors.pipeline")} value={money(sum(open))} />
        <StatCard label={t("sponsors.agreed")} value={money(sum(agreed))} />
        <StatCard label={t("sponsors.status.PAID")} value={money(sum(deals.filter((d) => d.status === "PAID")))} />
      </div>
      {deals.length === 0 ? (
        <EmptyState icon={Handshake} title={t("sponsors.empty")} />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {deals.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={!canManage}
                onClick={() =>
                  setForm({
                    id: d.id,
                    brand: d.brand,
                    title: d.title ?? "",
                    status: d.status,
                    amount: (d.amountCents / 100).toFixed(2).replace(".", ","),
                    dueDate: d.dueDate ?? "",
                    clientId: d.clientId ?? "",
                    contentId: d.contentId ?? "",
                    notes: d.notes ?? "",
                  })
                }
              >
                <div className="truncate font-medium">{d.brand}</div>
                <div className="truncate text-xs text-muted-foreground">{[d.title, d.contentTitle, d.dueDate && formatDate(d.dueDate, locale, region)].filter(Boolean).join(" · ")}</div>
              </button>
              <Badge variant="outline">{t(`sponsors.status.${d.status}`)}</Badge>
              <span className="w-28 text-right tabular-nums">{money(d.amountCents)}</span>
              {d.invoiceId ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/app/invoices/${d.invoiceId}`}>{t("nav.invoices")}</Link>
                </Button>
              ) : (
                canManage &&
                canInvoice &&
                d.clientId &&
                d.amountCents > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await invoiceSponsorAction(d.id);
                        if (res.error) toast.error(t(res.error));
                        else if (res.id) router.push(`/app/invoices/${res.id}`);
                      })
                    }
                  >
                    {t("time.bill")}
                  </Button>
                )
              )}
              {canManage && (
                <Button size="icon" variant="ghost" className="size-7" onClick={() => setRemoving(d)} aria-label={t("common.delete")}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? form.brand : t("sponsors.new")}</DialogTitle>
          </DialogHeader>
          {form && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="sp-brand">{t("sponsors.brand")}</Label>
                  <Input id="sp-brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} required maxLength={160} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sp-title">{t("studio.titleLabel")}</Label>
                  <Input id="sp-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={300} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("studio.statusLabel")}</Label>
                  <Select value={form.status} onValueChange={(status) => setForm({ ...form, status })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SPONSOR_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`sponsors.status.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sp-amount">{t("finance.amount")}</Label>
                  <Input id="sp-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sp-due">{t("studio.date")}</Label>
                  <Input id="sp-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                </div>
                {clients.length > 0 && <Pick label={t("invoices.client")} value={form.clientId} options={clients} onChange={(clientId) => setForm({ ...form, clientId })} />}
              </div>
              {content.length > 0 && <Pick label={t("studio.title")} value={form.contentId} options={content} onChange={(contentId) => setForm({ ...form, contentId })} />}
              <div className="grid gap-1.5">
                <Label htmlFor="sp-notes">{t("clients.notes")}</Label>
                <Textarea id="sp-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={t("common.delete")}
        text={removing?.brand ?? ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => {
          const deal = removing;
          setRemoving(null);
          if (deal)
            start(async () => {
              const res = await deleteSponsorAction(deal.id);
              if (res.error) toast.error(t(res.error));
              router.refresh();
            });
        }}
      />
    </>
  );
}
