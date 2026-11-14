"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Boxes, ImagePlus, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { defaultUnit, formatDate, formatMoney, formatRate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { Margins } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { choiceLabel, type VariantOption } from "@/lib/variants";
import { parseMoney } from "@/server/money";
import {
  addImageAction,
  countStockAction,
  deleteOfferAction,
  deleteProductAction,
  moveImageAction,
  removeImageAction,
  saveOfferAction,
  saveProductDetailsAction,
  saveVariantAction,
  saveVariantOptionsAction,
  type CatalogResult,
} from "../catalog-actions";
import { acknowledgePriceAction } from "../../purchasing/dropship-actions";

export type EditorProduct = {
  id: string;
  kind: "PRODUCT" | "SERVICE";
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  unit: string;
  priceCents: number;
  purchasePriceCents: number | null;
  vatRate: number;
  active: boolean;
  categoryId: string | null;
  trackStock: boolean;
  fulfillment: "STOCK" | "DROPSHIP" | "DIGITAL";
  stock: number;
  minStock: number | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  attributes: Record<string, string>;
  variantOptions: VariantOption[];
  shippingCostCents: number | null;
  otherCostCents: number | null;
  returnable: boolean;
  returnDays: number | null;
  shippingNote: string | null;
  importId: string | null;
};

type Variant = { id: string; options: Record<string, string>; sku: string | null; barcode: string | null; priceCents: number | null; purchasePriceCents: number | null; stock: number; minStock: number | null; active: boolean; margins: Margins };
type Offer = {
  id: string;
  supplierId: string;
  supplierName: string;
  variantId: string | null;
  supplierSku: string | null;
  purchasePriceCents: number;
  currency: string;
  minOrderQty: number | null;
  leadTimeDays: number | null;
  shippingCostCents: number | null;
  preferred: boolean;
  notes: string | null;
  supplierStock: number | null;
  stockReportedAt: string | null;
  priceChangedAt: string | null;
  previousPriceCents: number | null;
  history: { priceCents: number; currency: string; at: string }[];
};
type Image = { id: string; documentId: string; position: number; alt: string | null; name: string };
type Movement = { id: string; type: string; quantity: number; variantId: string | null; note: string | null; at: string };

const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", ","));
const num = (text: string) => {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};
const moneyOrNull = (text: string) => (text.trim() ? parseMoney(text) : null);

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function useAction() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (work: () => Promise<CatalogResult>, then?: (r: CatalogResult) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        if (then) then(result);
        else toast.success(t("common.saved"));
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });
  return { pending, run, router, t };
}

export function ProductEditor(props: {
  product: EditorProduct | null;
  variants: Variant[];
  images: Image[];
  offers: Offer[];
  bestOfferId: string | null;
  /** A product the supplier ships: per offer, what the supplier reported and what open orders take. */
  dropship?: { offerId: string; supplier: string; dropship: boolean; reported: number | null; reportedAt: string | null; reserved: number; openOrders: number; available: number | null }[] | null;
  movements: Movement[];
  margins: Margins | null;
  fees: { feePercent: number; feeFixedCents: number } | null;
  categories: { id: string; name: string; parentId: string | null }[];
  suppliers: { id: string; name: string; currency: string | null; active: boolean }[];
  rates: number[];
  smallBusiness: boolean;
  can: { manage: boolean; stock: boolean; settings: boolean };
  /** Held by open orders, in all and per variant. */
  held?: { total: number; byVariant: Record<string, number> };
  /** A digital product's pool and note (src/server/digital.ts), as its own tab. */
  digital?: ReactNode;
}) {
  const { t } = useI18n();
  const { product } = props;
  return (
    <>
      <Link href="/app/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("products.title")}
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{product?.name ?? t("products.new")}</h1>
        {product && !product.active && <Badge variant="outline">{t(product.importId ? "catalog.status.imported" : "products.inactive")}</Badge>}
      </div>
      {!product ? (
        <General {...props} />
      ) : (
        <Tabs defaultValue="general">
          <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="general">{t("catalog.tab.general")}</TabsTrigger>
            <TabsTrigger value="variants">
              {t("catalog.tab.variants")} {props.variants.length > 0 && `(${props.variants.length})`}
            </TabsTrigger>
            <TabsTrigger value="suppliers">
              {t("catalog.tab.suppliers")} {props.offers.length > 0 && `(${props.offers.length})`}
            </TabsTrigger>
            <TabsTrigger value="pricing">{t("catalog.tab.pricing")}</TabsTrigger>
            <TabsTrigger value="images">
              {t("catalog.tab.images")} {props.images.length > 0 && `(${props.images.length})`}
            </TabsTrigger>
            {product.trackStock && <TabsTrigger value="stock">{t("catalog.tab.stock")}</TabsTrigger>}
            {props.digital && <TabsTrigger value="digital">{t("digital.title")}</TabsTrigger>}
          </TabsList>
          <TabsContent value="general">
            <General {...props} />
          </TabsContent>
          <TabsContent value="variants">
            <Variants {...props} product={product} />
          </TabsContent>
          <TabsContent value="suppliers">
            <Suppliers {...props} product={product} />
          </TabsContent>
          <TabsContent value="pricing">
            <Pricing {...props} product={product} />
          </TabsContent>
          <TabsContent value="images">
            <Images {...props} product={product} />
          </TabsContent>
          {product.trackStock && (
            <TabsContent value="stock">
              <Stock {...props} product={product} />
            </TabsContent>
          )}
          {props.digital && <TabsContent value="digital">{props.digital}</TabsContent>}
        </Tabs>
      )}
    </>
  );
}

