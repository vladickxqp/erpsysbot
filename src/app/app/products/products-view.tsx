"use client";

import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import { deleteProductAction, saveProductAction } from "./actions";

type Row = {
  id: string;
  kind: "PRODUCT" | "SERVICE";
  name: string;
  sku: string | null;
  description: string | null;
  unit: string;
  priceCents: number;
  vatRate: number;
  active: boolean;
};

type FormState = { id: string | null; kind: string; name: string; sku: string; unit: string; price: string; vatRate: number; active: boolean; description: string };

const blank: FormState = { id: null, kind: "SERVICE", name: "", sku: "", unit: "Std", price: "", vatRate: 19, active: true, description: "" };

export function ProductsView({ rows, canManage, smallBusiness }: { rows: Row[]; canManage: boolean; smallBusiness: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    form &&
    start(async () => {
      const { id, ...input } = form;
      const result = await saveProductAction(id, input);
      if (result.ok) {
        toast.success(t("common.saved"));
        setForm(null);
        router.refresh();
      } else toast.error(t(result.error === "forbidden" ? "common.forbidden" : "auth.check"));
    });

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setForm(blank)}>
            <Plus className="size-4" /> {t("products.new")}
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={Package} title={t("products.emptyTitle")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("products.name")}</TableHead>
                <TableHead>{t("products.kind")}</TableHead>
                <TableHead>{t("products.unit")}</TableHead>
                <TableHead className="text-right">{t("products.price")}</TableHead>
                {!smallBusiness && <TableHead className="text-right">{t("products.vat")}</TableHead>}
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className={p.active ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.sku && <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span>}
                    {!p.active && (
                      <Badge variant="outline" className="ml-2">
                        {t("products.inactive")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t(`products.${p.kind}`)}</TableCell>
                  <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.priceCents, locale)}</TableCell>
                  {!smallBusiness && <TableCell className="text-right text-muted-foreground">{p.vatRate} %</TableCell>}
                  <TableCell className="text-right">
                    {canManage && (
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("common.edit")}
                          onClick={() =>
                            setForm({
                              id: p.id,
                              kind: p.kind,
                              name: p.name,
                              sku: p.sku ?? "",
                              unit: p.unit,
                              price: (p.priceCents / 100).toFixed(2).replace(".", ","),
                              vatRate: p.vatRate,
                              active: p.active,
                              description: p.description ?? "",
                            })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setRemoving(p)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("products.edit") : t("products.new")}</DialogTitle>
            <DialogDescription className="sr-only">{t("products.title")}</DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("products.kind")}</Label>
                  <Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind })}>
                    <SelectTrigger className="w-full" aria-label={t("products.kind")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SERVICE">{t("products.SERVICE")}</SelectItem>
                      <SelectItem value="PRODUCT">{t("products.PRODUCT")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("products.sku")}</span>
                  <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} maxLength={60} />
                </label>
                <label className="col-span-2 grid gap-1.5">
                  <span className="text-sm font-medium">{t("products.name")}</span>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200} autoFocus />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("products.price")}</span>
                  <Input inputMode="decimal" value={form.price} placeholder="0,00" onChange={(e) => setForm({ ...form, price: e.target.value })} required />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("products.unit")}</span>
                  <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required maxLength={20} />
                </label>
                {!smallBusiness && (
                  <div className="grid gap-1.5">
                    <Label>{t("products.vat")}</Label>
                    <Select value={String(form.vatRate)} onValueChange={(v) => setForm({ ...form, vatRate: Number(v) })}>
                      <SelectTrigger className="w-full" aria-label={t("products.vat")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[19, 7, 0].map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r} %
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox checked={form.active} onCheckedChange={(c) => setForm({ ...form, active: c === true })} />
                  {t("products.active")}
                </label>
                <label className="col-span-2 grid gap-1.5">
                  <span className="text-sm font-medium">{t("products.description")}</span>
                  <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("products.deleteTitle")}
        text={t("products.deleteText", { name: removing?.name ?? "" })}
        confirm={t("common.delete")}
        destructive
        onConfirm={() =>
          removing &&
          start(async () => {
            const result = await deleteProductAction(removing.id);
            setRemoving(null);
            if (result.ok) router.refresh();
            else toast.error(t("common.error"));
          })
        }
      />
    </>
  );
}
