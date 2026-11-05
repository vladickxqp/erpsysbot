"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cancelAbsenceAction, decideAbsenceAction, requestAbsenceAction, saveProfileAction } from "./actions";

type Staff = { id: string; name: string; position: string; hireDate: string; vacationDays: number; phone: string; emergencyContact: string; notes: string };
type Props = {
  today: string;
  me: string;
  mine: { id: string; kind: string; startDate: string; endDate: string; status: string }[];
  balance: { total: number; taken: number; pending: number; left: number };
  away: { id: string; name: string; startDate: string; endDate: string; kind: string | null }[];
  requests: { id: string; name: string; userId: string; kind: string; startDate: string; endDate: string; note: string | null }[];
  staff: Staff[];
  canManage: boolean;
  canRead: boolean;
};

export function HrView(p: Props) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ kind: "VACATION" as "VACATION" | "SICK" | "OTHER", startDate: p.today, endDate: p.today, note: "" });
  const [editing, setEditing] = useState<Staff | null>(null);
  const [pending, start] = useTransition();
  const date = (d: string) => formatDate(d, locale, region);
  const run = (work: () => Promise<{ error?: string }>, then?: () => void) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error));
      else then?.();
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("hub.hr.left")} value={String(p.balance.left)} hint={t("hub.hr.ofTotal", { total: p.balance.total })} />
        <StatCard label={t("hub.hr.taken")} value={String(p.balance.taken)} />
        <StatCard label={t("hub.hr.pending")} value={String(p.balance.pending)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("hub.hr.mine")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <form
              className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => requestAbsenceAction(form), () => setForm({ ...form, note: "" }));
              }}
            >
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as "VACATION" })}>
                <SelectTrigger className="w-full" aria-label={t("hub.hr.kind")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["VACATION", "SICK", "OTHER"] as const).map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`hub.hr.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} required aria-label={t("calendar.from")} />
              <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required aria-label={t("calendar.to")} />
              <Button type="submit" disabled={pending}>
                {t(form.kind === "SICK" ? "hub.hr.report" : "hub.hr.request")}
              </Button>
            </form>
            {p.mine.length === 0 && <p className="text-muted-foreground">{t("common.none")}</p>}
            {p.mine.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {t(`hub.hr.${a.kind}`)}: {date(a.startDate)} – {date(a.endDate)}
                </span>
                <span className="text-xs text-muted-foreground">{t(`hub.hr.status_${a.status}`)}</span>
                {a.startDate >= p.today && (
                  <Button size="icon" variant="ghost" className="size-7" disabled={pending} aria-label={t("common.delete")} onClick={() => run(() => cancelAbsenceAction(a.id))}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">{t("hub.hr.away")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5 text-sm">
            {p.away.length === 0 && <p className="text-muted-foreground">{t("common.none")}</p>}
            {p.away.map((a) => (
              <div key={a.id} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {date(a.startDate)} – {date(a.endDate)}
                  {a.kind ? ` · ${t(`hub.hr.${a.kind}`)}` : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {p.canManage && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("hub.hr.requests")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {p.requests.length === 0 && <p className="text-muted-foreground">{t("common.none")}</p>}
              {p.requests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.name}</span> · {t(`hub.hr.${r.kind}`)}: {date(r.startDate)} – {date(r.endDate)}
                  </span>
                  <Button size="sm" disabled={pending} onClick={() => run(() => decideAbsenceAction(r.id, true))}>
                    <Check className="size-4" /> {t("hub.inbox.approve")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideAbsenceAction(r.id, false))}>
                    <X className="size-4" /> {t("hub.inbox.reject")}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {p.canRead && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">{t("hub.hr.staff")}</CardTitle>
            </CardHeader>
            <CardContent className="grid divide-y text-sm">
              {p.staff.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.position}</span>
                  {p.canManage && (
                    <Button size="icon" variant="ghost" className="size-7" aria-label={t("common.edit")} onClick={() => setEditing(s)}>
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
            <DialogDescription className="sr-only">{t("hub.hr.staff")}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="grid gap-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveProfileAction(editing.id, editing), () => setEditing(null));
              }}
            >
              <label className="grid gap-1">
                <span className="font-medium">{t("hub.hr.position")}</span>
                <Input value={editing.position} onChange={(e) => setEditing({ ...editing, position: e.target.value })} maxLength={120} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1">
                  <span className="font-medium">{t("hub.hr.hireDate")}</span>
                  <Input type="date" value={editing.hireDate} onChange={(e) => setEditing({ ...editing, hireDate: e.target.value })} />
                </label>
                <label className="grid gap-1">
                  <span className="font-medium">{t("hub.hr.vacationDays")}</span>
                  <Input type="number" min={0} max={366} value={editing.vacationDays} onChange={(e) => setEditing({ ...editing, vacationDays: Number(e.target.value) })} required />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="font-medium">{t("hub.hr.phone")}</span>
                <Input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} maxLength={60} />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">{t("hub.hr.emergency")}</span>
                <Input value={editing.emergencyContact} onChange={(e) => setEditing({ ...editing, emergencyContact: e.target.value })} maxLength={200} />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">{t("hub.hr.notes")}</span>
                <Textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={3} maxLength={4000} />
              </label>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
