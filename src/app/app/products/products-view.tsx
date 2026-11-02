"use client";

import { Boxes, Package, Pencil, Plus, Trash2 } from "lucide-react";
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
import { defaultUnit, formatMoney, formatRate, type Region } from "@/i18n";
import { allowedRates, countryProfile } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { adjustStockAction, deleteProductAction, saveProductAction, type ProductPayload } from "./actions";

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
  category: string | null;
  barcode: string | null;
  purchasePriceCents: number | null;
  trackStock: boolean;
  stock: number;
  minStock: number | null;
};

type FormState = ProductPayload & { id: string | null };

const blank = (region: Region, locale: string): FormState => ({
  id: null,
  kind: "SERVICE",
  name: "",
  sku: "",
  unit: defaultUnit(locale, "hour"),
  price: "",
  vatRate: allowedRates(region.taxRates, region.country)[0],
  active: true,
  description: "",
  category: "",
  barcode: "",
  purchasePrice: "",
  trackStock: false,
  minStock: "",
});

const euros = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

export function ProductsView({ rows, canManage, canStock, smallBusiness }: { rows: Row[]; canManage: boolean; canStock: boolean; smallBusiness: boolean }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [counting, setCounting] = useState<{ row: Row; counted: string; note: string } | null>(null);
  const [pending, start] = useTransition();
  const taxLabel = countryProfile(region.country).taxKind === "SALES_TAX" ? "lines.salesTax" : "products.vat";
  const qty = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(n);
  const anyStock = rows.some((r) => r.trackStock);

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
          <Button onClick={() => setForm(blank(region, locale))}>
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
                <TableHead className="hidden sm:table-cell">{t("products.kind")}</TableHead>
                <TableHead className="text-right">{t("products.price")}</TableHead>
                {!smallBusiness && <TableHead className="hidden text-right sm:table-cell">{t(taxLabel)}</TableHead>}
                {anyStock && <TableHead className="text-right">{t("inventory.stock")}</TableHead>}
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const low = p.trackStock && p.minStock !== null && p.stock <= p.minStock;
                return (
                  <TableRow key={p.id} className={p.active ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.sku && <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span>}
                      {p.category && <span className="ml-2 text-xs text-muted-foreground">· {p.category}</span>}
                      {!p.active && (
                        <Badge variant="outline" className="ml-2">
                          {t("products.inactive")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{t(`products.${p.kind}`)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(p.priceCents, locale, region)}
                      <span className="text-muted-foreground"> / {p.unit}</span>
                    </TableCell>
                    {!smallBusiness && <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{formatRate(p.vatRate, locale, region)}</TableCell>}
                    {anyStock && (
                      <TableCell className={cn("text-right tabular-nums", low && "font-semibold text-destructive")}>
                        {p.trackStock ? `${qty(p.stock)} ${p.unit}` : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        {canStock && p.trackStock && (
                          <Button variant="ghost" size="icon" aria-label={t("inventory.count")} onClick={() => setCounting({ row: p, counted: String(p.stock).replace(".", ","), note: "" })}>
                            <Boxes className="size-4" />
                          </Button>
                        )}
                        {canManage && (
                          <>
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
                                  price: euros(p.priceCents),
                                  vatRate: p.vatRate,
                                  active: p.active,
                                  description: p.description ?? "",
                                  category: p.category ?? "",
                                  barcode: p.barcode ?? "",
                                  purchasePrice: euros(p.purchasePriceCents),
                                  trackStock: p.trackStock,
                                  minStock: p.minStock === null ? "" : String(p.minStock).replace(".", ","),
                                })
                              }
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setRemoving(p)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
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
              <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto px-0.5">
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
                    <Label>{t(taxLabel)}</Label>
                    <Select value={String(form.vatRate)} onValueChange={(v) => setForm({ ...form, vatRate: Number(v) })}>
                      <SelectTrigger className="w-full" aria-label={t(taxLabel)}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[...new Set([...allowedRates(region.taxRates, region.country), form.vatRate])].map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {formatRate(r, locale, region)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("inventory.category")}</span>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={80} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("inventory.purchasePrice")}</span>
                  <Input inputMode="decimal" value={form.purchasePrice} placeholder="0,00" onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("inventory.barcode")}</span>
                  <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} maxLength={60} />
                </label>
                {form.kind === "PRODUCT" && (
                  <>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <Checkbox checked={form.trackStock} onCheckedChange={(c) => setForm({ ...form, trackStock: c === true })} />
                      {t("inventory.track")}
                    </label>
                    {form.trackStock && (
                      <label className="grid gap-1.5">
                        <span className="text-sm font-medium">{t("inventory.minStock")}</span>
                        <Input inputMode="decimal" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
                      </label>
                    )}
                  </>
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

      <Dialog open={counting !== null} onOpenChange={(o) => !o && setCounting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("inventory.count")}</DialogTitle>
            <DialogDescription>{counting?.row.name}</DialogDescription>
          </DialogHeader>
          {counting && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const result = await adjustStockAction(counting.row.id, counting.counted, counting.note);
                  if (result.ok) {
                    toast.success(t("common.saved"));
                    setCounting(null);
                    router.refresh();
                  } else toast.error(t(result.error === "forbidden" ? "common.forbidden" : "auth.check"));
                });
              }}
            >
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">
                  {t("inventory.counted")} ({counting.row.unit})
                </span>
                <Input inputMode="decimal" value={counting.counted} onChange={(e) => setCounting({ ...counting, counted: e.target.value })} required autoFocus />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">{t("inventory.note")}</span>
                <Input value={counting.note} onChange={(e) => setCounting({ ...counting, note: e.target.value })} maxLength={500} />
              </label>
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
