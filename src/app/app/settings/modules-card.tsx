"use client";

import { LayoutGrid } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MODULE_LABEL } from "@/components/app/nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/client";
import { APP_MODULES, type AppModule } from "@/lib/modules";
import { saveModulesAction } from "./actions";

function ModuleList({ off, locked, onChange }: { off: Set<AppModule>; locked?: Set<AppModule>; onChange: (m: AppModule, on: boolean) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {APP_MODULES.filter((m) => !locked?.has(m)).map((m) => (
        <label key={m} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
          <Checkbox checked={!off.has(m)} onCheckedChange={(v) => onChange(m, v === true)} />
          {t(MODULE_LABEL[m])}
        </label>
      ))}
    </div>
  );
}

/** Modules on and off: for the whole company (admins) and for one's own menu. */
export function ModulesCard({ companyOff, myOff, canManage }: { companyOff: AppModule[]; myOff: AppModule[]; canManage: boolean }) {
  const { t } = useI18n();
  const [company, setCompany] = useState(new Set(companyOff));
  const [mine, setMine] = useState(new Set(myOff));
  const [pending, start] = useTransition();
  const toggle = (set: Set<AppModule>, m: AppModule, on: boolean) => {
    const next = new Set(set);
    if (on) next.delete(m);
    else next.add(m);
    return next;
  };
  const save = (scope: "company" | "me") =>
    start(async () => {
      const res = await saveModulesAction(scope, [...(scope === "company" ? company : mine)]);
      if (res.error) toast.error(t("common.forbidden"));
      else toast.success(t("common.saved"));
    });

  const personal = (
    <div className="grid gap-3">
      <ModuleList off={mine} locked={company} onChange={(m, on) => setMine((s) => toggle(s, m, on))} />
      <div>
        <Button size="sm" disabled={pending} onClick={() => save("me")}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="size-4" /> {t("modules.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {canManage ? (
          <Tabs defaultValue="me">
            <TabsList>
              <TabsTrigger value="me">{t("modules.mine")}</TabsTrigger>
              <TabsTrigger value="company">{t("modules.company")}</TabsTrigger>
            </TabsList>
            <TabsContent value="me" className="pt-3">
              {personal}
            </TabsContent>
            <TabsContent value="company" className="grid gap-3 pt-3">
              <ModuleList off={company} onChange={(m, on) => setCompany((s) => toggle(s, m, on))} />
              <div>
                <Button size="sm" disabled={pending} onClick={() => save("company")}>
                  {t("common.save")}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          personal
        )}
      </CardContent>
    </Card>
  );
}
