"use client";

import { Briefcase, Building2, Check, Clapperboard, UserRound } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

const AUDIENCES = [
  { key: "business", icon: Building2, modules: ["crm", "quotes", "invoices", "finance", "inventory", "team", "automation", "reports"] },
  { key: "freelancer", icon: Briefcase, modules: ["crm", "quotes", "invoices", "time", "tasks", "finance", "documents", "calendar"] },
  { key: "creator", icon: Clapperboard, modules: ["content", "social", "media", "tasks", "calendar", "finance", "documents", "assistant"] },
  { key: "personal", icon: UserRound, modules: ["personal", "tasks", "calendar", "finance", "documents", "assistant"] },
] as const;

export function Audiences() {
  const { t } = useI18n();
  const [active, setActive] = useState<(typeof AUDIENCES)[number]["key"]>("business");
  const current = AUDIENCES.find((a) => a.key === active)!;
  return (
    <div>
      <div role="tablist" aria-label={t("landing.audiences.title")} className="mx-auto grid grid-cols-2 gap-1 rounded-3xl border border-white/10 bg-white/[0.03] p-1 sm:flex sm:w-fit sm:rounded-full">
        {AUDIENCES.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`audience-${key}`}
            aria-selected={key === active}
            aria-controls="audience-panel"
            onClick={() => setActive(key)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300",
              key === active ? "bg-primary text-white shadow-[0_0_24px_-4px] shadow-primary" : "text-white/60 hover:text-white",
            )}
          >
            <Icon className="size-4" aria-hidden /> {t(`landing.audiences.${key}`)}
          </button>
        ))}
      </div>
      <div key={active} id="audience-panel" role="tabpanel" aria-labelledby={`audience-${active}`} className="panel-in glass mt-8 grid gap-8 rounded-3xl p-6 sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t(`landing.audiences.${active}Title`)}</h3>
          <p className="mt-3 leading-relaxed text-white/60">{t(`landing.audiences.${active}Text`)}</p>
        </div>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {current.modules.map((module) => (
            <li key={module} className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white/85">
              <Check className="size-4 shrink-0 text-cyan-300" aria-hidden /> {t(`landing.m.${module}`)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
