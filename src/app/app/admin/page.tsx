import { redirect } from "next/navigation";
import { PageHeader, StatCard } from "@/components/app/page";
import { getT } from "@/i18n/server";
import { countryOptions } from "@/lib/countries";
import { billingEnabled, MODULES } from "@/server/billing";
import { listCompanies, listPlans, openPlatformInvites, platformStats } from "@/server/platform";
import { requireContext } from "@/server/request";
import { AdminView } from "./admin-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("admin.title") };
}

export default async function AdminPage() {
  const ctx = await requireContext();
  if (!ctx.user.isPlatformAdmin) redirect("/app");
  const { t, locale } = await getT();
  const nf = new Intl.NumberFormat(locale);
  const [stats, companies, plans, invites] = await Promise.all([platformStats(ctx.user), listCompanies(ctx.user), listPlans(), openPlatformInvites(ctx.user)]);
  return (
    <>
      <PageHeader title={t("admin.title")} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("admin.companies")} value={nf.format(stats.companies)} hint={t("admin.new30", { count: stats.newCompanies30 })} />
        <StatCard label={t("admin.users")} value={nf.format(stats.users)} hint={t("admin.active7", { count: stats.activeUsers7 })} />
        <StatCard label={t("admin.ai")} value={nf.format(stats.aiDay)} hint={t("admin.ai30", { count: nf.format(stats.aiMonth), tokens: nf.format(stats.tokensIn30 + stats.tokensOut30) })} />
        <StatCard
          label={t("admin.health")}
          value={`${stats.dbMillis} ms`}
          hint={t("admin.uptime", { hours: nf.format(Math.round(stats.uptimeSeconds / 360) / 10), mb: stats.memoryMb })}
        />
      </div>
      <AdminView
        countries={countryOptions(locale)}
        billing={billingEnabled()}
        modules={[...MODULES]}
        companies={companies.map((c) => ({
          id: c.id,
          name: c.name,
          createdAt: c.createdAt.toISOString(),
          country: c.country,
          signupIpCountry: c.signupIpCountry,
          members: c.members,
          lastActivity: c.lastActivity,
          planId: c.planId,
          status: c.status,
          suspended: c.suspended,
          review: c.suspensionKind === "REVIEW",
          mine: c.id === ctx.organization.id,
        }))}
        plans={plans.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, maxUsers: p.maxUsers, aiPerDay: p.aiPerDay, modules: p.modules, areas: p.areas, stripePriceId: p.stripePriceId, active: p.active }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt.toISOString() }))}
      />
    </>
  );
}