// --- General -----------------------------------------------------------------------------------

function General({ product, categories, rates, smallBusiness, can }: Parameters<typeof ProductEditor>[0]) {
  const { t, locale, region } = useI18n();
  const { pending, run, router } = useAction();
  const [removing, setRemoving] = useState(false);
  const [v, setV] = useState(() => ({
    kind: product?.kind ?? "PRODUCT",
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    description: product?.description ?? "",
    unit: product?.unit ?? defaultUnit(locale),
    price: euros(product?.priceCents ?? null),
    purchasePrice: euros(product?.purchasePriceCents),
    vatRate: product?.vatRate ?? rates[0],
    active: product?.active ?? true,
    categoryId: product?.categoryId ?? "",
    trackStock: product?.trackStock ?? false,
    fulfillment: (product?.fulfillment ?? "STOCK") as "STOCK" | "DROPSHIP" | "DIGITAL",
    minStock: product?.minStock === null || product?.minStock === undefined ? "" : String(product.minStock).replace(".", ","),
    weightGrams: product?.weightGrams?.toString() ?? "",
    lengthMm: product?.lengthMm?.toString() ?? "",
    widthMm: product?.widthMm?.toString() ?? "",
    heightMm: product?.heightMm?.toString() ?? "",
    shippingCost: euros(product?.shippingCostCents),
    otherCost: euros(product?.otherCostCents),
    returnable: product?.returnable ?? true,
    returnDays: product?.returnDays?.toString() ?? "",
    shippingNote: product?.shippingNote ?? "",
    attributes: Object.entries(product?.attributes ?? {}).map(([name, value]) => ({ name, value })),
  }));
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));
  const disabled = !can.manage;
  const input = (key: "name" | "sku" | "barcode" | "unit" | "price" | "purchasePrice" | "minStock" | "weightGrams" | "lengthMm" | "widthMm" | "heightMm" | "shippingCost" | "otherCost" | "returnDays", props: React.ComponentProps<typeof Input> = {}) => (
    <Input value={v[key]} onChange={(e) => set({ [key]: e.target.value })} disabled={disabled} {...props} />
  );

  const save = () => {
    const price = parseMoney(v.price);
    const numbers = [v.minStock, v.weightGrams, v.lengthMm, v.widthMm, v.heightMm, v.returnDays].map(num);
    const money = [v.purchasePrice, v.shippingCost, v.otherCost].map(moneyOrNull);
    if (price === null || price < 0 || numbers.some((n) => Number.isNaN(n)) || money.some((m, i) => [v.purchasePrice, v.shippingCost, v.otherCost][i].trim() && (m === null || m < 0))) {
      toast.error(t("auth.check"));
      return;
    }
    const [minStock, weightGrams, lengthMm, widthMm, heightMm, returnDays] = numbers;
    const [purchasePriceCents, shippingCostCents, otherCostCents] = money;
    const attributes = Object.fromEntries(v.attributes.filter((a) => a.name.trim()).map((a) => [a.name.trim(), a.value.trim()]));
    run(
      () =>
        saveProductDetailsAction(product?.id ?? null, {
          kind: v.kind,
          name: v.name,
          sku: v.sku,
          barcode: v.barcode,
          description: v.description,
          unit: v.unit,
          priceCents: price,
          purchasePriceCents,
          vatRate: v.vatRate,
          active: v.active,
          categoryId: v.categoryId || null,
          trackStock: v.kind === "PRODUCT" && v.fulfillment === "STOCK" && v.trackStock,
          fulfillment: v.kind === "PRODUCT" ? v.fulfillment : "STOCK",
          minStock,
          weightGrams: weightGrams === null ? null : Math.round(weightGrams),
          lengthMm: lengthMm === null ? null : Math.round(lengthMm),
          widthMm: widthMm === null ? null : Math.round(widthMm),
          heightMm: heightMm === null ? null : Math.round(heightMm),
          attributes,
          shippingCostCents,
          otherCostCents,
          returnable: v.returnable,
          returnDays: returnDays === null ? null : Math.round(returnDays),
          shippingNote: v.shippingNote || null,
        }),
      (r) => {
        toast.success(t("common.saved"));
        if (!product && r.id) router.push(`/app/products/${r.id}`);
      },
    );
  };

  return (
    <form
      className="grid gap-4 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Card className="lg:col-span-2">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-6">
          <Field label={t("products.name")} className="sm:col-span-4">
            {input("name", { required: true, maxLength: 200, autoFocus: !product })}
          </Field>
          <Field label={t("products.kind")} className="sm:col-span-2">
            <Select value={v.kind} onValueChange={(kind) => set({ kind: kind as "PRODUCT" | "SERVICE" })} disabled={disabled}>
              <SelectTrigger className="w-full" aria-label={t("products.kind")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PRODUCT">{t("products.PRODUCT")}</SelectItem>
                <SelectItem value="SERVICE">{t("products.SERVICE")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("products.sku")} className="sm:col-span-2">
            {input("sku", { maxLength: 60 })}
          </Field>
          <Field label={t("inventory.barcode")} className="sm:col-span-2">
            {input("barcode", { maxLength: 60 })}
          </Field>
          <Field label={t("catalog.category")} className="sm:col-span-2">
            <Select value={v.categoryId || "none"} onValueChange={(id) => set({ categoryId: id === "none" ? "" : id })} disabled={disabled}>
              <SelectTrigger className="w-full" aria-label={t("catalog.category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}` : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("products.price")} className="sm:col-span-2">
            {input("price", { inputMode: "decimal", placeholder: "0,00", required: true })}
          </Field>
          <Field label={t("inventory.purchasePrice")} className="sm:col-span-2">
            {input("purchasePrice", { inputMode: "decimal", placeholder: "0,00" })}
          </Field>
          {!smallBusiness ? (
            <Field label={t("products.vat")} className="sm:col-span-1">
              <Select value={String(v.vatRate)} onValueChange={(r) => set({ vatRate: Number(r) })} disabled={disabled}>
                <SelectTrigger className="w-full" aria-label={t("products.vat")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...rates, v.vatRate])].map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {formatRate(r, locale, region)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label={t("products.unit")} className={smallBusiness ? "sm:col-span-2" : "sm:col-span-1"}>
            {input("unit", { required: true, maxLength: 20 })}
          </Field>
          <Field label={t("products.description")} className="sm:col-span-6">
            <Textarea rows={4} value={v.description} onChange={(e) => set({ description: e.target.value })} disabled={disabled} maxLength={2000} />
          </Field>
          <div className="flex flex-wrap gap-4 sm:col-span-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={v.active} onCheckedChange={(c) => set({ active: c === true })} disabled={disabled} /> {t("products.active")}
            </label>
            {v.kind === "PRODUCT" && v.fulfillment === "STOCK" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={v.trackStock} onCheckedChange={(c) => set({ trackStock: c === true })} disabled={disabled} /> {t("inventory.track")}
              </label>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid h-fit gap-4">
        {v.kind === "PRODUCT" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("catalog.shipping")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label={t("dropship.product.fulfillment")} className="col-span-2">
                <Select value={v.fulfillment} onValueChange={(f) => set({ fulfillment: f as "STOCK" | "DROPSHIP" | "DIGITAL" })} disabled={disabled}>
                  <SelectTrigger className="w-full" aria-label={t("dropship.product.fulfillment")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STOCK">{t("dropship.product.STOCK")}</SelectItem>
                    <SelectItem value="DROPSHIP">{t("dropship.product.DROPSHIP")}</SelectItem>
                    <SelectItem value="DIGITAL">{t("digital.product")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("catalog.weight")} className="col-span-2">
                {input("weightGrams", { inputMode: "numeric" })}
              </Field>
              <Field label={t("catalog.length")}>{input("lengthMm", { inputMode: "numeric" })}</Field>
              <Field label={t("catalog.width")}>{input("widthMm", { inputMode: "numeric" })}</Field>
              <Field label={t("catalog.height")}>{input("heightMm", { inputMode: "numeric" })}</Field>
              {v.trackStock && <Field label={t("inventory.minStock")}>{input("minStock", { inputMode: "decimal" })}</Field>}
              <Field label={t("catalog.shippingNote")} className="col-span-2">
                <Input value={v.shippingNote} onChange={(e) => set({ shippingNote: e.target.value })} disabled={disabled} maxLength={500} />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <Checkbox checked={v.returnable} onCheckedChange={(c) => set({ returnable: c === true })} disabled={disabled} /> {t("catalog.returnable")}
              </label>
              {v.returnable && <Field label={t("catalog.returnDays")}>{input("returnDays", { inputMode: "numeric" })}</Field>}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("catalog.costs")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label={t("catalog.shippingCost")}>{input("shippingCost", { inputMode: "decimal", placeholder: "0,00" })}</Field>
            <Field label={t("catalog.otherCost")}>{input("otherCost", { inputMode: "decimal", placeholder: "0,00" })}</Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("catalog.attributes")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {v.attributes.map((a, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input aria-label={t("catalog.attributeName")} placeholder={t("catalog.attributeName")} value={a.name} maxLength={40} disabled={disabled} onChange={(e) => set({ attributes: v.attributes.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)) })} />
                <Input aria-label={t("catalog.attributeValue")} placeholder={t("catalog.attributeValue")} value={a.value} maxLength={200} disabled={disabled} onChange={(e) => set({ attributes: v.attributes.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)) })} />
                <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} disabled={disabled} onClick={() => set({ attributes: v.attributes.filter((_, i) => i !== index) })}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            {!disabled && v.attributes.length < 30 && (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set({ attributes: [...v.attributes, { name: "", value: "" }] })}>
                <Plus className="size-4" /> {t("catalog.addAttribute")}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      {can.manage && (
        <div className="flex flex-wrap justify-between gap-2 lg:col-span-3">
          {product ? (
            <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setRemoving(true)}>
              <Trash2 className="size-4" /> {t("common.delete")}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending}>
            {pending ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      )}
      {product && (
        <ConfirmDialog
          open={removing}
          onOpenChange={setRemoving}
          title={t("products.deleteTitle")}
          text={t("products.deleteText", { name: product.name })}
          confirm={t("common.delete")}
          destructive
          onConfirm={() => run(() => deleteProductAction(product.id), () => router.push("/app/products"))}
        />
      )}
    </form>
  );
}

// --- Variants ----------------------------------------------------------------------------------

function Variants({ product, variants, can }: Parameters<typeof ProductEditor>[0] & { product: EditorProduct }) {
  const { t, locale, region } = useI18n();
  const { pending, run } = useAction();
  const [options, setOptions] = useState(() => (product.variantOptions.length ? product.variantOptions : [{ name: "", values: [] }]).map((o) => ({ name: o.name, values: o.values.join(", ") })));
  const [editing, setEditing] = useState<Variant | null>(null);
  const money = (c: number) => formatMoney(c, locale, region);
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const generate = () =>
    run(
      () => saveVariantOptionsAction(product.id, options.map((o) => ({ name: o.name, values: o.values.split(/[,;\n]/) }))),
      (r) => toast.success(t("catalog.variantsMade", { count: r.count ?? 0 })),
    );
  return (
    <div className="grid gap-4">
      {can.manage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("catalog.options")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {options.map((o, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                <Input aria-label={t("catalog.optionName")} placeholder={t("catalog.optionName")} value={o.name} maxLength={40} onChange={(e) => setOptions(options.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)))} />
                <Input aria-label={t("catalog.optionValues")} placeholder="S, M, L" value={o.values} onChange={(e) => setOptions(options.map((x, i) => (i === index ? { ...x, values: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setOptions(options.filter((_, i) => i !== index))}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {options.length < 3 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setOptions([...options, { name: "", values: "" }])}>
                  <Plus className="size-4" /> {t("catalog.addOption")}
                </Button>
              )}
              <Button type="button" size="sm" disabled={pending} onClick={generate}>
                {t("catalog.makeVariants")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {variants.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("catalog.variant")}</TableHead>
                <TableHead>{t("products.sku")}</TableHead>
                <TableHead className="text-right">{t("products.price")}</TableHead>
                <TableHead className="text-right">{t("catalog.margin")}</TableHead>
                {product.trackStock && <TableHead className="text-right">{t("inventory.stock")}</TableHead>}
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((variant) => (
                <TableRow key={variant.id} className={variant.active ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    {choiceLabel(variant.options, product.variantOptions)}
                    {!variant.active && (
                      <Badge variant="outline" className="ml-2">
                        {t("products.inactive")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{variant.sku ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(variant.priceCents ?? product.priceCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{variant.margins.contributionPercent === null ? "—" : `${qty.format(variant.margins.contributionPercent)} %`}</TableCell>
                  {product.trackStock && <TableCell className="text-right tabular-nums">{qty.format(variant.stock)}</TableCell>}
                  <TableCell>
                    {can.manage && (
                      <Button variant="ghost" size="icon" aria-label={t("common.edit")} onClick={() => setEditing(variant)}>
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <VariantDialog variant={editing} product={product} onClose={() => setEditing(null)} />}
    </div>
  );
}

function VariantDialog({ variant, product, onClose }: { variant: Variant; product: EditorProduct; onClose: () => void }) {
  const { t } = useI18n();
  const { pending, run } = useAction();
  const [v, setV] = useState({
    sku: variant.sku ?? "",
    barcode: variant.barcode ?? "",
    price: euros(variant.priceCents),
    purchase: euros(variant.purchasePriceCents),
    minStock: variant.minStock === null ? "" : String(variant.minStock).replace(".", ","),
    active: variant.active,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{choiceLabel(variant.options, product.variantOptions)}</DialogTitle>
          <DialogDescription className="sr-only">{t("catalog.variant")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const price = moneyOrNull(v.price);
            const purchase = moneyOrNull(v.purchase);
            const min = num(v.minStock);
            if ((v.price.trim() && price === null) || (v.purchase.trim() && purchase === null) || Number.isNaN(min)) return toast.error(t("auth.check"));
            run(() => saveVariantAction(variant.id, { sku: v.sku, barcode: v.barcode, priceCents: price, purchasePriceCents: purchase, minStock: min, active: v.active }), () => {
              toast.success(t("common.saved"));
              onClose();
            });
          }}
        >
          <Field label={t("products.sku")}>
            <Input value={v.sku} maxLength={60} onChange={(e) => setV({ ...v, sku: e.target.value })} />
          </Field>
          <Field label={t("inventory.barcode")}>
            <Input value={v.barcode} maxLength={60} onChange={(e) => setV({ ...v, barcode: e.target.value })} />
          </Field>
          <Field label={t("products.price")}>
            <Input inputMode="decimal" value={v.price} placeholder={euros(product.priceCents)} onChange={(e) => setV({ ...v, price: e.target.value })} />
          </Field>
          <Field label={t("inventory.purchasePrice")}>
            <Input inputMode="decimal" value={v.purchase} placeholder={euros(product.purchasePriceCents)} onChange={(e) => setV({ ...v, purchase: e.target.value })} />
          </Field>
          {product.trackStock && (
            <Field label={t("inventory.minStock")}>
              <Input inputMode="decimal" value={v.minStock} onChange={(e) => setV({ ...v, minStock: e.target.value })} />
            </Field>
          )}
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Checkbox checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c === true })} /> {t("products.active")}
          </label>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Suppliers ---------------------------------------------------------------------------------

function Suppliers({ product, offers, bestOfferId, suppliers, variants, can, dropship }: Parameters<typeof ProductEditor>[0] & { product: EditorProduct }) {
  const { t, locale, region } = useI18n();
  const { run } = useAction();
  const [editing, setEditing] = useState<Partial<Offer> | null>(null);
  const [removing, setRemoving] = useState<Offer | null>(null);
  const money = (c: number, currency: string) => formatMoney(c, locale, { ...region, currency });
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const variantName = (id: string | null) => (id ? choiceLabel(variants.find((x) => x.id === id)?.options ?? {}, product.variantOptions) : t("catalog.allVariants"));
  const sorted = [...offers].sort((a, b) => a.purchasePriceCents + (a.shippingCostCents ?? 0) - (b.purchasePriceCents + (b.shippingCostCents ?? 0)));
  return (
    <div className="grid gap-4">
      {can.stock && (
        <Button className="w-fit" onClick={() => setEditing({ preferred: offers.length === 0 })} disabled={!suppliers.length}>
          <Plus className="size-4" /> {t("catalog.addOffer")}
        </Button>
      )}
      {!suppliers.length && (
        <Link href="/app/purchasing?tab=suppliers" className="text-sm text-primary hover:underline">
          {t("inventory.newSupplier")}
        </Link>
      )}
      {product.fulfillment === "DROPSHIP" && dropship && dropship.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("dropship.product.supplierStock")}</TableHead>
                <TableHead className="text-right">{t("dropship.product.reported")}</TableHead>
                <TableHead className="text-right">{t("dropship.product.reserved")}</TableHead>
                <TableHead className="text-right">{t("dropship.product.openOrders")}</TableHead>
                <TableHead className="text-right">{t("dropship.product.available")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dropship.map((d) => (
                <TableRow key={d.offerId}>
                  <TableCell className="font-medium">
                    {d.supplier}
                    {!d.dropship && (
                      <Badge variant="outline" className="ml-2">
                        {t("dropship.product.notDropship")}
                      </Badge>
                    )}
                    {d.reportedAt && <div className="text-xs text-muted-foreground">{t("dropship.product.stockAt", { date: formatDate(d.reportedAt, locale, region) })}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.reported === null ? t("dropship.product.unknown") : qty.format(d.reported)}</TableCell>
                  <TableCell className="text-right tabular-nums">{qty.format(d.reserved)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.openOrders}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.available === null ? t("dropship.product.unknown") : qty.format(d.available)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("catalog.supplier")}</TableHead>
                {variants.length > 0 && <TableHead>{t("catalog.variant")}</TableHead>}
                <TableHead className="text-right">{t("inventory.purchasePrice")}</TableHead>
                <TableHead className="text-right">{t("catalog.shippingCost")}</TableHead>
                <TableHead className="text-right">{t("catalog.leadTime")}</TableHead>
                <TableHead className="text-right">{t("catalog.minOrder")}</TableHead>
                <TableHead className="text-right">{t("dropship.product.supplierStock")}</TableHead>
                <TableHead>{t("catalog.priceHistory")}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    <Link href={`/app/purchasing/suppliers/${o.supplierId}`} className="hover:underline">
                      {o.supplierName}
                    </Link>
                    {o.preferred && <Star className="ml-1 inline size-3.5 fill-current text-warning" aria-label={t("catalog.preferred")} />}
                    {o.id === bestOfferId && (
                      <Badge variant="secondary" className="ml-2">
                        {t("catalog.cheapest")}
                      </Badge>
                    )}
                    {o.supplierSku && <div className="text-xs text-muted-foreground">{o.supplierSku}</div>}
                  </TableCell>
                  {variants.length > 0 && <TableCell className="text-muted-foreground">{variantName(o.variantId)}</TableCell>}
                  <TableCell className="text-right tabular-nums">
                    {money(o.purchasePriceCents, o.currency)}
                    {o.priceChangedAt && o.previousPriceCents !== null && (
                      <div className="text-xs text-warning">
                        {t("dropship.product.priceChanged", { from: money(o.previousPriceCents, o.currency), to: money(o.purchasePriceCents, o.currency) })}
                        {can.stock && (
                          <Button variant="link" size="sm" className="h-auto p-0 pl-1 text-xs" onClick={() => run(() => acknowledgePriceAction(o.id))}>
                            {t("dropship.product.acceptPrice")}
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{o.shippingCostCents === null ? "—" : money(o.shippingCostCents, o.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.leadTimeDays === null ? "—" : t("catalog.days", { count: o.leadTimeDays })}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.minOrderQty ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.supplierStock === null ? <span className="text-muted-foreground">{t("dropship.product.unknown")}</span> : qty.format(o.supplierStock)}
                    {o.stockReportedAt && <div className="text-xs text-muted-foreground">{t("dropship.product.stockAt", { date: formatDate(o.stockReportedAt, locale, region) })}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.history.length > 1
                      ? o.history
                          .slice(0, 3)
                          .map((h) => `${formatDate(h.at, locale, region)}: ${money(h.priceCents, h.currency)}`)
                          .join(" · ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {can.stock && (
                      <div className="flex">
                        <Button variant="ghost" size="icon" aria-label={t("common.edit")} onClick={() => setEditing(o)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setRemoving(o)}>
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
      {editing && <OfferDialog offer={editing} product={product} suppliers={suppliers} variants={variants} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("catalog.removeOffer")}
        text={removing?.supplierName ?? ""}
        confirm={t("common.delete")}
        destructive
        onConfirm={() => removing && run(() => deleteOfferAction(removing.id), () => setRemoving(null))}
      />
    </div>
  );
}

function OfferDialog({
  offer,
  product,
  suppliers,
  variants,
  onClose,
}: {
  offer: Partial<Offer>;
  product: EditorProduct;
  suppliers: { id: string; name: string; currency: string | null; active: boolean }[];
  variants: Variant[];
  onClose: () => void;
}) {
  const { t, region } = useI18n();
  const { pending, run } = useAction();
  const initialStock = offer.supplierStock === null || offer.supplierStock === undefined ? "" : String(offer.supplierStock).replace(".", ",");
  const [v, setV] = useState({
    stock: initialStock,
    supplierId: offer.supplierId ?? suppliers.find((s) => s.active)?.id ?? "",
    variantId: offer.variantId ?? "",
    supplierSku: offer.supplierSku ?? "",
    price: euros(offer.purchasePriceCents),
    currency: offer.currency ?? suppliers.find((s) => s.id === offer.supplierId)?.currency ?? region.currency,
    shipping: euros(offer.shippingCostCents),
    leadTime: offer.leadTimeDays?.toString() ?? "",
    minOrder: offer.minOrderQty?.toString().replace(".", ",") ?? "",
    preferred: offer.preferred ?? false,
    notes: offer.notes ?? "",
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{offer.id ? offer.supplierName : t("catalog.addOffer")}</DialogTitle>
          <DialogDescription className="sr-only">{t("catalog.tab.suppliers")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const price = parseMoney(v.price);
            const shipping = moneyOrNull(v.shipping);
            const lead = num(v.leadTime);
            const min = num(v.minOrder);
            const stock = num(v.stock);
            if (price === null || price < 0 || (v.shipping.trim() && shipping === null) || Number.isNaN(lead) || Number.isNaN(min) || Number.isNaN(stock) || (stock !== null && stock < 0)) return toast.error(t("auth.check"));
            run(
              () =>
                saveOfferAction(product.id, offer.id ?? null, {
                  supplierId: v.supplierId,
                  variantId: v.variantId || null,
                  supplierSku: v.supplierSku,
                  purchasePriceCents: price,
                  currency: v.currency,
                  shippingCostCents: shipping,
                  leadTimeDays: lead === null ? null : Math.round(lead),
                  minOrderQty: min,
                  preferred: v.preferred,
                  notes: v.notes,
                  ...(v.stock !== initialStock ? { supplierStock: stock } : {}),
                }),
              () => {
                toast.success(t("common.saved"));
                onClose();
              },
            );
          }}
        >
          <Field label={t("catalog.supplier")} className="col-span-2">
            <Select value={v.supplierId} onValueChange={(supplierId) => setV({ ...v, supplierId, currency: suppliers.find((s) => s.id === supplierId)?.currency ?? v.currency })} disabled={!!offer.id}>
              <SelectTrigger className="w-full" aria-label={t("catalog.supplier")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={!s.active}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {variants.length > 0 && (
            <Field label={t("catalog.variant")} className="col-span-2">
              <Select value={v.variantId || "all"} onValueChange={(id) => setV({ ...v, variantId: id === "all" ? "" : id })} disabled={!!offer.id}>
                <SelectTrigger className="w-full" aria-label={t("catalog.variant")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("catalog.allVariants")}</SelectItem>
                  {variants.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {choiceLabel(x.options, product.variantOptions)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t("inventory.purchasePrice")}>
            <Input inputMode="decimal" value={v.price} placeholder="0,00" required onChange={(e) => setV({ ...v, price: e.target.value })} />
          </Field>
          <Field label={t("company.currency")}>
            <Input value={v.currency} maxLength={3} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t("catalog.supplierSku")}>
            <Input value={v.supplierSku} maxLength={80} onChange={(e) => setV({ ...v, supplierSku: e.target.value })} />
          </Field>
          <Field label={t("catalog.shippingCost")}>
            <Input inputMode="decimal" value={v.shipping} placeholder="0,00" onChange={(e) => setV({ ...v, shipping: e.target.value })} />
          </Field>
          <Field label={t("catalog.leadTime")}>
            <Input inputMode="numeric" value={v.leadTime} onChange={(e) => setV({ ...v, leadTime: e.target.value })} />
          </Field>
          <Field label={t("catalog.minOrder")}>
            <Input inputMode="decimal" value={v.minOrder} onChange={(e) => setV({ ...v, minOrder: e.target.value })} />
          </Field>
          <Field label={t("dropship.product.supplierStock")}>
            <Input inputMode="decimal" value={v.stock} onChange={(e) => setV({ ...v, stock: e.target.value })} />
          </Field>
          <Field label={t("inventory.note")} className="col-span-2">
            <Input value={v.notes} maxLength={1000} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Checkbox checked={v.preferred} onCheckedChange={(c) => setV({ ...v, preferred: c === true })} /> {t("catalog.preferred")}
          </label>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !v.supplierId}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Pricing ------------------------------------------------------------------------------------

function MarginTable({ m }: { m: Margins }) {
  const { t, locale, region } = useI18n();
  const money = (c: number | null) => (c === null ? "—" : formatMoney(c, locale, region));
  const pct = (p: number | null) => (p === null ? "" : ` (${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(p)} %)`);
  const rows: [string, string, boolean?][] = [
    [t("catalog.revenue"), money(m.revenueCents)],
    [t("inventory.purchasePrice"), m.purchaseCents === null ? "—" : `− ${money(m.purchaseCents)}`],
    [t("catalog.grossMargin"), `${money(m.grossMarginCents)}${pct(m.grossMarginPercent)}`, true],
    [t("catalog.paymentFee"), `− ${money(m.paymentFeeCents)}`],
    [t("catalog.shippingCost"), `− ${money(m.shippingCents)}`],
    [t("catalog.otherCost"), `− ${money(m.otherCents)}`],
    [t("catalog.contribution"), `${money(m.contributionCents)}${pct(m.contributionPercent)}`, true],
  ];
  return (
    <dl className="grid gap-1 text-sm">
      {rows.map(([label, value, strong]) => (
        <div key={label} className={cn("flex justify-between gap-6", strong && "border-t pt-1 font-semibold")}>
          <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Pricing({ product, margins, fees, variants, can }: Parameters<typeof ProductEditor>[0] & { product: EditorProduct }) {
  const { t, locale } = useI18n();
  if (!margins || !fees) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{product.name}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <MarginTable m={margins} />
          <p className="text-xs text-muted-foreground">
            {t("catalog.feeSetting", { percent: new Intl.NumberFormat(locale).format(fees.feePercent), fixed: (fees.feeFixedCents / 100).toFixed(2).replace(".", ",") })}{" "}
            {can.settings && (
              <Link href="/app/settings#fees" className="text-primary hover:underline">
                {t("industries.change")}
              </Link>
            )}
          </p>
        </CardContent>
      </Card>
      {variants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("catalog.tab.variants")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {variants.map((v) => (
              <div key={v.id} className="grid gap-1">
                <div className="text-sm font-medium">{choiceLabel(v.options, product.variantOptions)}</div>
                <MarginTable m={v.margins} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Images -------------------------------------------------------------------------------------

function Images({ product, images, can }: Parameters<typeof ProductEditor>[0] & { product: EditorProduct }) {
  const { t } = useI18n();
  const { pending, run, router } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (files: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const form = new FormData();
        form.append("file", file);
        form.append("category", "product");
        const res = await fetch("/app/documents/upload", { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string };
        if (!body.ids?.[0]) {
          toast.error(t(`documents.${body.error ?? "TYPE"}`));
          continue;
        }
        const added = await addImageAction(product.id, body.ids[0]);
        if (!added.ok) toast.error(t(added.error ?? "common.error"));
      }
    } finally {
      setUploading(false);
      router.refresh();
    }
  };
  return (
    <div className="grid gap-4">
      {can.manage && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <Button className="w-fit" disabled={uploading} onClick={() => input.current?.click()}>
            <ImagePlus className="size-4" /> {uploading ? t("common.loading") : t("catalog.addImages")}
          </Button>
        </>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {images.map((image, index) => (
          <figure key={image.id} className="grid gap-2 rounded-xl border bg-card p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/app/documents/${image.documentId}/file`} alt={image.alt ?? image.name} className="aspect-square w-full rounded object-cover" loading="lazy" />
            {index === 0 && (
              <Badge variant="secondary" className="w-fit">
                {t("catalog.mainImage")}
              </Badge>
            )}
            {can.manage && (
              <div className="flex justify-between">
                <Button variant="ghost" size="icon" aria-label={t("catalog.moveUp")} disabled={pending || index === 0} onClick={() => run(() => moveImageAction(image.id, "up"), () => undefined)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("catalog.moveDown")} disabled={pending || index === images.length - 1} onClick={() => run(() => moveImageAction(image.id, "down"), () => undefined)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("common.delete")} disabled={pending} onClick={() => run(() => removeImageAction(image.id), () => undefined)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}

// --- Stock --------------------------------------------------------------------------------------

function Stock({ product, variants, movements, can, held }: Parameters<typeof ProductEditor>[0] & { product: EditorProduct }) {
  const { t, locale, region } = useI18n();
  const { pending, run } = useAction();
  const [counting, setCounting] = useState<{ variantId: string | null; label: string; counted: string; note: string } | null>(null);
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const label = (variantId: string | null) => (variantId ? choiceLabel(variants.find((v) => v.id === variantId)?.options ?? {}, product.variantOptions) : product.name);
  const targets = variants.length
    ? variants.filter((v) => v.active).map((v) => ({ id: v.id, label: label(v.id), stock: v.stock, held: held?.byVariant[v.id] ?? 0 }))
    : [{ id: null, label: product.name, stock: product.stock, held: held?.total ?? 0 }];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("inventory.stock")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {targets.map((target) => (
            <div key={target.id ?? "product"} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{target.label}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {target.held > 0 && <span className="text-xs text-muted-foreground">{t("catalog.held", { count: qty.format(target.held) })} ·</span>}
                {qty.format(target.stock)} {product.unit}
                {can.stock && (
                  <Button variant="ghost" size="icon" aria-label={t("inventory.count")} onClick={() => setCounting({ variantId: target.id, label: target.label, counted: String(target.stock).replace(".", ","), note: "" })}>
                    <Boxes className="size-4" />
                  </Button>
                )}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("catalog.movements")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          {movements.length === 0 && <span className="text-muted-foreground">—</span>}
          {movements.map((m) => (
            <div key={m.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-muted-foreground">
                {formatDate(m.at, locale, region)} · {t(`catalog.movement.${m.type}`)}
                {m.variantId && ` · ${label(m.variantId)}`}
                {m.note && ` · ${m.note}`}
              </span>
              <span className={cn("tabular-nums", m.quantity < 0 && "text-destructive")}>
                {m.quantity > 0 ? "+" : ""}
                {qty.format(m.quantity)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Dialog open={!!counting} onOpenChange={(open) => !open && setCounting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("inventory.count")}</DialogTitle>
            <DialogDescription>{counting?.label}</DialogDescription>
          </DialogHeader>
          {counting && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const counted = num(counting.counted);
                if (counted === null || Number.isNaN(counted)) return toast.error(t("auth.check"));
                run(() => countStockAction(product.id, counting.variantId, counted, counting.note), () => {
                  toast.success(t("common.saved"));
                  setCounting(null);
                });
              }}
            >
              <Field label={`${t("inventory.counted")} (${product.unit})`}>
                <Input inputMode="decimal" value={counting.counted} onChange={(e) => setCounting({ ...counting, counted: e.target.value })} required autoFocus />
              </Field>
              <Field label={t("inventory.note")}>
                <Input value={counting.note} maxLength={500} onChange={(e) => setCounting({ ...counting, note: e.target.value })} />
              </Field>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
