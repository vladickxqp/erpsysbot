import { FileText, Plus, Repeat } from "lucide-react";
import Link from "next/link";
import { InvoiceStatusBadge } from "@/components/app/badges";
import { FilterChips, Pager, SearchBox } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { INVOICE_FILTERS, type InvoiceFilter } from "@/lib/domain";
import { listInvoices } from "@/server/invoices";
import { requirePageContext } from "@/server/request";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("invoices.title") };
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string }> }) {
  const ctx = await requirePageContext("invoices.read");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const filter = (INVOICE_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as InvoiceFilter) : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total, pageSize } = await listInvoices(ctx, { q: sp.q, filter, page });
  const canCreate = ctx.permissions.has("invoices.create");
  const filtered = Boolean(sp.q || sp.filter);
  const label = (f: InvoiceFilter) => t(f === "OPEN" ? "invoices.open" : f === "PAID" ? "invoices.paid" : `invoices.${f}`);
  return (
    <>
      <PageHeader
        title={t("invoices.title")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/app/invoices/recurring">
                <Repeat className="size-4" /> {t("recurring.title")}
              </Link>
            </Button>
            {canCreate && (
              <Button asChild>
                <Link href="/app/invoices/new">
                  <Plus className="size-4" /> {t("invoices.new")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-3">
        <SearchBox placeholder={t("invoices.searchPlaceholder")} />
        <FilterChips name="filter" options={[{ value: null, label: t("invoices.all") }, ...INVOICE_FILTERS.map((f) => ({ value: f, label: label(f) }))]} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={filtered ? t("invoices.noMatch") : t("invoices.emptyTitle")}
          action={
            !filtered && canCreate ? (
              <Button asChild>
                <Link href="/app/invoices/new">
                  <Plus className="size-4" /> {t("invoices.new")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.number")}</TableHead>
                  <TableHead>{t("invoices.client")}</TableHead>
                  <TableHead>{t("invoices.issueDate")}</TableHead>
                  <TableHead>{t("invoices.dueDate")}</TableHead>
                  <TableHead>{t("orders.status")}</TableHead>
                  <TableHead className="text-right">{t("invoices.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium tabular-nums">
                      <Link href={`/app/invoices/${i.id}`} className="hover:underline">
                        {i.number ?? t("invoices.draftNumber")}
                      </Link>
                    </TableCell>
                    <TableCell>{i.clientName}</TableCell>
                    <TableCell className="text-muted-foreground">{i.issueDate ? formatDate(i.issueDate, locale, region) : "—"}</TableCell>
                    <TableCell className={i.overdue ? "text-destructive" : "text-muted-foreground"}>
                      {i.dueDate ? formatDate(i.dueDate, locale, region) : "—"}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={i.status} overdue={i.overdue} kind={i.kind} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(i.grossCents, locale, region)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-2 md:hidden">
            {rows.map((i) => (
              <li key={i.id}>
                <Link href={`/app/invoices/${i.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.number ?? t("invoices.draftNumber")}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {i.clientName} · {formatMoney(i.grossCents, locale, region)}
                    </div>
                  </div>
                  <InvoiceStatusBadge status={i.status} overdue={i.overdue} kind={i.kind} />
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / pageSize))} label={t("invoices.count", { count: total })} />
        </>
      )}
    </>
  );
}
