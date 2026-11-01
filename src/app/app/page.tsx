import { TrendingUp, UserCheck, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader, StatCard } from "@/components/app/page";
import { GrowthChart } from "@/components/app/growth-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { clientStats } from "@/server/dashboard";
import { requireContext } from "@/server/request";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("dashboard.title") };
}

export default async function DashboardPage() {
  const ctx = await requireContext();
  const { t, locale } = await getT();
  const nf = new Intl.NumberFormat(locale);
  const stats = ctx.permissions.has("clients.read") ? await clientStats(ctx) : null;
  return (
    <>
      <PageHeader title={t("dashboard.title")} description={ctx.organization.name} />
      {stats && stats.total === 0 ? (
        <EmptyState
          icon={Users}
          title={t("dashboard.emptyTitle")}
          action={
            <Button asChild>
              <Link href="/app/clients?new=1">{t("dashboard.addFirst")}</Link>
            </Button>
          }
        />
      ) : stats ? (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t("dashboard.clients")} value={nf.format(stats.total)} icon={Users} />
            <StatCard label={t("dashboard.active")} value={nf.format(stats.active)} icon={UserCheck} />
            <StatCard label={t("dashboard.leads")} value={nf.format(stats.leads)} icon={TrendingUp} />
            <StatCard
              label={t("dashboard.newThisMonth")}
              value={nf.format(stats.newThisMonth)}
              hint={t("dashboard.vsLastMonth", { count: nf.format(stats.newLastMonth) })}
              icon={UserPlus}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("dashboard.growth")}</CardTitle>
            </CardHeader>
            <CardContent>
              <GrowthChart data={stats.growth} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
