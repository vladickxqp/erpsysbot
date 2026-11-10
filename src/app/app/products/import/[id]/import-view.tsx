"use client";

import { ArrowLeft, CheckCircle2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { StatCard } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { IMPORT_FIELDS, type ImportField } from "@/lib/product-import";
import { cn } from "@/lib/utils";
import { activateImportAction, applyImportAction, discardImportAction, importMappingAction, type CatalogResult } from "../../catalog-actions";

type Row = {
  line: number;
  name: string | null;
  sku: string | null;
  parentSku: string | null;
  variant: string | null;
  category: string | null;
  priceCents: number | null;
  purchasePriceCents: number | null;
  stock: number | null;
  supplier: string | null;
  errors: string[];
};

/** "price.invalid" → which field, which problem; parent.* belongs to the parent SKU column. */
function problem(code: string, t: (key: string) => string) {
  const [field, kind] = code.split(".");
  const name = field === "parent" ? "parentSku" : field;
  const what = field === "parent" ? `parent${kind[0].toUpperCase()}${kind.slice(1)}` : kind;
  return `${t(`catalog.import.field.${name}`)}: ${t(`catalog.import.problem.${what}`)}`;
}

export function ImportView(props: {
  id: string;
  fileName: string;
  status: "PREVIEW" | "APPLIED" | "DISCARDED";
  createdCount: number;
  header: string[];
  mapping: (ImportField | null)[];
  summary: { products: number; variants: number; errors: number; categories: number; newSuppliers: number };
  total: number;
  rows: Row[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const editable = props.status === "PREVIEW";
  const money = (c: number | null) => (c === null ? "—" : formatMoney(c, locale, region));
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const run = (work: () => Promise<CatalogResult>, done: (r: CatalogResult) => void) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        done(result);
        router.refresh();
      } else toast.error(t(result.error ?? "common.error"));
    });
  const setColumn = (index: number, field: ImportField | null) => {
    // One column per field: choosing a field elsewhere frees it here.
    const next = props.mapping.map((f, i) => (i === index ? field : field && f === field ? null : f));
    run(() => importMappingAction(props.id, next), () => undefined);
  };
  const rows = onlyErrors ? props.rows.filter((r) => r.errors.length) : props.rows;
  const ready = props.summary.products + props.summary.variants;
  return (
    <>
      <Link href="/app/products/import" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("catalog.import.title")}
      </Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{props.fileName}</h1>
          <Badge variant={props.status === "APPLIED" ? "secondary" : "outline"}>{t(`catalog.import.status.${props.status}`)}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              <Button variant="outline" disabled={pending} onClick={() => setDiscarding(true)}>
                {t("catalog.import.discard")}
              </Button>
              <Button
                disabled={pending || ready === 0}
                onClick={() =>
                  run(
                    () => applyImportAction(props.id),
                    (r) => toast.success(t("catalog.import.created", { count: r.count ?? 0 })),
                  )
                }
              >
                {t("catalog.import.apply", { count: ready })}
              </Button>
            </>
          )}
          {props.status === "APPLIED" && (
            <>
              <Button variant="outline" asChild>
                <Link href="/app/products?status=imported">{t("catalog.status.imported")}</Link>
              </Button>
              <Button disabled={pending} onClick={() => run(() => activateImportAction(props.id), (r) => toast.success(t("catalog.import.activated", { count: r.count ?? 0 })))}>
                {t("catalog.import.activate")}
              </Button>
            </>
          )}
        </div>
      </div>

      {props.status !== "DISCARDED" && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label={t("catalog.import.products")} value={String(props.summary.products)} />
          <StatCard label={t("catalog.tab.variants")} value={String(props.summary.variants)} />
          <StatCard label={t("catalog.import.errors")} value={String(props.summary.errors)} className={props.summary.errors ? "border-destructive/50" : undefined} />
          <StatCard label={t("catalog.categories")} value={String(props.summary.categories)} />
          <StatCard label={t("catalog.import.newSuppliers")} value={String(props.summary.newSuppliers)} />
        </div>
      )}

      {editable && (
        <div className="mb-4 rounded-xl border bg-card p-4">
          <div className="mb-3 text-sm font-medium">{t("catalog.import.columns")}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {props.header.map((column, index) => (
              <label key={index} className="grid gap-1">
                <span className="truncate text-xs text-muted-foreground">{column || `#${index + 1}`}</span>
                <Select value={props.mapping[index] ?? "skip"} onValueChange={(v) => setColumn(index, v === "skip" ? null : (v as ImportField))} disabled={pending}>
                  <SelectTrigger className="w-full" aria-label={column || `#${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">{t("catalog.import.skip")}</SelectItem>
                    {IMPORT_FIELDS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`catalog.import.field.${f}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ))}
          </div>
        </div>
      )}

      {props.status !== "DISCARDED" && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <Button size="sm" variant={onlyErrors ? "outline" : "secondary"} onClick={() => setOnlyErrors(false)}>
              {t("invoices.all")} ({props.total})
            </Button>
            <Button size="sm" variant={onlyErrors ? "secondary" : "outline"} onClick={() => setOnlyErrors(true)} disabled={!props.summary.errors}>
              {t("catalog.import.errors")} ({props.summary.errors})
            </Button>
            {props.rows.length < props.total && <span className="text-muted-foreground">{t("catalog.import.shown", { count: props.rows.length })}</span>}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{t("products.name")}</TableHead>
                  <TableHead>{t("products.sku")}</TableHead>
                  <TableHead>{t("catalog.category")}</TableHead>
                  <TableHead className="text-right">{t("products.price")}</TableHead>
                  <TableHead className="text-right">{t("inventory.purchasePrice")}</TableHead>
                  <TableHead className="text-right">{t("inventory.stock")}</TableHead>
                  <TableHead>{t("catalog.supplier")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.line} className={cn(r.errors.length && "bg-destructive/5")}>
                    <TableCell className="align-top text-muted-foreground tabular-nums">{r.line}</TableCell>
                    <TableCell className="align-top">
                      <div className="flex items-start gap-1.5">
                        {r.errors.length ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />}
                        <div className="min-w-0">
                          <div className="font-medium">{r.parentSku ? `${r.parentSku} · ${r.variant ?? "—"}` : (r.name ?? "—")}</div>
                          {r.errors.map((e) => (
                            <div key={e} className="text-xs text-destructive">
                              {problem(e, t)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">{r.sku ?? "—"}</TableCell>
                    <TableCell className="align-top text-muted-foreground">{r.category ?? "—"}</TableCell>
                    <TableCell className="align-top text-right tabular-nums">{money(r.priceCents)}</TableCell>
                    <TableCell className="align-top text-right tabular-nums">{money(r.purchasePriceCents)}</TableCell>
                    <TableCell className="align-top text-right tabular-nums">{r.stock === null ? "—" : qty.format(r.stock)}</TableCell>
                    <TableCell className="align-top text-muted-foreground">{r.supplier ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t("catalog.import.discard")}
        text={props.fileName}
        confirm={t("catalog.import.discard")}
        destructive
        onConfirm={() => run(() => discardImportAction(props.id), () => router.push("/app/products/import"))}
      />
    </>
  );
}
