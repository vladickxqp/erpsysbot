"use client";

import { ChevronLeft, ChevronRight, MapPin, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { deleteAppointmentAction, saveAppointmentAction, type AppointmentPayload } from "./actions";

export type View = "month" | "week" | "day";
type Status = AppointmentPayload["status"];
export type Item = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  assignedUserId: string | null;
  day: string;
  start: string;
  end: string;
  location: string | null;
  status: Status;
  notes: string | null;
};

const STATUSES: Status[] = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"];
const TONE: Record<Status, string> = {
  PENDING: "border-l-warning bg-warning/10",
  CONFIRMED: "border-l-primary bg-primary/10",
  COMPLETED: "border-l-success bg-success/10",
  CANCELLED: "border-l-muted-foreground bg-muted line-through opacity-60",
  NO_SHOW: "border-l-destructive bg-destructive/10 opacity-70",
};

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (iso: string, months: number) => {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

type Draft = AppointmentPayload & { id: string | null };

export function CalendarView({
  view,
  date,
  today,
  first,
  days,
  mine,
  me,
  canManage,
  clients,
  members,
  items,
}: {
  view: View;
  date: string;
  today: string;
  first: string;
  days: number;
  mine: boolean;
  timeZone: string;
  me: string;
  canManage: boolean;
  clients: { id: string; name: string; number: number }[];
  members: { id: string; name: string }[];
  items: Item[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const tag = intlTag(locale, region);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();

  const href = (p: { view?: View; date?: string; mine?: boolean }) => {
    const q = new URLSearchParams({ view: p.view ?? view, date: p.date ?? date });
    if (p.mine ?? mine) q.set("mine", "1");
    return `/app/calendar?${q}`;
  };
  const step = view === "month" ? (n: number) => shiftMonth(date, n) : (n: number) => shift(date, n * days);
  const title =
    view === "month"
      ? new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`))
      : view === "week"
        ? `${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short" }).format(new Date(`${first}T12:00:00Z`))} – ${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${shift(first, 6)}T12:00:00Z`))}`
        : new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));

  const byDay = new Map<string, Item[]>();
  for (const item of items) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  const dayList = Array.from({ length: days }, (_, i) => shift(first, i));
  const weekday = (iso: string, style: "short" | "long" = "short") => new Intl.DateTimeFormat(tag, { weekday: style }).format(new Date(`${iso}T12:00:00Z`));
  const dayNumber = (iso: string) => Number(iso.slice(8));

  const blank = (day: string): Draft => ({
    id: null,
    title: "",
    clientId: null,
    assignedUserId: me,
    date: day,
    start: "09:00",
    end: "10:00",
    location: "",
    status: "CONFIRMED",
    notes: "",
    repeatWeeks: 0,
  });
  const open = (item: Item) =>
    setDraft({
      id: item.id,
      title: item.title,
      clientId: item.clientId,
      assignedUserId: item.assignedUserId,
      date: item.day,
      start: item.start,
      end: item.end,
      location: item.location ?? "",
      status: item.status,
      notes: item.notes ?? "",
      repeatWeeks: 0,
    });

  const chip = (item: Item, compact = false) => (
    <button
      key={item.id}
      type="button"
      onClick={() => open(item)}
      className={cn("w-full truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs hover:brightness-95", TONE[item.status])}
      title={`${item.start}–${item.end} ${item.title}`}
    >
      <span className="tabular-nums text-muted-foreground">{item.start}</span> {compact ? item.title : `${item.title}${item.clientName ? ` · ${item.clientName}` : ""}`}
    </button>
  );

  const save = () =>
    draft &&
    start(async () => {
      const { id, ...payload } = draft;
      const result = await saveAppointmentAction(id, payload);
      if (result.ok) {
        toast.success(t("common.saved"));
        setDraft(null);
        router.refresh();
      } else toast.error(result.clash ? `${t(result.error ?? "common.error")}: ${result.clash}` : t(result.error ?? "common.error"));
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight first-letter:uppercase">{title}</h1>
        <div className="flex rounded-lg border bg-card p-0.5">
          {(["month", "week", "day"] as const).map((v) => (
            <Link
              key={v}
              href={href({ view: v })}
              className={cn("rounded-md px-3 py-1.5 text-sm", v === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`calendar.${v}`)}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" asChild aria-label={t("calendar.previous")}>
            <Link href={href({ date: step(-1) })}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={href({ date: today })}>{t("calendar.today")}</Link>
          </Button>
          <Button variant="outline" size="icon" asChild aria-label={t("calendar.next")}>
            <Link href={href({ date: step(1) })}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
        <Button variant={mine ? "default" : "outline"} asChild>
          <Link href={href({ mine: !mine })}>{t("calendar.mine")}</Link>
        </Button>
        {canManage && (
          <Button onClick={() => setDraft(blank(view === "month" ? (date.slice(0, 7) === today.slice(0, 7) ? today : date) : date))}>
            <Plus className="size-4" /> {t("calendar.new")}
          </Button>
        )}
      </div>

      {view === "month" && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
            {dayList.slice(0, 7).map((d) => (
              <div key={d} className="py-2">
                {weekday(d)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {dayList.map((d) => {
              const list = byDay.get(d) ?? [];
              const outside = d.slice(0, 7) !== date.slice(0, 7);
              return (
                <div key={d} className={cn("min-h-24 border-b border-r p-1 sm:min-h-28", outside && "bg-muted/30")}>
                  <Link
                    href={href({ view: "day", date: d })}
                    className={cn(
                      "mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs",
                      d === today ? "bg-primary font-semibold text-primary-foreground" : outside ? "text-muted-foreground" : "",
                    )}
                  >
                    {dayNumber(d)}
                  </Link>
                  <div className="hidden gap-0.5 sm:grid">
                    {list.slice(0, 3).map((i) => chip(i, true))}
                    {list.length > 3 && (
                      <Link href={href({ view: "day", date: d })} className="px-1 text-xs text-muted-foreground hover:underline">
                        +{list.length - 3}
                      </Link>
                    )}
                  </div>
                  {list.length > 0 && (
                    <Link href={href({ view: "day", date: d })} className="flex gap-0.5 sm:hidden" aria-label={String(list.length)}>
                      {list.slice(0, 4).map((i) => (
                        <span key={i.id} className="size-1.5 rounded-full bg-primary" />
                      ))}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view !== "month" && (
        <div className={cn("grid gap-3", view === "week" && "md:grid-cols-7")}>
          {dayList.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className="rounded-xl border bg-card p-2">
                <div className="mb-2 flex items-center justify-between">
                  <Link href={href({ view: "day", date: d })} className={cn("text-sm font-medium", d === today && "text-primary")}>
                    {weekday(d, view === "day" ? "long" : "short")} {dayNumber(d)}.
                  </Link>
                  {canManage && (
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setDraft(blank(d))} aria-label={t("calendar.new")}>
                      <Plus className="size-4" />
                    </button>
                  )}
                </div>
                <div className="grid gap-1">
                  {list.length === 0 && <div className="py-2 text-center text-xs text-muted-foreground">—</div>}
                  {list.map((i) =>
                    view === "day" ? (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => open(i)}
                        className={cn("grid gap-0.5 rounded-lg border-l-4 p-3 text-left text-sm hover:brightness-95", TONE[i.status])}
                      >
                        <span className="tabular-nums text-muted-foreground">
                          {i.start}–{i.end}
                        </span>
                        <span className="font-medium">{i.title}</span>
                        {i.clientName && <span className="text-muted-foreground">{i.clientName}</span>}
                        {i.location && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="size-3" /> {i.location}
                          </span>
                        )}
                      </button>
                    ) : (
                      chip(i)
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("calendar.edit") : t("calendar.new")}</DialogTitle>
            <DialogDescription className="sr-only">{t("nav.calendar")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <fieldset disabled={!canManage} className="grid gap-3">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("calendar.title")}</span>
                  <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required maxLength={200} autoFocus />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("calendar.date")}</span>
                    <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("calendar.from")}</span>
                    <Input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} required />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("calendar.to")}</span>
                    <Input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} required />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label>{t("orders.client")}</Label>
                    <Select value={draft.clientId ?? "-"} onValueChange={(v) => setDraft({ ...draft, clientId: v === "-" ? null : v })}>
                      <SelectTrigger className="w-full" aria-label={t("orders.client")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-">—</SelectItem>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("calendar.who")}</Label>
                    <Select value={draft.assignedUserId ?? me} onValueChange={(v) => setDraft({ ...draft, assignedUserId: v })}>
                      <SelectTrigger className="w-full" aria-label={t("calendar.who")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">{t("calendar.location")}</span>
                    <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} maxLength={200} />
                  </label>
                  <div className="grid gap-1.5">
                    <Label>{t("orders.status")}</Label>
                    <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as Status })}>
                      <SelectTrigger className="w-full" aria-label={t("orders.status")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`calendar.${s}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium">{t("orders.notes")}</span>
                  <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </label>
                {!draft.id && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={draft.repeatWeeks > 0} onCheckedChange={(c) => setDraft({ ...draft, repeatWeeks: c === true ? 3 : 0 })} />
                    {t("calendar.weekly")}
                    {draft.repeatWeeks > 0 && (
                      <Input
                        type="number"
                        min={1}
                        max={52}
                        value={draft.repeatWeeks + 1}
                        onChange={(e) => setDraft({ ...draft, repeatWeeks: Math.max(1, Math.min(52, Number(e.target.value) - 1)) })}
                        className="h-8 w-20"
                        aria-label={t("calendar.times")}
                      />
                    )}
                    {draft.repeatWeeks > 0 && <span className="text-muted-foreground">{t("calendar.times")}</span>}
                  </label>
                )}
              </fieldset>
              {canManage && (
                <DialogFooter className="gap-2 sm:justify-between">
                  {draft.id ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const result = await deleteAppointmentAction(draft.id!);
                          if (result.ok) {
                            setDraft(null);
                            router.refresh();
                          } else toast.error(t(result.error ?? "common.error"));
                        })
                      }
                    >
                      <Trash2 className="size-4" /> {t("common.delete")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" disabled={pending}>
                      {t("common.save")}
                    </Button>
                  </div>
                </DialogFooter>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
