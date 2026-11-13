import { Check } from "lucide-react";
import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/i18n";
import { getT } from "@/i18n/server";
import { billingEnabled, entitlementsOf, paymentHistory } from "@/server/billing";
import { listPlans } from "@/server/platform";
import { requireContext } from "@/server/request";
import { groupPlans } from "@/lib/areas";
import { cn } from "@/lib/utils";
import { PlanButton, PortalButton } from "./billing-buttons";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("billing.title") };
}

export default async function BillingPage() {
  const ctx = await requireContext();
  const { t, locale, region } = await getT();
  // The plans are priced and charged in euro, whatever the company works in.
  const eur = { ...region, currency: "EUR" };
  const enabled = billingEnabled();
  const ent = await entitlementsOf(ctx.organization.id);
  const plans = (await listPlans()).filter((p) => p.active);
  const canManage = ctx.permissions.has("billing.manage");
  const history = enabled && canManage ? await paymentHistory(ctx) : [];
  const sub = ent.sub;

  return (
    <>
      <PageHeader title={t("billing.title")} />
      {!enabled ? (
        <Card>
          <CardContent className="pt-6 text-sm">{t("billing.off")}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
              <span className="text-lg font-semibold">{ent.plan?.name ?? "—"}</span>
              <Badge variant={ent.active ? "secondary" : "destructive"}>{t(`billing.${sub?.status ?? "NONE"}`)}</Badge>
              {sub?.status === "TRIALING" && sub.trialEndsAt && <span className="text-muted-foreground">{t("billing.trialUntil", { date: formatDate(sub.trialEndsAt.toISOString(), locale, region) })}</span>}
              {sub?.currentPeriodEnd && (
                <span className="text-muted-foreground">
                  {t(sub.cancelAtPeriodEnd ? "billing.endsOn" : "billing.renewsOn", { date: formatDate(sub.currentPeriodEnd.toISOString(), locale, region) })}
                </span>
              )}
              {canManage && sub?.stripeCustomerId && (
                <span className="ml-auto">
                  <PortalButton />
                </span>
              )}
            </CardContent>
          </Card>
          {groupPlans(plans).map((group) => (
          <div key={group.key} className="grid gap-3">
            {group.key !== "all" && <h2 className="text-lg font-semibold">{t(`areas.plan_${group.key}`)}</h2>}
          <div className="grid gap-4 md:grid-cols-3">
            {group.plans.map((plan) => {
              const current = ent.plan?.id === plan.id && ent.active;
              return (
                <Card key={plan.id} className={cn(current && "border-primary")}>
                  <CardHeader>
                    <CardTitle className="flex items-baseline justify-between">
                      {plan.name}
                      <span className="text-base font-normal">
                        {formatMoney(plan.priceCents, locale, eur)} <span className="text-muted-foreground">/ {t("billing.month")}</span>
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <ul className="grid gap-1">
                      <li className="flex gap-2">
                        <Check className="size-4 text-success" /> {t("billing.users", { count: plan.maxUsers })}
                      </li>
                      <li className="flex gap-2">
                        <Check className="size-4 text-success" /> {t("billing.ai", { count: plan.aiPerDay })}
                      </li>
                      {(plan.areas.length ? [...plan.areas.map((a) => t(`areas.${a}`)), t("areas.core")] : plan.modules.map((m) => t(`billing.module_${m}`))).map((line) => (
                        <li key={line} className="flex gap-2">
                          <Check className="size-4 text-success" /> {line}
                        </li>
                      ))}
                    </ul>
                    {canManage && !current && <PlanButton planId={plan.id} disabled={!plan.stripePriceId} />}
                    {current && <Badge className="w-fit">{t("billing.current")}</Badge>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          </div>
          ))}
          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("billing.history")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {history.map((h) => (
                  <div key={h.id} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {formatDate(h.createdAt.toISOString(), locale, region)} · {t(h.type === "invoice.paid" ? "billing.paid" : "billing.failed")}
                    </span>
                    <span className="tabular-nums">{h.amountCents != null ? formatMoney(h.amountCents, locale, eur) : "—"}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
