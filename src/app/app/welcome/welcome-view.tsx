"use client";

import { Briefcase, Building2, Clapperboard, User, type LucideIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { MODULE_LABEL } from "@/components/app/nav";
import { PageHeader } from "@/components/app/page";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/client";
import { APP_MODULES, WORKSPACE_OFF, WORKSPACE_TYPES, withDependents, type WorkspaceType } from "@/lib/modules";
import { chooseWorkspaceAction } from "../workspace-actions";

const ICONS: Record<WorkspaceType, LucideIcon> = { BUSINESS: Building2, CREATOR: Clapperboard, FREELANCER: Briefcase, PERSONAL: User };

/** Chosen once per workspace; the modules can be changed later in the settings. */
export function WelcomeView({ company }: { company: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <>
      <PageHeader title={t("workspace.title")} description={company} />
      <div className="grid gap-4 md:grid-cols-2">
        {WORKSPACE_TYPES.map((type) => {
          const Icon = ICONS[type];
          const off = withDependents(WORKSPACE_OFF[type]);
          return (
            <button
              key={type}
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await chooseWorkspaceAction(type);
                  if (res?.error) toast.error(t(res.error));
                })
              }
              className="grid gap-3 rounded-xl border bg-card p-5 text-left shadow-xs transition-colors hover:border-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <span className="flex items-center gap-3 text-base font-semibold">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                {t(`workspace.type.${type}`)}
              </span>
              <span className="flex flex-wrap gap-1">
                {APP_MODULES.filter((m) => !off.includes(m) && MODULE_LABEL[m]).map((m) => (
                  <Badge key={m} variant="secondary" className="font-normal">
                    {t(MODULE_LABEL[m])}
                  </Badge>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
