import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";
import { FilterChips } from "@/components/app/list-controls";
import { FlowChart } from "@/components/app/flow-chart";
import { PageHeader, StatCard } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { financeSummary, listTransactions, monthlyFlow } from "@/server/finance";
import { today } from "@/server/money";
import { requirePageContext } from "@/server/request";
import { Transactions } from "./transactions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("finance.title") };
}

const PERIODS = ["thisMonth", "lastMonth", "thisQuarter", "thisYear"] as const;
type Period = (typeof PERIODS)[number];

function range(period: Period, now: string): [string, string] {
  const [y, m] = now.split("-").map(Number);
  const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  switch (period) {
    case "lastMonth":
      return [iso(y, m - 1, 1), iso(y, m, 0)];
    case "thisQuarter": {
      const first = Math.floor((m - 1) / 3) * 3 + 1;
      return [iso(y, first, 1), now];
    }
    case "thisYear":
      return [iso(y, 1, 1), now];
    default:
      return [iso(y, m, 1), now];
  }
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await requirePageContext("finance.read");
  const { t, locale, region } = await getT();
  const sp = await searchParams;
  const period = (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as Period) : "thisMonth";
  const [from, to] = range(period, today(ctx.organization.timezone));
  const [summary, flow, list] = await Promise.all([
    financeSummary(ctx, from, to),
    monthlyFlow(ctx, 6),
    listTransactions(ctx, { from, to, pageSize: 100 }),
  ]);
  const money = (c: number) => formatMoney(c, locale, region);
  return (
    <>
      <PageHeader title={t("finance.title")} />
      <div className="mb-4">
        <FilterChips name="period" options={PERIODS.map((p) => ({ value: p === "thisMonth" ? null : p, label: t(`finance.${p}`) }))} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("finance.income")} value={money(summary.incomeCents - summary.refundCents)} icon={ArrowUpRight} />
        <StatCard label={t("finance.expenses")} value={money(summary.expenseCents)} icon={ArrowDownRight} />
        <StatCard
          label={t("finance.result")}
          value={money(summary.resultCents)}
          icon={Scale}
          className={summary.resultCents < 0 ? "[&_div:nth-child(2)]:text-destructive" : undefined}
        />
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("finance.flow")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FlowChart data={flow} />
        </CardContent>
      </Card>
      <Transactions
        rows={list.rows.map((r) => ({
          id: r.id,
          type: r.type,
          amountCents: r.amountCents,
          bookedOn: r.bookedOn,
          category: r.category,
          description: r.description,
          fromInvoice: Boolean(r.paymentId),
          invoiceId: r.invoiceId,
        }))}
        total={list.total}
        today={today(ctx.organization.timezone)}
        canCreate={ctx.permissions.has("finance.create")}
        canExport={ctx.permissions.has("finance.export")}
        from={from}
        to={to}
      />
    </>
  );
}
