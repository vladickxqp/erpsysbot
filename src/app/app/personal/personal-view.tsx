"use client";

import { Check, Flame, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, intlTag } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { addHabitAction, deleteGoalAction, deleteHabitAction, saveGoalAction, toggleHabitAction, type PersonalResult } from "./actions";

type Goal = { id: string; title: string; targetDate: string | null; progress: number };
type Habit = { id: string; title: string; streak: number; week: { day: string; done: boolean }[] };

export function PersonalView({ goals, habits, today }: { goals: Goal[]; habits: Habit[]; today: string }) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [target, setTarget] = useState("");
  const [habit, setHabit] = useState("");
  const [pending, start] = useTransition();
  const run = (work: () => Promise<PersonalResult>, then?: () => void) =>
    start(async () => {
      const res = await work();
      if (res.error) toast.error(t(res.error));
      else then?.();
      router.refresh();
    });
  const weekday = (day: string) => new Intl.DateTimeFormat(intlTag(locale, region), { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">{t("personal.goals")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => saveGoalAction(null, { title: goal, targetDate: target || null }),
                () => {
                  setGoal("");
                  setTarget("");
                },
              );
            }}
          >
            <Input className="min-w-40 flex-1" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("personal.newGoal")} aria-label={t("personal.newGoal")} required maxLength={200} />
            <Input className="w-40" type="date" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("studio.date")} />
            <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label={t("crm.add")}>
              <Plus className="size-4" />
            </Button>
          </form>
          {goals.length === 0 && <p className="text-muted-foreground">{t("common.none")}</p>}
          {goals.map((g) => (
            <div key={g.id} className="grid gap-1.5 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className={cn("min-w-0 flex-1 truncate font-medium", g.progress >= 100 && "text-muted-foreground line-through")}>{g.title}</span>
                {g.targetDate && <span className={cn("text-xs tabular-nums text-muted-foreground", g.targetDate < today && g.progress < 100 && "text-destructive")}>{formatDate(g.targetDate, locale, region)}</span>}
                <Button size="icon" variant="ghost" className="size-7" disabled={pending} onClick={() => run(() => deleteGoalAction(g.id))} aria-label={t("common.delete")}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  defaultValue={g.progress}
                  className="min-w-0 flex-1 accent-primary"
                  aria-label={g.title}
                  onPointerUp={(e) => {
                    const progress = Number(e.currentTarget.value);
                    run(() => saveGoalAction(g.id, { title: g.title, targetDate: g.targetDate, progress }));
                  }}
                />
                <span className="w-10 text-right text-xs tabular-nums">{g.progress} %</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">{t("personal.habits")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addHabitAction(habit), () => setHabit(""));
            }}
          >
            <Input value={habit} onChange={(e) => setHabit(e.target.value)} placeholder={t("personal.newHabit")} aria-label={t("personal.newHabit")} required maxLength={200} />
            <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label={t("crm.add")}>
              <Plus className="size-4" />
            </Button>
          </form>
          {habits.length === 0 && <p className="text-muted-foreground">{t("common.none")}</p>}
          {habits.map((h) => (
            <div key={h.id} className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>
                {h.streak > 0 && (
                  <span className="flex items-center gap-1 text-xs tabular-nums text-warning">
                    <Flame className="size-3.5" aria-hidden /> {h.streak}
                  </span>
                )}
                <Button size="icon" variant="ghost" className="size-7" disabled={pending} onClick={() => run(() => deleteHabitAction(h.id))} aria-label={t("common.delete")}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {h.week.map((d) => (
                  <button
                    key={d.day}
                    type="button"
                    disabled={pending}
                    aria-pressed={d.done}
                    aria-label={d.day}
                    onClick={() => run(() => toggleHabitAction(h.id, d.day))}
                    className={cn("grid h-9 place-items-center rounded-md border text-xs", d.done ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted", d.day === today && !d.done && "border-primary")}
                  >
                    {d.done ? <Check className="size-3.5" /> : weekday(d.day)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
