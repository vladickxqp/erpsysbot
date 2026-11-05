"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { savePreferencesAction } from "@/app/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/client";
import { NOTIFICATION_CATEGORIES, type Preferences } from "@/lib/preferences";

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** What reaches this person, when, and how their day and views start. */
export function PreferencesCard({ initial, hasTelegram, hasMail }: { initial: Preferences; hasTelegram: boolean; hasMail: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();
  const n = prefs.notifications;
  const setN = (patch: Partial<Preferences["notifications"]>) => setPrefs({ ...prefs, notifications: { ...n, ...patch } });
  const work = prefs.workHours;

  return (
    <Card id="workspace">
      <CardHeader>
        <CardTitle className="text-base">{t("hub.prefs.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <section className="grid gap-2">
          <h3 className="font-medium">{t("hub.prefs.inbox")}</h3>
          <div className="grid gap-1 sm:grid-cols-2">
            {NOTIFICATION_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <Checkbox checked={!n.muted.includes(c)} onCheckedChange={(v) => setN({ muted: v === true ? n.muted.filter((m) => m !== c) : [...n.muted, c] })} />
                {t(`hub.prefs.cat_${c}`)}
              </label>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="font-medium">{t("hub.prefs.outside")}</h3>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <Checkbox checked={n.telegram} disabled={!hasTelegram} onCheckedChange={(v) => setN({ telegram: v === true })} /> Telegram
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={n.email} disabled={!hasMail} onCheckedChange={(v) => setN({ email: v === true })} /> {t("auth.email")}
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label>{t("hub.prefs.frequency")}</Label>
              <Select value={n.frequency} onValueChange={(v) => setN({ frequency: v as "instant" })}>
                <SelectTrigger className="w-full" aria-label={t("hub.prefs.frequency")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instant">{t("hub.prefs.instant")}</SelectItem>
                  <SelectItem value="daily">{t("hub.prefs.daily")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="grid gap-1">
              <span className="font-medium">{t("hub.prefs.quietFrom")}</span>
              <Input type="time" value={n.quietFrom ?? ""} onChange={(e) => setN({ quietFrom: e.target.value || null })} />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">{t("hub.prefs.quietTo")}</span>
              <Input type="time" value={n.quietTo ?? ""} onChange={(e) => setN({ quietTo: e.target.value || null })} />
            </label>
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="font-medium">{t("hub.prefs.work")}</h3>
          <label className="flex items-center gap-2">
            <Checkbox checked={!!work} onCheckedChange={(v) => setPrefs({ ...prefs, workHours: v === true ? { from: "09:00", to: "17:00", days: [1, 2, 3, 4, 5] } : null })} /> {t("hub.prefs.workOn")}
          </label>
          {work && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
                <Input type="time" value={work.from} aria-label={t("calendar.from")} onChange={(e) => setPrefs({ ...prefs, workHours: { ...work, from: e.target.value } })} />
                <Input type="time" value={work.to} aria-label={t("calendar.to")} onChange={(e) => setPrefs({ ...prefs, workHours: { ...work, to: e.target.value } })} />
              </div>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5">
                    <Checkbox
                      checked={work.days.includes(d)}
                      onCheckedChange={(v) => {
                        const days = v === true ? [...work.days, d].sort() : work.days.filter((x) => x !== d);
                        if (days.length) setPrefs({ ...prefs, workHours: { ...work, days } });
                      }}
                    />
                    {t(`hub.prefs.day${d}`)}
                  </label>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="grid gap-2">
          <h3 className="font-medium">{t("hub.prefs.views")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>{t("nav.tasks")}</Label>
              <Select value={prefs.defaultViews.tasks ?? "board"} onValueChange={(v) => setPrefs({ ...prefs, defaultViews: { ...prefs.defaultViews, tasks: v as "board" } })}>
                <SelectTrigger className="w-full" aria-label={t("nav.tasks")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="board">{t("tasks.board")}</SelectItem>
                  <SelectItem value="list">{t("tasks.list")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("nav.calendar")}</Label>
              <Select value={prefs.defaultViews.calendar ?? "month"} onValueChange={(v) => setPrefs({ ...prefs, defaultViews: { ...prefs.defaultViews, calendar: v as "month" } })}>
                <SelectTrigger className="w-full" aria-label={t("nav.calendar")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">{t("calendar.month")}</SelectItem>
                  <SelectItem value="week">{t("calendar.week")}</SelectItem>
                  <SelectItem value="day">{t("calendar.day")}</SelectItem>
                  <SelectItem value="agenda">{t("hub.calendar.agenda")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Button
          className="w-fit"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await savePreferencesAction({ notifications: prefs.notifications, workHours: prefs.workHours, defaultViews: prefs.defaultViews });
              if (result.error) toast.error(t(result.error));
              else toast.success(t("common.saved"));
              router.refresh();
            })
          }
        >
          {t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
