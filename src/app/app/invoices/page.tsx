import { FileText, Plus, Repeat } from "lucide-react";
import Link from "next/link";
import { InvoiceStatusBadge } from "@/components/app/badges";
import { FilterChips, Pager, SearchBox, SortHead } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { INVOICE_FILTERS, INVOICE_SORTS, type InvoiceFilter, type InvoiceSort } from "@/lib/domain";
import type { InvoiceFileKind } from "@/lib/invoicing";
import { listInvoices } from "@/server/invoices";
import { mailAvailable } from "@/server/mail";
import { requirePageContext } from "@/server/request";
import { InvoiceRowActions } from "./invoice-actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("invoices.title") };
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string; sort?: string; dir?: string }> }) {
  const ctx = await requirePageContext("invoices.read");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const filter = (INVOICE_FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as InvoiceFilter) : undefined;
  const sort = (INVOICE_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as InvoiceSort) : undefined;
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total, pageSize } = await listInvoices(ctx, { q: sp.q, filter, page, sort, dir });
  const canCreate = ctx.permissions.has("invoices.create");
  const can = { edit: canCreate, cancel: ctx.permissions.has("invoices.cancel") };
  const mail = mailAvailable();
  const format = ctx.organization.einvoiceFormat as InvoiceFileKind;
  const filtered = Boolean(sp.q || sp.filter);
  const label = (f: InvoiceFilter) =>
    t(f === "OPEN" ? "invoices.open" : f === "PAID" ? "invoices.paid" : f === "SENT" || f === "CREDITED" ? `invoicing.status_${f}` : `invoices.${f}`);
  const money = (cents: number, currency: string | null) => formatMoney(cents, locale, { ...region, currency: currency ?? region.currency });
  const date = (iso: string | Date | null) => (iso ? formatDate(iso, locale, region) : "—");
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
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortHead name="number" label={t("invoices.number")} />
                  </TableHead>
                  <TableHead>
                    <SortHead name="client" label={t("invoices.client")} />
                  </TableHead>
                  <TableHead>
                    <SortHead name="issueDate" label={t("invoices.issueDate")} />
                  </TableHead>
                  <TableHead>
                    <SortHead name="dueDate" label={t("invoices.dueDate")} />
                  </TableHead>
                  <TableHead>
                    <SortHead name="status" label={t("orders.status")} />
                  </TableHead>
                  <TableHead>
                    <SortHead name="created" label={t("invoicing.created")} />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortHead name="total" label={t("invoices.total")} align="right" />
                  </TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">{t("invoicing.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium tabular-nums">
                      <Link href={`/app/invoices/${i.id}`} className="hover:underline">
                        {i.number ?? t("invoices.draftNumber")}
                      </Link>
                      {i.title && <div className="max-w-48 truncate text-xs font-normal text-muted-foreground">{i.title}</div>}
                    </TableCell>
                    <TableCell>{i.clientName}</TableCell>
                    <TableCell className="text-muted-foreground">{date(i.issueDate)}</TableCell>
                    <TableCell className={i.overdue ? "text-destructive" : "text-muted-foreground"}>{date(i.dueDate)}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={i.status} overdue={i.overdue} kind={i.kind} sent={!!i.sentAt} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{date(i.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(i.grossCents, i.currency)}</TableCell>
                    <TableCell className="p-1">
                      <InvoiceRowActions invoice={i} can={can} mail={mail} format={format} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-2 md:hidden">
            {rows.map((i) => (
              <li key={i.id} className="flex items-center gap-1 rounded-xl border bg-card pr-1">
                <Link href={`/app/invoices/${i.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.number ?? t("invoices.draftNumber")}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {i.clientName} · {money(i.grossCents, i.currency)}
                    </div>
                  </div>
                  <InvoiceStatusBadge status={i.status} overdue={i.overdue} kind={i.kind} sent={!!i.sentAt} />
                </Link>
                <InvoiceRowActions invoice={i} can={can} mail={mail} format={format} />
              </li>
            ))}
          </ul>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / pageSize))} label={t("invoices.count", { count: total })} />
        </>
      )}
    </>
  );
}
