"use client";

import { ArrowLeft, Ban, CalendarPlus, Clock, Link2, Lightbulb, Send, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page";
import { UploadButton } from "@/components/app/upload-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { PriorityHint } from "@/lib/smart-task";
import { addCommentAction, addDependencyAction, changeTaskAction, deleteCommentAction, removeDependencyAction, scheduleTaskAction, type HubResult } from "../hub-actions";

type Linked = { id: string; title: string; status: string };
type Props = {
  task: { id: string; title: string; description: string | null; status: string; priority: string; dueDate: string | null; assignedUserId: string | null; estimateMinutes: number | null; projectId: string | null; clientId: string | null };
  today: string;
  me: string;
  project: { id: string; name: string; dueDate: string | null } | null;
  client: { id: string; name: string } | null;
  order: { id: string; number: number; title: string | null } | null;
  waitsOn: Linked[];
  blocked: Linked[];
  waiting: Linked[];
  subtasks: Linked[];
  comments: { id: string; body: string; author: string | null; userId: string | null; at: string }[];
  files: { id: string; name: string }[];
  events: { id: string; title: string; date: string; time: string }[];
  minutes: number;
  candidates: { id: string; title: string }[];
  members: { id: string; name: string }[];
  hint: PriorityHint | null;
  canManage: boolean;
  canSchedule: boolean;
  canUpload: boolean;
  showsFiles: boolean;
  maxMediaBytes: number;
  assistant: boolean;
};

const STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

export function TaskView(p: Props) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState("");
  const [slot, setSlot] = useState({ date: p.task.dueDate ?? p.today, start: "09:00", minutes: String(p.task.estimateMinutes ?? 60) });
  const [scheduling, setScheduling] = useState(false);
  const run = (work: () => Promise<HubResult>, done?: () => void) =>
    start(async () => {
      const result = await work();
      if (result.error) toast.error(t(result.error, result.vars));
      else done?.();
      router.refresh();
    });
  const change = (patch: Parameters<typeof changeTaskAction>[1]) => run(() => changeTaskAction(p.task.id, patch));

  return (
    <>
      <PageHeader
        title={p.task.title}
        actions={
          <>
            {p.assistant && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/assistant?context=task:${p.task.id}`}>
                  <Sparkles className="size-4" /> {t("hub.ai.askAbout")}
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link href={p.project ? `/app/tasks?project=${p.project.id}` : "/app/tasks"}>
                <ArrowLeft className="size-4" /> {t("nav.tasks")}
              </Link>
            </Button>
          </>
        }
      />

      {p.blocked.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{t("hub.tasks.blockedTitle")}</p>
            <p className="text-muted-foreground">{p.blocked.map((b) => b.title).join(", ")}</p>
          </div>
        </div>
      )}
      {p.hint && p.canManage && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm">
          <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("hub.tasks.suggestPriority", { priority: t(`tasks.${p.hint.priority}`) })} <span className="text-muted-foreground">{p.hint.reasons.map((r) => t(`hub.tasks.why_${r}`)).join(" · ")}</span>
          </span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => change({ priority: p.hint!.priority })}>
            {t("hub.tasks.apply")}
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid h-fit gap-4">
          <Card>
            <CardContent className="grid gap-3">
              <Textarea
                key={p.task.description ?? ""}
                defaultValue={p.task.description ?? ""}
                rows={4}
                disabled={!p.canManage}
                aria-label={t("tasks.description")}
                placeholder={t("tasks.description")}
                onBlur={(e) => e.target.value !== (p.task.description ?? "") && change({ description: e.target.value })}
              />
              {p.subtasks.length > 0 && (
                <ul className="grid gap-1 text-sm">
                  {p.subtasks.map((s) => (
                    <li key={s.id}>
                      <Link href={`/app/tasks/${s.id}`} className={s.status === "DONE" ? "text-muted-foreground line-through" : "hover:text-primary"}>
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("hub.tasks.comments")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {p.comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-muted/50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{c.author ?? "—"}</span>
                    <span>{formatDate(c.at, locale, region)}</span>
                    {c.userId === p.me && (
                      <button type="button" className="ml-auto hover:text-destructive" aria-label={t("common.delete")} onClick={() => run(() => deleteCommentAction(c.id))}>
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (comment.trim()) run(() => addCommentAction(p.task.id, comment), () => setComment(""));
                }}
              >
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={4000} placeholder={t("hub.tasks.commentHint")} aria-label={t("hub.tasks.comments")} />
                <Button type="submit" size="icon" disabled={pending || !comment.trim()} aria-label={t("assistant.send")}>
                  <Send className="size-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="grid h-fit gap-4">
          <Card>
            <CardContent className="grid gap-3 text-sm">
              <Field label={t("orders.status")}>
                <Select value={p.task.status} disabled={!p.canManage || pending} onValueChange={(v) => change({ status: v as "TODO" })}>
                  <SelectTrigger className="w-full" aria-label={t("orders.status")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`tasks.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("tasks.priority")}>
                <Select value={p.task.priority} disabled={!p.canManage || pending} onValueChange={(v) => change({ priority: v as "LOW" })}>
                  <SelectTrigger className="w-full" aria-label={t("tasks.priority")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`tasks.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("hub.tasks.who")}>
                <Select value={p.task.assignedUserId ?? "-"} disabled={!p.canManage || pending} onValueChange={(v) => change({ assignedUserId: v })}>
                  <SelectTrigger className="w-full" aria-label={t("hub.tasks.who")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {p.members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("hub.tasks.due")}>
                <Input type="date" defaultValue={p.task.dueDate ?? ""} disabled={!p.canManage} onChange={(e) => change({ dueDate: e.target.value || null })} />
              </Field>
              <Field label={t("hub.tasks.estimate")}>
                <Input
                  type="number"
                  min={1}
                  defaultValue={p.task.estimateMinutes ?? ""}
                  disabled={!p.canManage}
                  onBlur={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    if (value !== p.task.estimateMinutes) change({ estimateMinutes: value });
                  }}
                />
              </Field>
              {p.minutes > 0 && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4" aria-hidden /> {t("hub.tasks.tracked", { minutes: p.minutes })}
                </p>
              )}
            </CardContent>
          </Card>

          {(p.project || p.client || p.order) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("hub.tasks.linked")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {p.project && (
                  <Link href={`/app/tasks/projects/${p.project.id}`} className="hover:text-primary">
                    {t("tasks.project")}: {p.project.name}
                  </Link>
                )}
                {p.client && (
                  <Link href={`/app/clients/${p.client.id}`} className="hover:text-primary">
                    {t("nav.clients")}: {p.client.name}
                  </Link>
                )}
                {p.order && (
                  <Link href={`/app/orders/${p.order.id}`} className="hover:text-primary">
                    {t("nav.orders")}: {p.order.title ?? `#${p.order.number}`}
                  </Link>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="size-4" aria-hidden /> {t("hub.tasks.dependencies")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {p.waitsOn.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <Link href={`/app/tasks/${d.id}`} className={d.status === "DONE" ? "min-w-0 flex-1 truncate text-muted-foreground line-through" : "min-w-0 flex-1 truncate hover:text-primary"}>
                    {d.title}
                  </Link>
                  {p.canManage && (
                    <button type="button" aria-label={t("common.delete")} className="text-muted-foreground hover:text-destructive" onClick={() => run(() => removeDependencyAction(p.task.id, d.id))}>
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              {p.waiting.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("hub.tasks.waitedForBy")}: {p.waiting.map((w) => w.title).join(", ")}
                </p>
              )}
              {p.canManage && p.candidates.length > 0 && (
                <Select value="" onValueChange={(v) => run(() => addDependencyAction(p.task.id, v))}>
                  <SelectTrigger className="w-full" aria-label={t("hub.tasks.addDependency")}>
                    <SelectValue placeholder={t("hub.tasks.addDependency")} />
                  </SelectTrigger>
                  <SelectContent>
                    {p.candidates
                      .filter((c) => !p.waitsOn.some((d) => d.id === c.id))
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {p.showsFiles && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{t("documents.title")}</CardTitle>
                {p.canUpload && <UploadButton variant="outline" media={{ maxBytes: p.maxMediaBytes }} meta={{ taskId: p.task.id, projectId: p.task.projectId, clientId: p.task.clientId }} />}
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {p.files.length === 0 && <p className="text-muted-foreground">{t("common.none")}</p>}
                {p.files.map((f) => (
                  <a key={f.id} href={`/app/documents/${f.id}/file`} target="_blank" rel="noreferrer" className="truncate hover:text-primary">
                    {f.name}
                  </a>
                ))}
              </CardContent>
            </Card>
          )}

          {p.canSchedule && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("nav.calendar")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {p.events.map((e) => (
                  <Link key={e.id} href={`/app/calendar?view=day&date=${e.date}`} className="hover:text-primary">
                    {formatDate(e.date, locale, region)} {e.time}
                  </Link>
                ))}
                {!scheduling ? (
                  <Button variant="outline" size="sm" onClick={() => setScheduling(true)}>
                    <CalendarPlus className="size-4" /> {t("hub.tasks.schedule")}
                  </Button>
                ) : (
                  <form
                    className="grid gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => scheduleTaskAction(p.task.id, slot.date, slot.start, Number(slot.minutes)), () => setScheduling(false));
                    }}
                  >
                    <div className="grid grid-cols-3 gap-2">
                      <Input type="date" className="col-span-3" value={slot.date} onChange={(e) => setSlot({ ...slot, date: e.target.value })} required aria-label={t("hub.tasks.due")} />
                      <Input type="time" className="col-span-2" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} required aria-label={t("calendar.from")} />
                      <Input type="number" min={5} value={slot.minutes} onChange={(e) => setSlot({ ...slot, minutes: e.target.value })} required aria-label={t("hub.tasks.estimate")} />
                    </div>
                    <Button type="submit" size="sm" disabled={pending}>
                      {t("common.save")}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
