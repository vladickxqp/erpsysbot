"use client";

import { Check, Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AREA_ICON } from "@/components/app/area-switcher";
import { MODULE_LABEL } from "@/components/app/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/client";
import { AREA_MODULES, AREAS, type Area } from "@/lib/areas";
import { cn } from "@/lib/utils";
import { saveAreasAction } from "./actions";

/** The company's areas: Commerce, Creator, ERP — one or several; the plan decides which may be chosen. */
export function AreasCard({ initial, allowed }: { initial: Area[]; allowed: Area[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState<Area[]>(initial);
  const [pending, start] = useTransition();
  const changed = chosen.length !== initial.length || chosen.some((a) => !initial.includes(a));
  const toggle = (area: Area) => setChosen((now) => (now.includes(area) ? now.filter((a) => a !== area) : AREAS.filter((a) => a === area || now.includes(a))));
  const save = () =>
    start(async () => {
      const result = await saveAreasAction(chosen);
      if (result.error) toast.error(t(result.error));
      else {
        toast.success(t("common.saved"));
        router.refresh();
      }
    });
  return (
    <Card className="h-fit" role="region" aria-label={t("areas.title")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4" /> {t("areas.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {AREAS.map((area) => {
            const Icon = AREA_ICON[area];
            const on = chosen.includes(area);
            const open = allowed.includes(area);
            return (
              <button
                key={area}
                type="button"
                aria-pressed={on}
                disabled={!open || pending}
                onClick={() => toggle(area)}
                className={cn(
                  "relative grid gap-2 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  on ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span className={cn("flex size-8 items-center justify-center rounded-lg", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <Icon className="size-4" />
                  </span>
                  {t(`areas.${area}`)}
                  {on && <Check className="ml-auto size-4 text-primary" aria-hidden />}
                </span>
                <span className="text-xs text-muted-foreground">{AREA_MODULES[area].map((m) => t(MODULE_LABEL[m])).join(" · ")}</span>
                {!open && (
                  <Badge variant="outline" className="w-fit text-[11px]">
                    {t("areas.notInPlan")}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
        <div>
          <Button size="sm" disabled={pending || !changed || !chosen.length} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
