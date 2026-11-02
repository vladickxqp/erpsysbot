import { FileDown, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlowChart } from "@/components/app/flow-chart";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { buildReport, PERIODS, REPORT_PERMISSION, REPORTS, resolvePeriod, type ReportKind } from "@/server/reports";
import { requireContext } from "@/server/request";
import { formatCell } from "./format";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("reports.title") };
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ report?: string; period?: string; from?: string; to?: string }> }) {
  const ctx = await requireContext();
  const { t, locale } = await getT();
  const sp = await searchParams;
  const allowed = REPORTS.filter((r) => ctx.permissions.has(REPORT_PERMISSION[r]));
  if (!allowed.length) redirect("/app");
  const kind: ReportKind = (allowed as readonly string[]).includes(sp.report ?? "") ? (sp.report as ReportKind) : allowed[0];
  const range = resolvePeriod(ctx, sp.period, sp.from, sp.to);
  const report = await buildReport(ctx, kind, range.from, range.to);
  const query = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams({ report: kind, ...(range.period === "custom" ? { from: range.from, to: range.to } : { period: range.period }) });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return q.toString();
  };
  const right = (kind: string) => kind !== "text" && kind !== "date";

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={`/app/reports/export?${query({ format: "csv" })}`} download>
                <FileSpreadsheet className="size-4" /> CSV
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/app/reports/export?${query({ format: "pdf" })}`} target="_blank" rel="noopener">
                <FileDown className="size-4" /> PDF
              </a>
            </Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {allowed.map((r) => (
          <Link
            key={r}
            href={`/app/reports?${query({ report: r })}`}
            className={cn("rounded-full border px-3 py-1 text-sm", r === kind ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {t(`reports.${r}`)}
          </Link>
        ))}
      </div>
      {kind !== "aging" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/app/reports?${query({ period: p, from: null, to: null })}`}
              className={cn("rounded-md px-2.5 py-1 text-sm", range.period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              {t(`reports.${p}`)}
            </Link>
          ))}
          <form className="flex items-center gap-1" action="/app/reports">
            <input type="hidden" name="report" value={kind} />
            <Input type="date" name="from" defaultValue={range.from} className="h-8 w-36" aria-label={t("calendar.from")} />
            <span className="text-muted-foreground">–</span>
            <Input type="date" name="to" defaultValue={range.to} className="h-8 w-36" aria-label={t("calendar.to")} />
            <Button type="submit" size="sm" variant="outline">
              OK
            </Button>
          </form>
        </div>
      )}

      {kind === "revenue" && report.rows.length > 0 && (
        <Card className="mb-4">
          <CardContent className="pt-6">
            <FlowChart data={report.rows.map((r) => ({ month: String(r.month), income: Number(r.income), expense: Number(r.expense) }))} />
          </CardContent>
        </Card>
      )}
      {kind === "aging" && report.totals && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(["current", "d30", "d60", "d90", "d90plus"] as const).map((b) => (
            <div key={b} className={cn("rounded-xl border bg-card p-3", b !== "current" && (report.totals?.[b] ?? 0) > 0 && "border-destructive/30")}>
              <div className="text-xs text-muted-foreground">{t(`reports.${b}`)}</div>
              <div className="text-lg font-semibold tabular-nums">{formatCell({ key: b, label: "", kind: "money" }, report.totals?.[b] ?? 0, locale, t)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {report.columns.map((c) => (
                <TableHead key={c.key} className={cn(right(c.kind) && "text-right")}>
                  {t(c.label)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={report.columns.length} className="py-8 text-center text-muted-foreground">
                  {t("reports.empty")}
                </TableCell>
              </TableRow>
            )}
            {report.rows.map((row, i) => (
              <TableRow key={i}>
                {report.columns.map((c) => (
                  <TableCell key={c.key} className={cn(right(c.kind) && "text-right tabular-nums")}>
                    {formatCell(c, row[c.key], locale, t)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {report.totals && report.rows.length > 0 && (
            <TableFooter>
              <TableRow>
                {report.columns.map((c, i) => (
                  <TableCell key={c.key} className={cn("font-semibold", right(c.kind) && "text-right tabular-nums")}>
                    {i === 0 ? t("reports.total") : c.key in (report.totals ?? {}) ? formatCell(c, report.totals?.[c.key], locale, t) : ""}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </>
  );
}
