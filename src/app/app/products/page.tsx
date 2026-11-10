import { FolderTree, ImageIcon, Package, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { FilterChips, Pager, SearchBox, SortHead } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { CATALOG_SORTS, CATALOG_STATUS, listCatalog, listCategories, type CatalogSort } from "@/server/catalog";
import { requirePageContext } from "@/server/request";
import { cn } from "@/lib/utils";
import { CategoryFilter } from "./category-filter";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("products.title") };
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string; sort?: string; dir?: string; page?: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const status = (CATALOG_STATUS as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof CATALOG_STATUS)[number]) : undefined;
  const sort = (CATALOG_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as CatalogSort) : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const categories = await listCategories(ctx);
  const categoryId = categories.some((c) => c.id === sp.category) ? sp.category : undefined;
  const { rows, total, pageSize } = await listCatalog(ctx, { q: sp.q, status, categoryId, sort, dir: sp.dir === "desc" ? "desc" : "asc", page });
  const canManage = ctx.permissions.has("products.manage");
  const money = (cents: number) => formatMoney(cents, locale, region);
  const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const filtered = Boolean(sp.q || sp.status || categoryId);
  return (
    <>
      <PageHeader
        title={t("products.title")}
        actions={
          canManage && (
            <>
              <Button asChild variant="outline">
                <Link href="/app/products/categories">
                  <FolderTree className="size-4" /> {t("catalog.categories")}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/app/products/import">
                  <Upload className="size-4" /> {t("catalog.import.title")}
                </Link>
              </Button>
              <Button asChild>
                <Link href="/app/products/new">
                  <Plus className="size-4" /> {t("products.new")}
                </Link>
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 grid gap-3">
        <div className="flex flex-wrap gap-3">
          <SearchBox placeholder={t("catalog.search")} />
          {categories.length > 0 && <CategoryFilter categories={categories.map((c) => ({ id: c.id, name: c.name }))} />}
        </div>
        <FilterChips name="status" options={[{ value: null, label: t("invoices.all") }, ...CATALOG_STATUS.map((s) => ({ value: s, label: t(`catalog.status.${s}`) }))]} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title={filtered ? t("invoices.noMatch") : t("products.emptyTitle")}
          action={
            !filtered && canManage ? (
              <Button asChild>
                <Link href="/app/products/new">
                  <Plus className="size-4" /> {t("products.new")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>
                    <SortHead name="name" label={t("products.name")} />
                  </TableHead>
                  <TableHead>
                    <SortHead name="sku" label={t("products.sku")} />
                  </TableHead>
                  <TableHead>{t("catalog.category")}</TableHead>
                  <TableHead className="text-right">
                    <SortHead name="price" label={t("products.price")} align="right" />
                  </TableHead>
                  <TableHead className="text-right">{t("catalog.margin")}</TableHead>
                  <TableHead className="text-right">
                    <SortHead name="stock" label={t("inventory.stock")} align="right" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const low = p.trackStock && p.minStock !== null && Number(p.stockQuantity) <= Number(p.minStock);
                  return (
                    <TableRow key={p.id} className={p.active ? undefined : "opacity-70"}>
                      <TableCell className="p-2">
                        {p.imageId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/app/documents/${p.imageId}/file`} alt="" className="size-9 rounded object-cover" loading="lazy" />
                        ) : (
                          <span className="grid size-9 place-items-center rounded bg-muted text-muted-foreground">
                            <ImageIcon className="size-4" aria-hidden />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/app/products/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                        {p.variants > 0 && <span className="ml-2 text-xs text-muted-foreground">{t("catalog.variantCount", { count: p.variants })}</span>}
                        {!p.active && (
                          <Badge variant="outline" className="ml-2">
                            {t(p.importId ? "catalog.status.imported" : "products.inactive")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{p.sku ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.categoryName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.priceCents)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", (p.margins.contributionCents ?? 0) < 0 && "text-destructive")}>
                        {p.margins.contributionPercent === null ? "—" : `${qty.format(p.margins.contributionPercent)} %`}
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", low && "font-semibold text-destructive")}>
                        {p.trackStock ? `${qty.format(Number(p.stockQuantity))} ${p.unit}` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-2 md:hidden">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/app/products/${p.id}`} className={cn("flex items-center gap-3 rounded-xl border bg-card p-3", !p.active && "opacity-70")}>
                  {p.imageId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/app/documents/${p.imageId}/file`} alt="" className="size-11 rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="grid size-11 place-items-center rounded bg-muted text-muted-foreground">
                      <ImageIcon className="size-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[p.sku, p.categoryName, money(p.priceCents)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {p.trackStock && <span className="text-sm tabular-nums">{qty.format(Number(p.stockQuantity))}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / pageSize))} label={t("catalog.count", { count: total })} />
        </>
      )}
    </>
  );
}
