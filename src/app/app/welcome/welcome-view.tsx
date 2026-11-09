"use client";

import {
  ArrowLeft,
  Boxes,
  Briefcase,
  Car,
  Clapperboard,
  Code2,
  Factory,
  Handshake,
  Laptop,
  Megaphone,
  Package,
  ShoppingBag,
  Store,
  Truck,
  User,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MODULE_LABEL } from "@/components/app/nav";
import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/client";
import { AUTOMATION_TEMPLATE_KEYS, INDUSTRIES, proposal, type AutomationTemplate, type Industry } from "@/lib/industries";
import { APP_MODULES, MODULE_REQUIRES, type AppModule } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { widgetTitle } from "../widgets";
import { applyProfileAction, chooseWorkspaceAction } from "../workspace-actions";

const ICONS: Record<Industry, LucideIcon> = {
  ONLINE_STORE: ShoppingBag,
  DROPSHIPPING: Package,
  RETAIL: Store,
  WHOLESALE: Warehouse,
  IT_COMPANY: Laptop,
  SOFTWARE: Code2,
  FREELANCER: Briefcase,
  CONSULTING: Handshake,
  AGENCY: Megaphone,
  AUTOMOTIVE: Car,
  MANUFACTURING: Factory,
  LOGISTICS: Truck,
  CREATOR: Clapperboard,
  SERVICE: Wrench,
  OTHER: Boxes,
};

/** Modules a business chooses; the private household has its own workspace kind. */
const CHOOSABLE = APP_MODULES.filter((m) => m !== "personal" && MODULE_LABEL[m]);

/**
 * What the business does, then the setup for it: modules, dashboard and
 * automations are proposed, reviewed and only applied on confirmation.
 */
export function WelcomeView({
  company,
  current,
  enabled,
  canAutomate,
  firstTime,
}: {
  company: string;
  current: Industry[];
  enabled: AppModule[];
  canAutomate: boolean;
  firstTime: boolean;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<"industries" | "review">("industries");
  const [industries, setIndustries] = useState<Industry[]>(current);
  const [modules, setModules] = useState<Set<AppModule>>(new Set(enabled));
  const [automations, setAutomations] = useState<Set<AutomationTemplate>>(new Set());
  const [dashboard, setDashboard] = useState(!firstTime);
  const plan = useMemo(() => proposal(industries), [industries]);

  const toggleIndustry = (industry: Industry) =>
    setIndustries((list) => (list.includes(industry) ? list.filter((i) => i !== industry) : [...list, industry]));

  const review = () => {
    setModules(new Set(plan.modules));
    setAutomations(new Set(canAutomate ? plan.automations : []));
    setStep("review");
  };

  const toggleModule = (module: AppModule, on: boolean) =>
    setModules((set) => {
      const next = new Set(set);
      if (on) {
        next.add(module);
        // What a module builds on comes along.
        for (const need of MODULE_REQUIRES[module] ?? []) next.add(need);
      } else {
        next.delete(module);
        for (const [other, needs] of Object.entries(MODULE_REQUIRES) as [AppModule, AppModule[]][]) if (needs.includes(module)) next.delete(other);
      }
      return next;
    });

  const apply = () =>
    start(async () => {
      const result = await applyProfileAction({ industries, modules: [...modules], automations: [...automations], dashboard });
      if (result?.error) toast.error(t(result.error));
    });

  if (step === "industries") {
    return (
      <>
        <PageHeader title={t("industries.title")} description={company} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((industry) => {
            const Icon = ICONS[industry];
            const on = industries.includes(industry);
            return (
              <button
                key={industry}
                type="button"
                aria-pressed={on}
                onClick={() => toggleIndustry(industry)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on && "border-primary bg-primary/5",
                )}
              >
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="font-medium">{t(`industries.name.${industry}`)}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {firstTime ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await chooseWorkspaceAction("PERSONAL");
                  if (res?.error) toast.error(t(res.error));
                })
              }
            >
              <User className="size-4" /> {t("industries.private")}
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" disabled={!industries.length} onClick={review}>
            {t("industries.next")}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("industries.reviewTitle")} description={industries.map((i) => t(`industries.name.${i}`)).join(" · ")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:row-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("industries.modules")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 sm:grid-cols-2">
            {CHOOSABLE.map((m) => (
              <label key={m} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                <Checkbox checked={modules.has(m)} onCheckedChange={(v) => toggleModule(m, v === true)} />
                <span className="min-w-0 flex-1 truncate">{t(MODULE_LABEL[m])}</span>
                {plan.because[m] && (
                  <Badge variant="secondary" className="font-normal">
                    {t("industries.suggested")}
                  </Badge>
                )}
              </label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("industries.automations")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {AUTOMATION_TEMPLATE_KEYS.filter((key) => plan.because[key]).map((key) => (
              <label key={key} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                <Checkbox
                  className="mt-0.5"
                  disabled={!canAutomate}
                  checked={automations.has(key)}
                  onCheckedChange={(v) =>
                    setAutomations((set) => {
                      const next = new Set(set);
                      if (v === true) next.add(key);
                      else next.delete(key);
                      return next;
                    })
                  }
                />
                <span>{t(`industries.automation.${key}.name`)}</span>
              </label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("industries.dashboard")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-1">
              {plan.widgets.map((w) => (
                <Badge key={w} variant="outline" className="font-normal">
                  {widgetTitle(t, w)}
                </Badge>
              ))}
            </div>
            {!firstTime && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={dashboard} onCheckedChange={(v) => setDashboard(v === true)} /> {t("industries.extraDashboard")}
              </label>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => setStep("industries")}>
          <ArrowLeft className="size-4" /> {t("industries.back")}
        </Button>
        <Button type="button" disabled={pending || !modules.size} onClick={apply}>
          {pending ? t("common.loading") : t("industries.apply")}
        </Button>
      </div>
    </>
  );
}
