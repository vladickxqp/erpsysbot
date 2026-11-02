import { formatDate, isLocale, MESSAGES, regionOf, translator } from "@/i18n";
import { countryProfile } from "@/lib/countries";
import { tablePdf } from "@/server/pdf";
import { ForbiddenError } from "@/server/permissions";
import { buildReport, REPORTS, reportCsv, resolvePeriod, type ReportKind } from "@/server/reports";
import { requireContext } from "@/server/request";
import { formatCell } from "../format";

export async function GET(request: Request) {
  const ctx = await requireContext();
  const sp = new URL(request.url).searchParams;
  const kind = sp.get("report") as ReportKind;
  if (!(REPORTS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404 });
  const range = resolvePeriod(ctx, sp.get("period") ?? undefined, sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  const locale = isLocale(ctx.user.locale) ? ctx.user.locale : "de";
  const t = translator(MESSAGES[locale]);
  const region = regionOf(ctx.organization);
  try {
    const report = await buildReport(ctx, kind, range.from, range.to);
    const name = `${t(`reports.${kind}`)}_${range.from}_${range.to}`.replace(/[^\w.-]+/g, "_");
    if (sp.get("format") === "pdf") {
      const pdf = await tablePdf({
        paper: countryProfile(ctx.organization.country).paper,
        company: ctx.organization.name,
        title: t(`reports.${kind}`),
        subtitle: kind === "aging" ? formatDate(range.to, locale, region) : `${formatDate(range.from, locale, region)} – ${formatDate(range.to, locale, region)}`,
        columns: report.columns.map((c) => ({ label: t(c.label), align: c.kind === "text" || c.kind === "date" ? "left" : "right" })),
        rows: report.rows.map((row) => report.columns.map((c) => formatCell(c, row[c.key], locale, region, t))),
        totals: report.totals
          ? report.columns.map((c, i) => (i === 0 ? t("reports.total") : c.key in report.totals! ? formatCell(c, report.totals![c.key], locale, region, t) : ""))
          : undefined,
      });
      return new Response(Buffer.from(pdf), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"`, "Cache-Control": "no-store" },
      });
    }
    return new Response(reportCsv(report, t), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
