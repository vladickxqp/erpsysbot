"use client";

import { Play, Square, Timer, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { addEntryAction, billClientAction, deleteEntryAction, startTimerAction, stopTimerAction, type TimeResult } from "./actions";

type Option = { id: string; name: string };
type Entry = { id: string; day: string; start: string; end: string; minutes: number; description: string | null; projectName: string | null; clientName: string | null; billable: boolean; billed: boolean };

export const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

function Clock({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return <span className="text-2xl font-semibold tabular-nums">{`${two(Math.floor(seconds / 3600))}:${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`}</span>;
}

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  const { t } = useI18n();
  return (
    <Select value={value || "NONE"} onValueChange={(v) => onChange(v === "NONE" ? "" : v)}>
      <SelectTrigger className="w-full sm:w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="NONE">
          {label}: {t("common.none")}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TimeView({
  today,
  canManage,
  canBill,
  running,
  clients,
  projects,
  unbilled,
  entries,
}: {
  today: string;
  canManage: boolean;
  canBill: boolean;
  running: { id: string; description: string | null; startedAt: string } | null;
  clients: Option[];
  projects: Option[];
  unbilled: { clientId: string; clientName: string; minutes: number; entries: number }[];
  entries: Entry[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(true);
  const [manual, setManual] = useState({ date: today, start: "09:00", end: "10:00" });
  const [rate, setRate] = useState("");
  const base = { description, clientId: clientId || null, projectId: projectId || null, billable };
  const run = (work: () => Promise<TimeResult>, then?: (r: TimeResult) => void) =>
    start(async () => {
      const res = await work();
      if (res.error) toast.error(t(res.error));
      else then?.(res);
      router.refresh();
    });
  const days = [...new Set(entries.map((e) => e.day))];

  return (
    <div className="grid gap-4">
      {canManage && (
        <Card>
          <CardContent className="grid gap-3 pt-6">
            {running ? (
              <div className="flex flex-wrap items-center gap-4">
                <Clock since={running.startedAt} />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{running.description}</span>
                <Button variant="destructive" disabled={pending} onClick={() => run(stopTimerAction)}>
                  <Square className="size-4" /> {t("time.stop")}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="min-w-48 flex-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("time.what")} aria-label={t("time.what")} maxLength={500} />
                  {clients.length > 0 && <Pick label={t("invoices.client")} value={clientId} onChange={setClientId} options={clients} />}
                  {projects.length > 0 && <Pick label={t("tasks.project")} value={projectId} onChange={setProjectId} options={projects} />}
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={billable} onCheckedChange={(v) => setBillable(v === true)} /> {t("time.billable")}
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={pending} onClick={() => run(() => startTimerAction(base), () => setDescription(""))}>
                    <Play className="size-4" /> {t("time.start")}
                  </Button>
                  <span className="text-sm text-muted-foreground">{t("time.or")}</span>
                  <Input type="date" className="w-40" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} aria-label={t("studio.date")} />
                  <Input type="time" className="w-28" value={manual.start} onChange={(e) => setManual({ ...manual, start: e.target.value })} aria-label={t("time.from")} />
                  <Input type="time" className="w-28" value={manual.end} onChange={(e) => setManual({ ...manual, end: e.target.value })} aria-label={t("time.to")} />
                  <Button variant="outline" disabled={pending} onClick={() => run(() => addEntryAction({ ...base, ...manual }), () => setDescription(""))}>
                    {t("time.add")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {canBill && unbilled.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{t("time.unbilled")}</CardTitle>
            <Input className="w-40" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t("time.rate")} aria-label={t("time.rate")} />
          </CardHeader>
          <CardContent className="grid divide-y text-sm">
            {unbilled.map((u) => (
              <div key={u.clientId} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">{u.clientName}</span>
                <span className="tabular-nums text-muted-foreground">{hours(u.minutes)}</span>
                <Button size="sm" variant="outline" disabled={pending || !rate.trim()} onClick={() => run(() => billClientAction(u.clientId, rate), (r) => r.id && router.push(`/app/invoices/${r.id}`))}>
                  {t("time.bill")}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {entries.length === 0 ? (
        <EmptyState icon={Timer} title={t("time.empty")} />
      ) : (
        days.map((day) => {
          const rows = entries.filter((e) => e.day === day);
          return (
            <div key={day} className="rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2 text-sm font-medium">
                <span>{formatDate(day, locale, region)}</span>
                <span className="tabular-nums">{hours(rows.reduce((sum, e) => sum + e.minutes, 0))}</span>
              </div>
              <div className="divide-y">
                {rows.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                      {e.start}–{e.end}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {e.description ?? "—"}
                      {(e.projectName || e.clientName) && <span className="text-muted-foreground"> · {[e.projectName, e.clientName].filter(Boolean).join(" · ")}</span>}
                    </span>
                    {e.billed && <span className="text-xs text-success">{t("time.billed")}</span>}
                    <span className="tabular-nums">{hours(e.minutes)}</span>
                    {canManage && !e.billed && (
                      <Button size="icon" variant="ghost" className="size-7" disabled={pending} onClick={() => run(() => deleteEntryAction(e.id))} aria-label={t("common.delete")}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
