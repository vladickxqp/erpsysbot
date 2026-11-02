import { FileSignature, Plus } from "lucide-react";
import Link from "next/link";
import { QuoteStatusBadge } from "@/components/app/badges";
import { FilterChips, Pager, SearchBox } from "@/components/app/list-controls";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { listQuotes, QUOTE_STATUSES, type QuoteStatus } from "@/server/quotes";
import { requirePageContext } from "@/server/request";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("quotes.title") };
}

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requirePageContext("orders.read");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const status = (QUOTE_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as QuoteStatus) : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total, pageSize } = await listQuotes(ctx, { q: sp.q, status, page });
  const canCreate = ctx.permissions.has("orders.create");
  const filtered = Boolean(sp.q || sp.status);
  const newButton = canCreate && (
    <Button asChild>
      <Link href="/app/quotes/new">
        <Plus className="size-4" /> {t("quotes.new")}
      </Link>
    </Button>
  );
  return (
    <>
      <PageHeader title={t("quotes.title")} actions={newButton} />
      <div className="mb-4 grid gap-3">
        <SearchBox placeholder={t("quotes.searchPlaceholder")} />
        <FilterChips
          name="status"
          options={[{ value: null, label: t("common.all") }, ...QUOTE_STATUSES.map((s) => ({ value: s, label: t(`quotes.${s}`) }))]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={FileSignature} title={filtered ? t("orders.noMatch") : t("quotes.emptyTitle")} action={!filtered ? newButton || undefined : undefined} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("quotes.number")}</TableHead>
                  <TableHead>{t("orders.client")}</TableHead>
                  <TableHead>{t("orders.orderTitle")}</TableHead>
                  <TableHead>{t("orders.status")}</TableHead>
                  <TableHead>{t("quotes.validUntil")}</TableHead>
                  <TableHead className="text-right">{t("orders.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="tabular-nums">
                      <Link href={`/app/quotes/${q.id}`} className="font-medium hover:underline">
                        {q.number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/app/quotes/${q.id}`} className="hover:underline">
                        {q.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{q.title ?? "—"}</TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} expired={q.expired} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{q.validUntil ? formatDate(q.validUntil, locale, region) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(q.grossCents, locale, region)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-2 md:hidden">
            {rows.map((q) => (
              <li key={q.id}>
                <Link href={`/app/quotes/${q.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {q.number} · {q.clientName}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{formatMoney(q.grossCents, locale, region)}</div>
                  </div>
                  <QuoteStatusBadge status={q.status} expired={q.expired} />
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} pages={Math.max(1, Math.ceil(total / pageSize))} label={t("quotes.count", { count: total })} />
        </>
      )}
    </>
  );
}
