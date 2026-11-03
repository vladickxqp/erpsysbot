"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { saveDatevAction } from "./actions";

type Settings = { consultant: number; client: number; chart: "SKR03" | "SKR04"; fiscalStartMonth: number } | null;

/** The DATEV numbers of the company (admins) and the export of a period. */
export function DatevDialog({ settings, canSetUp, from, to }: { settings: Settings; canSetUp: boolean; from: string; to: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [s, setS] = useState({
    consultant: String(settings?.consultant ?? ""),
    client: String(settings?.client ?? ""),
    chart: settings?.chart ?? ("SKR03" as "SKR03" | "SKR04"),
    fiscalStartMonth: String(settings?.fiscalStartMonth ?? 1),
  });
  const [period, setPeriod] = useState({ from, to });
  const [pending, start] = useTransition();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="size-4" /> DATEV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("datev.title")}</DialogTitle>
        </DialogHeader>
        {canSetUp && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await saveDatevAction(s);
                if (res.error) toast.error(t(res.error));
                else toast.success(t("common.saved"));
                router.refresh();
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dv-consultant">{t("datev.consultant")}</Label>
                <Input id="dv-consultant" inputMode="numeric" value={s.consultant} onChange={(e) => setS({ ...s, consultant: e.target.value })} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dv-client">{t("datev.client")}</Label>
                <Input id="dv-client" inputMode="numeric" value={s.client} onChange={(e) => setS({ ...s, client: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t("datev.chart")}</Label>
                <Select value={s.chart} onValueChange={(chart) => setS({ ...s, chart: chart as "SKR03" | "SKR04" })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SKR03">SKR 03</SelectItem>
                    <SelectItem value="SKR04">SKR 04</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dv-month">{t("datev.fiscalStart")}</Label>
                <Input id="dv-month" type="number" min={1} max={12} value={s.fiscalStartMonth} onChange={(e) => setS({ ...s, fiscalStartMonth: e.target.value })} />
              </div>
            </div>
            <div>
              <Button type="submit" variant="outline" size="sm" disabled={pending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        )}
        {settings ? (
          <div className="grid gap-3 border-t pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="dv-from">{t("datev.from")}</Label>
                <Input id="dv-from" type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="dv-to">{t("datev.to")}</Label>
                <Input id="dv-to" type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button asChild>
                <a href={`/app/finance/datev?from=${period.from}&to=${period.to}`}>
                  <Download className="size-4" /> {t("datev.download")}
                </a>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          !canSetUp && <p className="text-sm text-muted-foreground">{t("datev.askAdmin")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
