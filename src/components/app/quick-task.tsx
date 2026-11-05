"use client";

import { CalendarDays, CircleHelp, Flag, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { quickTaskAction, quickTaskOptions } from "@/app/app/tasks/hub-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { parseTaskText } from "@/lib/smart-task";

/** What a page knows about the task to come: its project, client or a text to start from. */
export type TaskSeed = { projectId?: string | null; clientId?: string | null; orderId?: string | null; title?: string };

const EVENT = "nexora:quick-task";

/** Opens the small task form from anywhere. */
export function openQuickTask(seed: TaskSeed = {}): void {
  window.dispatchEvent(new CustomEvent<TaskSeed>(EVENT, { detail: seed }));
}

/** A button for pages: a new task that already belongs to what is on screen. */
export function QuickTaskButton({ seed, variant = "outline", label }: { seed?: TaskSeed; variant?: "outline" | "ghost" | "default"; label?: string }) {
  const { t } = useI18n();
  return (
    <Button variant={variant} size="sm" onClick={() => openQuickTask(seed)}>
      <Plus className="size-4" /> {label ?? t("hub.tasks.quick")}
    </Button>
  );
}

type Options = Awaited<ReturnType<typeof quickTaskOptions>>;
const local = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Lives once in the shell. One line is enough; the rest fills itself and can be changed. */
export function QuickTaskDialog() {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<TaskSeed>({});
  const [text, setText] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [dateTouched, setDateTouched] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [high, setHigh] = useState<boolean | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const show = (e: Event) => {
      const detail = (e as CustomEvent<TaskSeed>).detail ?? {};
      setSeed(detail);
      setText(detail.title ?? "");
      setDate(null);
      setDateTouched(false);
      setHigh(null);
      setProjectId(detail.projectId ?? null);
      setAssignee(null);
      setOpen(true);
      quickTaskOptions().then(setOptions).catch(() => undefined);
    };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);

  const parsed = useMemo(() => parseTaskText(text, local(new Date())), [text]);
  const due = dateTouched ? date : parsed.dueDate;
  const urgent = high ?? parsed.urgent;
  const unclear = parsed.unclear && !dateTouched;

  const save = () =>
    start(async () => {
      const result = await quickTaskAction({
        title: parsed.title || text.trim(),
        dueDate: due,
        priority: urgent ? "HIGH" : "MEDIUM",
        projectId,
        clientId: seed.clientId ?? null,
        orderId: seed.orderId ?? null,
        assignedUserId: assignee,
      });
      if (result.ok) {
        setOpen(false);
        toast.success(t("hub.tasks.created"));
        router.refresh();
      } else toast.error(t(result.error ?? "common.error", result.vars));
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("hub.tasks.quick")}</DialogTitle>
          <DialogDescription className="sr-only">{t("hub.tasks.quick")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) save();
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("hub.tasks.quickPlaceholder")} aria-label={t("hub.tasks.quick")} maxLength={300} required autoFocus />
          {(parsed.title !== text.trim() || due || urgent) && text.trim() && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{parsed.title}</span>
              {due && (
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                  <CalendarDays className="size-3" aria-hidden /> {formatDate(due, locale, region)}
                </span>
              )}
              {urgent && (
                <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
                  <Flag className="size-3" aria-hidden /> {t("hub.tasks.high")}
                </span>
              )}
            </div>
          )}
          {unclear && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <CircleHelp className="size-4 shrink-0" aria-hidden /> {t("hub.tasks.whichDay", { words: parsed.dueWords ?? "" })}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              type="date"
              value={due ?? ""}
              onChange={(e) => {
                setDateTouched(true);
                setDate(e.target.value || null);
              }}
              aria-label={t("hub.tasks.due")}
            />
            <Select value={projectId ?? "-"} onValueChange={(v) => setProjectId(v === "-" ? null : v)}>
              <SelectTrigger className="w-full" aria-label={t("tasks.project")}>
                <SelectValue placeholder={t("tasks.project")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-">{t("hub.tasks.noProject")}</SelectItem>
                {options?.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assignee ?? options?.me ?? "-"} onValueChange={setAssignee}>
              <SelectTrigger className="w-full" aria-label={t("hub.tasks.who")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!options && <SelectItem value="-">…</SelectItem>}
                {options?.members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <Button type="button" variant={urgent ? "destructive" : "ghost"} size="sm" onClick={() => setHigh(!urgent)}>
              <Flag className="size-4" /> {t("hub.tasks.high")}
            </Button>
            <Button type="submit" disabled={pending || !text.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
