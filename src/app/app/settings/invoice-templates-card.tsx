"use client";

import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { InvoicePaper, type PaperData, type PaperSeller } from "@/components/app/invoice-paper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LOCALES, type Locale } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { DEFAULT_ACCENT, INVOICE_LAYOUTS, type InvoiceLayout } from "@/lib/invoicing";
import { deleteTemplateAction, saveTemplateAction } from "./actions";

export type TemplateRow = {
  id: string;
  name: string;
  layout: InvoiceLayout;
  accentColor: string;
  language: string;
  footer: string | null;
  paymentInstructions: string | null;
  isDefault: boolean;
};

type Draft = Omit<TemplateRow, "id" | "footer" | "paymentInstructions"> & { id: string | null; footer: string; paymentInstructions: string };

const blank = (language: string): Draft => ({ id: null, name: "", layout: "CLASSIC", accentColor: DEFAULT_ACCENT, language, footer: "", paymentInstructions: "", isDefault: false });

/** An example to judge a look by. */
const sample = (v: Draft, seller: PaperSeller, logoId: string | null, currency: string): PaperData => ({
  kind: "INVOICE",
  number: "RE-2026-0042",
  title: null,
  issueDate: "2026-11-02",
  serviceDate: "2026-10-30",
  serviceEndDate: null,
  dueDate: "2026-11-16",
  notes: null,
  language: v.language,
  treatment: "STANDARD",
  reason: null,
  currency,
  seller,
  buyer: { name: "Muster AG", street: "Musterweg 1", postalCode: "10115", city: "Berlin", country: seller.country },
  lines: [{ description: "…", quantity: 2, unit: "Std", unitPriceCents: 9500, discountPercent: 0, vatRate: 19 }],
  style: { layout: v.layout, accentColor: v.accentColor, footer: v.footer || null, paymentInstructions: v.paymentInstructions || null },
  logoId,
});

export function InvoiceTemplatesCard({
  templates,
  seller,
  logoId,
  currency,
  language,
}: {
  templates: TemplateRow[];
  seller: PaperSeller;
  logoId: string | null;
  currency: string;
  language: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<TemplateRow | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      if (!v) return;
      const result = await saveTemplateAction(v.id, { ...v, language: v.language as Locale, footer: v.footer || null, paymentInstructions: v.paymentInstructions || null });
      if (result.ok) {
        toast.success(t("common.saved"));
        setV(null);
        router.refresh();
      } else toast.error(t(result.error === "forbidden" ? "common.forbidden" : result.error === "NAME_TAKEN" ? "invoicing.nameTaken" : result.error === "TOO_MANY" ? "invoicing.tooManyTemplates" : "auth.check"));
    });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t("invoicing.templates")}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setV(blank(language))}>
          <Plus className="size-4" /> {t("invoicing.newTemplate")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {templates.length === 0 && <p className="text-sm text-muted-foreground">{t("invoicing.builtIn")}</p>}
        {templates.map((x) => (
          <div key={x.id} className="flex items-center gap-3 rounded-lg border bg-background p-2.5 text-sm">
            <span className="size-4 shrink-0 rounded-full border" style={{ background: x.accentColor }} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
            <span className="hidden text-muted-foreground sm:inline">{t(`invoicing.layout_${x.layout}`)}</span>
            {x.isDefault && (
              <Badge variant="secondary">
                <Star className="size-3" /> {t("invoicing.defaultTemplate")}
              </Badge>
            )}
            <Button size="icon" variant="ghost" aria-label={t("common.edit")} onClick={() => setV({ ...x, footer: x.footer ?? "", paymentInstructions: x.paymentInstructions ?? "" })}>
              <Pencil className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t("common.delete")} onClick={() => setRemoving(x)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </CardContent>
      {v && (
        <Dialog open onOpenChange={(open) => !open && setV(null)}>
          <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{v.id ? v.name : t("invoicing.newTemplate")}</DialogTitle>
              <DialogDescription className="sr-only">{t("invoicing.templates")}</DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="grid h-fit gap-3">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("invoicing.templateName")}</span>
                  <Input value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} required />
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("invoicing.layout")}</span>
                    <Select value={v.layout} onValueChange={(layout) => setV({ ...v, layout: layout as InvoiceLayout })}>
                      <SelectTrigger className="w-full" aria-label={t("invoicing.layout")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INVOICE_LAYOUTS.map((l) => (
                          <SelectItem key={l} value={l}>
                            {t(`invoicing.layout_${l}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("invoicing.accent")}</span>
                    <Input type="color" className="w-16 p-1" value={v.accentColor} onChange={(e) => setV({ ...v, accentColor: e.target.value })} />
                  </label>
                </div>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("invoicing.language")}</span>
                  <Select value={v.language} onValueChange={(l) => setV({ ...v, language: l })}>
                    <SelectTrigger className="w-full" aria-label={t("invoicing.language")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOCALES.map((l) => (
                        <SelectItem key={l} value={l}>
                          {new Intl.DisplayNames([l], { type: "language" }).of(l)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("invoicing.paymentInstructions")}</span>
                  <Textarea rows={3} value={v.paymentInstructions} maxLength={500} placeholder="{amount} · {due} · {number}" onChange={(e) => setV({ ...v, paymentInstructions: e.target.value })} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("invoicing.footer")}</span>
                  <Textarea rows={2} value={v.footer} maxLength={500} onChange={(e) => setV({ ...v, footer: e.target.value })} />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={v.isDefault} onCheckedChange={(c) => setV({ ...v, isDefault: c === true })} /> {t("invoicing.defaultTemplate")}
                </label>
              </div>
              <InvoicePaper data={sample(v, seller, logoId, currency)} />
              <DialogFooter className="md:col-span-2">
                <Button type="button" variant="outline" onClick={() => setV(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? t("common.loading") : t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("invoicing.deleteTemplate")}
        text={removing?.name ?? ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() =>
          start(async () => {
            const result = removing && (await deleteTemplateAction(removing.id));
            setRemoving(null);
            if (result?.ok) router.refresh();
            else toast.error(t("common.forbidden"));
          })
        }
      />
    </Card>
  );
}
