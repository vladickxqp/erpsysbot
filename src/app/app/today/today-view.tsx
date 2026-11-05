"use client";

import { ArrowDown, ArrowUp, Ban, CalendarDays, CheckCircle2, Clock, Flag, Plus, Sparkles, Sun, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { daySummaryAction } from "@/app/app/assistant/actions";
import { InsightCard } from "@/components/app/insight-card";
import { PageHeader } from "@/components/app/page";
import { QuickTaskButton } from "@/components/app/quick-task";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { Insight } from "@/server/insights";
import { changeTaskAction, orderPlanAction, planTaskAction, type HubResult } from "../tasks/hub-actions";

type DayTask = { id: string; title: string; priority: string; status: string; dueDate: string | null; estimateMinutes: number | null; projectName: string | null; blocked: boolean };
type Props = {
  day: string;
  planned: DayTask[];
  overdue: DayTask[];
  dueToday: DayTask[];
  upcoming: DayTask[];
  agenda: { id: string; title: string; from: string; to: string; clientName: string | null }[];
  schedule: { slots: { from: string; to: string; taskId: string; title: string }[]; left: string[] } | null;
  hasWorkHours: boolean;
  workingToday: boolean;
  canManage: boolean;
  insights: Insight[];
  summary: string | null;
  ai: boolean;
};

export function TodayView(p: Props) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [plan, setPlan] = useState(p.planned);
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState(p.summary);
  const write = () =>
    start(async () => {
      const result = await daySummaryAction();
      if (result.text) setSummary(result.text);
      else toast.error(t(result.error ?? "common.error"));
    });
  const run = (work: () => Promise<HubResult>) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error, result.vars));
      router.refresh();
    });
  const add = (task: DayTask) => {
    setPlan((list) => [...list, task]);
    run(() => planTaskAction(task.id, p.day));
  };
  const remove = (task: DayTask) => {
    setPlan((list) => list.filter((x) => x.id !== task.id));
    run(() => planTaskAction(task.id, null));
  };
  const move = (index: number, by: number) => {
    const next = [...plan];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setPlan(next);
    run(() => orderPlanAction(next.map((x) => x.id)));
  };
  const done = (task: DayTask) => run(() => changeTaskAction(task.id, { status: "DONE" }));
  const inPlan = (task: DayTask) => plan.some((x) => x.id === task.id);

  const Row = ({ task, children }: { task: DayTask; children?: React.ReactNode }) => (
    <div className="flex items-center gap-2 py-2 text-sm">
      {p.canManage && (
        <button type="button" disabled={pending || task.blocked} aria-label={t("hub.today.done")} className="text-muted-foreground hover:text-success disabled:opacity-40" onClick={() => done(task)}>
          <CheckCircle2 className="size-4" />
        </button>
      )}
      <Link href={`/app/tasks/${task.id}`} className="min-w-0 flex-1 truncate hover:text-primary">
        {task.title}
      </Link>
      {task.blocked && <Ban className="size-3.5 shrink-0 text-warning" aria-label={t("hub.tasks.blockedTitle")} />}
      {task.priority === "HIGH" && <Flag className="size-3.5 shrink-0 text-destructive" aria-label={t("hub.tasks.high")} />}
      {task.dueDate && (
        <span className={cn("shrink-0 text-xs tabular-nums", task.dueDate < p.day ? "font-medium text-destructive" : "text-muted-foreground")}>{formatDate(task.dueDate, locale, region)}</span>
      )}
      {children}
    </div>
  );

  const Group = ({ title, list }: { title: string; list: DayTask[] }) =>
    list.length > 0 && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="grid divide-y">
          {list.map((task) => (
            <Row key={task.id} task={task}>
              {p.canManage && !inPlan(task) && (
                <Button size="icon" variant="ghost" className="size-7" disabled={pending} aria-label={t("hub.today.add")} onClick={() => add(task)}>
                  <Plus className="size-4" />
                </Button>
              )}
            </Row>
          ))}
        </CardContent>
      </Card>
    );

  return (
    <>
      <PageHeader title={t("hub.today.title")} description={formatDate(p.day, locale, region)} actions={<QuickTaskButton />} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid h-fit gap-4">
          {(p.ai || summary) && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-primary" aria-hidden /> {t("hub.ai.daySummary")}
                </CardTitle>
                {p.ai && !summary && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={write}>
                    {t("hub.ai.writeSummary")}
                  </Button>
                )}
              </CardHeader>
              {summary && <CardContent className="whitespace-pre-wrap text-sm">{summary}</CardContent>}
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sun className="size-4 text-warning" aria-hidden /> {t("hub.today.plan")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid divide-y">
              {plan.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("hub.today.planEmpty")}</p>}
              {plan.map((task, index) => (
                <Row key={task.id} task={task}>
                  {p.canManage && (
                    <span className="flex shrink-0 items-center">
                      <Button size="icon" variant="ghost" className="size-7" disabled={pending || index === 0} aria-label={t("hub.today.up")} onClick={() => move(index, -1)}>
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-7" disabled={pending || index === plan.length - 1} aria-label={t("hub.today.down")} onClick={() => move(index, 1)}>
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-7" disabled={pending} aria-label={t("hub.today.remove")} onClick={() => remove(task)}>
                        <X className="size-3.5" />
                      </Button>
                    </span>
                  )}
                </Row>
              ))}
            </CardContent>
          </Card>
          <Group title={t("hub.today.overdue")} list={p.overdue} />
          <Group title={t("hub.today.dueToday")} list={p.dueToday} />
          <Group title={t("hub.today.upcoming")} list={p.upcoming} />
        </div>

        <div className="grid h-fit gap-4">
          {p.insights.slice(0, 3).map((insight) => (
            <InsightCard key={insight.key} insight={insight} compact />
          ))}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4" aria-hidden /> {t("nav.calendar")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {p.agenda.length === 0 && <p className="text-muted-foreground">{t("hub.today.noAppointments")}</p>}
              {p.agenda.map((a) => (
                <Link key={a.id} href="/app/calendar?view=day" className="flex gap-2 hover:text-primary">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {a.from}–{a.to}
                  </span>
                  <span className="truncate">{a.title}</span>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4" aria-hidden /> {t("hub.today.schedule")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {!p.hasWorkHours && (
                <p className="text-muted-foreground">
                  {t("hub.today.noWorkHours")}{" "}
                  <Link href="/app/settings#workspace" className="font-medium text-primary hover:underline">
                    {t("nav.settings")}
                  </Link>
                </p>
              )}
              {p.hasWorkHours && !p.workingToday && <p className="text-muted-foreground">{t("hub.today.dayOff")}</p>}
              {p.schedule?.slots.map((s) => (
                <Link key={s.taskId} href={`/app/tasks/${s.taskId}`} className="flex gap-2 hover:text-primary">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {s.from}–{s.to}
                  </span>
                  <span className="truncate">{s.title}</span>
                </Link>
              ))}
              {p.schedule && p.schedule.left.length > 0 && <p className="text-xs text-muted-foreground">{t("hub.today.doesNotFit", { count: p.schedule.left.length })}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
