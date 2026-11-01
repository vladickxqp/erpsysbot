import { ArrowDownRight, ArrowUpRight, FileText, Scale, ShoppingCart, TrendingUp, UserCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { InvoiceStatusBadge } from "@/components/app/badges";
import { FlowChart } from "@/components/app/flow-chart";
import { GrowthChart } from "@/components/app/growth-chart";
import { EmptyState, PageHeader, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { clientStats, invoiceStats, openOrderStats } from "@/server/dashboard";
import { financeSummary, monthlyFlow } from "@/server/finance";
import { listInvoices } from "@/server/invoices";
import { today } from "@/server/money";
import { requireContext } from "@/server/request";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("dashboard.title") };
}

export default async function DashboardPage() {
  const ctx = await requireContext();
  const { t, locale } = await getT();
  const nf = new Intl.NumberFormat(locale);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const now = today(ctx.organization.timezone);
  const monthStart = `${now.slice(0, 7)}-01`;
  const money = (cents: number) => formatMoney(cents, locale);

  const [stats, money1, flow, owed, open, recent] = await Promise.all([
    can("clients.read") ? clientStats(ctx) : null,
    can("finance.read") ? financeSummary(ctx, monthStart, now) : null,
    can("finance.read") ? monthlyFlow(ctx) : null,
    can("invoices.read") ? invoiceStats(ctx) : null,
    can("orders.read") ? openOrderStats(ctx) : null,
    can("invoices.read") ? listInvoices(ctx, { pageSize: 5 }) : null,
  ]);

  if (stats && stats.total === 0) {
    return (
      <>
        <PageHeader title={t("dashboard.title")} description={ctx.organization.name} />
        <EmptyState
          icon={Users}
          title={t("dashboard.emptyTitle")}
          action={
            <Button asChild>
              <Link href="/app/clients?new=1">{t("dashboard.addFirst")}</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("dashboard.title")} description={ctx.organization.name} />
      <div className="grid gap-4">
        {(money1 || owed || open) && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {money1 && (
              <>
                <StatCard label={t("dash2.revenue")} value={money(money1.incomeCents - money1.refundCents)} icon={ArrowUpRight} />
                <StatCard label={t("dash2.expenses")} value={money(money1.expenseCents)} icon={ArrowDownRight} />
                <StatCard label={t("dash2.result")} value={money(money1.resultCents)} icon={Scale} />
              </>
            )}
            {owed && (
              <Link href={owed.overdue ? "/app/invoices?filter=OVERDUE" : "/app/invoices?filter=OPEN"} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatCard
                  label={t("dash2.outstanding")}
                  value={money(owed.outstandingCents)}
                  hint={owed.overdue ? t("dash2.overdue", { count: nf.format(owed.overdue) }) : undefined}
                  icon={FileText}
                  className={owed.overdue ? "h-full border-warning/50 hover:bg-muted/40" : "h-full hover:bg-muted/40"}
                />
              </Link>
            )}
            {open && !money1 && (
              <Link href="/app/orders" className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatCard label={t("dash2.openOrders")} value={nf.format(open.count)} hint={money(open.netCents)} icon={ShoppingCart} className="h-full hover:bg-muted/40" />
              </Link>
            )}
          </div>
        )}

        {stats && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t("dashboard.clients")} value={nf.format(stats.total)} icon={Users} />
            <StatCard label={t("dashboard.active")} value={nf.format(stats.active)} icon={UserCheck} />
            {open && money1 ? (
              <Link href="/app/orders" className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatCard label={t("dash2.openOrders")} value={nf.format(open.count)} hint={money(open.netCents)} icon={ShoppingCart} className="h-full hover:bg-muted/40" />
              </Link>
            ) : (
              <StatCard label={t("dashboard.leads")} value={nf.format(stats.leads)} icon={TrendingUp} />
            )}
            <StatCard
              label={t("dashboard.newThisMonth")}
              value={nf.format(stats.newThisMonth)}
              hint={t("dashboard.vsLastMonth", { count: nf.format(stats.newLastMonth) })}
              icon={UserPlus}
            />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {flow && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("dash2.flow")}</CardTitle>
              </CardHeader>
              <CardContent>
                <FlowChart data={flow} />
              </CardContent>
            </Card>
          )}
          {stats && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("dashboard.growth")}</CardTitle>
              </CardHeader>
              <CardContent>
                <GrowthChart data={stats.growth} />
              </CardContent>
            </Card>
          )}
        </div>

        {recent && recent.rows.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t("dash2.recentInvoices")}</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/app/invoices">{t("nav.invoices")}</Link>
              </Button>
            </CardHeader>
            <CardContent className="grid divide-y p-0">
              {recent.rows.map((inv) => (
                <Link key={inv.id} href={`/app/invoices/${inv.id}`} className="flex items-center gap-3 px-6 py-3 text-sm hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{inv.clientName}</div>
                    <div className="text-xs text-muted-foreground">
                      {inv.number ?? t("invoices.draftNumber")}
                      {inv.issueDate && ` · ${formatDate(inv.issueDate, locale)}`}
                    </div>
                  </div>
                  <InvoiceStatusBadge status={inv.status} overdue={inv.overdue} kind={inv.kind} />
                  <div className="w-28 text-right tabular-nums">{money(inv.grossCents)}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
