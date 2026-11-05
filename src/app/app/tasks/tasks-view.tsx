"use client";

import { Ban, CalendarDays, CheckSquare, ExternalLink, FolderPlus, LayoutGrid, List, Plus, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/server/tasks";
import { deleteTaskAction, moveTaskAction, saveProjectAction, saveTaskAction, subtasksAction } from "./actions";

const STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
type Priority = (typeof PRIORITIES)[number];

export type TaskCard = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  orderId: string | null;
  assignedUserId: string | null;
  subtasks: number;
  subtasksDone: number;
  blockers: number;
};

type Draft = Omit<TaskCard, "id" | "projectName" | "clientName" | "subtasks" | "subtasksDone" | "blockers"> & { id: string | null };

const PRIORITY_TONE: Record<Priority, string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-primary border-primary/30",
  HIGH: "text-destructive border-destructive/30 bg-destructive/5",
};

export function TasksView({
  view,
  openNew,
  project,
  mine,
  today,
  me,
  canManage,
  projects,
  members,
  clients,
  tasks: initial,
}: {
  view: "board" | "list";
  /** Opened from a quick action: start with this dialog. */
  openNew: "task" | "project" | null;
  project: string | null;
  mine: boolean;
  today: string;
  me: string;
  canManage: boolean;
  projects: { id: string; name: string; open: number }[];
  members: { id: string; name: string }[];
  clients: { id: string; name: string; number: number }[];
  tasks: TaskCard[];
}) {
  const { t, locale, region } = useI18n();
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; done: boolean }[]>([]);
  const [newSub, setNewSub] = useState("");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setTasks(initial), [initial]);

  const href = (p: { view?: string; project?: string | null; mine?: boolean }) => {
    const q = new URLSearchParams();
    q.set("view", p.view ?? view);
    const proj = p.project === undefined ? project : p.project;
    if (proj) q.set("project", proj);
    if (p.mine ?? mine) q.set("mine", "1");
    return `/app/tasks${q.size ? `?${q}` : ""}`;
  };
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? "—";
  const initials = (id: string | null) =>
    name(id)
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  useEffect(() => {
    if (!canManage) return;
    if (openNew === "task") setDraft(blank());
    if (openNew === "project") setProjectName("");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const blank = (status: TaskStatus = "TODO"): Draft => ({
    id: null,
    title: "",
    description: "",
    status,
    priority: "MEDIUM",
    dueDate: null,
    projectId: project,
    clientId: null,
    orderId: null,
    assignedUserId: me,
  });
  const open = (task: TaskCard) => {
    setDraft({ ...task });
    setSubtasks([]);
    if (task.subtasks) subtasksAction(task.id).then(setSubtasks).catch(() => undefined);
  };
  const payload = (d: Draft) => ({
    title: d.title,
    description: d.description,
    status: d.status,
    priority: d.priority,
    dueDate: d.dueDate,
    projectId: d.projectId,
    clientId: d.clientId,
    orderId: d.orderId,
    assignedUserId: d.assignedUserId,
  });
  const save = () =>
    draft &&
    start(async () => {
      const result = await saveTaskAction(draft.id, payload(draft));
      if (result.ok) {
        setDraft(null);
        router.refresh();
      } else toast.error(t(result.error ?? "common.error", result.vars));
    });

  const drop = (status: TaskStatus, beforeId: string | null) => {
    const id = dragging;
    setDragging(null);
    if (!id || id === beforeId) return;
    setTasks((all) => {
      const moved = all.find((x) => x.id === id);
      if (!moved) return all;
      const rest = all.filter((x) => x.id !== id);
      const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
      rest.splice(at === -1 ? rest.length : at, 0, { ...moved, status });
      return rest;
    });
    start(async () => {
      const result = await moveTaskAction(id, status, beforeId);
      if (!result.ok) toast.error(t(result.error ?? "common.error", result.vars));
      router.refresh();
    });
  };

  const blockedMark = (task: TaskCard) =>
    task.blockers > 0 && (
      <span className="flex items-center gap-1 text-warning" title={t("hub.tasks.blockedTitle")}>
        <Ban className="size-3" aria-hidden /> {task.blockers}
      </span>
    );

  const due = (task: TaskCard) =>
    task.dueDate && (
      <span className={cn("flex items-center gap-1", task.status !== "DONE" && task.dueDate < today && "font-medium text-destructive")}>
        <CalendarDays className="size-3" /> {formatDate(task.dueDate, locale, region)}
      </span>
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold tracking-tight">{t("nav.tasks")}</h1>
        <div className="flex rounded-lg border bg-card p-0.5">
          <Link href={href({ view: "board" })} className={cn("rounded-md p-1.5", view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground")} aria-label={t("tasks.board")}>
            <LayoutGrid className="size-4" />
          </Link>
          <Link href={href({ view: "list" })} className={cn("rounded-md p-1.5", view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground")} aria-label={t("tasks.list")}>
            <List className="size-4" />
          </Link>
        </div>
        <Button variant={mine ? "default" : "outline"} asChild>
          <Link href={href({ mine: !mine })}>{t("calendar.mine")}</Link>
        </Button>
        {canManage && (
          <Button onClick={() => setDraft(blank())}>
            <Plus className="size-4" /> {t("tasks.new")}
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={href({ project: null })} className={cn("rounded-full border px-3 py-1 text-sm", !project ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
          {t("common.all")}
        </Link>
        {projects.map((p) => (
          <Link
            key={p.id}
            href={href({ project: p.id })}
            className={cn("rounded-full border px-3 py-1 text-sm", project === p.id ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
          >
            {p.name} <span className="tabular-nums opacity-70">{p.open}</span>
          </Link>
        ))}
        {canManage && (
          <button type="button" onClick={() => setProjectName("")} className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:text-foreground">
            <FolderPlus className="size-3.5" /> {t("tasks.newProject")}
          </button>
        )}
      </div>

      {view === "board" ? (
        <div className="grid gap-3 md:grid-cols-4">
          {STATUSES.map((status) => {
            const column = tasks.filter((x) => x.status === status);
            return (
              <div
                key={status}
                className={cn("flex min-h-40 flex-col gap-2 rounded-xl border bg-muted/30 p-2", dragging && "border-dashed")}
                onDragOver={(e) => canManage && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(status, null);
                }}
              >
                <div className="flex items-center justify-between px-1 text-sm font-medium">
                  <span>
                    {t(`tasks.${status}`)} <span className="tabular-nums text-muted-foreground">{column.length}</span>
                  </span>
                  {canManage && (
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setDraft(blank(status))} aria-label={t("tasks.new")}>
                      <Plus className="size-4" />
                    </button>
                  )}
                </div>
                {column.map((task) => (
                  <div
                    key={task.id}
                    draggable={canManage}
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => canManage && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      drop(status, task.id);
                    }}
                    onClick={() => open(task)}
                    className={cn(
                      "cursor-pointer rounded-lg border bg-card p-3 text-sm shadow-xs transition hover:border-primary/40",
                      dragging === task.id && "opacity-40",
                      status === "DONE" && "opacity-70",
                    )}
                  >
                    <div className={cn("font-medium", status === "DONE" && "line-through")}>{task.title}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {task.priority !== "MEDIUM" && (
                        <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", PRIORITY_TONE[task.priority])}>
                          {t(`tasks.${task.priority}`)}
                        </Badge>
                      )}
                      {due(task)}
                      {blockedMark(task)}
                      {task.subtasks > 0 && (
                        <span className="flex items-center gap-1">
                          <CheckSquare className="size-3" /> {task.subtasksDone}/{task.subtasks}
                        </span>
                      )}
                      {task.clientName && <span className="truncate">{task.clientName}</span>}
                      <span className="ml-auto flex size-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={name(task.assignedUserId)}>
                        {initials(task.assignedUserId)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tasks.task")}</TableHead>
                <TableHead>{t("orders.status")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("tasks.due")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("calendar.who")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("tasks.project")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t("tasks.empty")}
                  </TableCell>
                </TableRow>
              )}
              {tasks.map((task) => (
                <TableRow key={task.id} className="cursor-pointer" onClick={() => open(task)}>
                  <TableCell className={cn("font-medium", task.status === "DONE" && "line-through opacity-70")}>{task.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(`tasks.${task.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-xs sm:table-cell">{due(task) || "—"}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{name(task.assignedUserId)}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{task.projectName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("tasks.edit") : t("tasks.new")}</DialogTitle>
            <DialogDescription className="sr-only">{t("nav.tasks")}</DialogDescription>
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
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required maxLength={300} autoFocus aria-label={t("tasks.task")} placeholder={t("tasks.task")} />
                <Textarea rows={3} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label={t("tasks.description")} placeholder={t("tasks.description")} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("orders.status")}>
                    <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v as TaskStatus })}>
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
                    <Select value={draft.priority} onValueChange={(v) => setDraft({ ...draft, priority: v as Priority })}>
                      <SelectTrigger className="w-full" aria-label={t("tasks.priority")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {t(`tasks.${p}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("tasks.due")}>
                    <Input type="date" value={draft.dueDate ?? ""} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })} />
                  </Field>
                  <Field label={t("calendar.who")}>
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
                  </Field>
                  <Field label={t("tasks.project")}>
                    <Select value={draft.projectId ?? "-"} onValueChange={(v) => setDraft({ ...draft, projectId: v === "-" ? null : v })}>
                      <SelectTrigger className="w-full" aria-label={t("tasks.project")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-">—</SelectItem>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("orders.client")}>
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
                  </Field>
                </div>
              </fieldset>

              {draft.id && (
                <div className="grid gap-1.5 border-t pt-3">
                  <span className="text-sm font-medium">{t("tasks.subtasks")}</span>
                  {subtasks.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!canManage}
                      className="flex items-center gap-2 text-left text-sm"
                      onClick={() =>
                        start(async () => {
                          setSubtasks((all) => all.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)));
                          await saveTaskAction(s.id, { title: s.title, status: s.done ? "TODO" : "DONE", parentId: draft.id, assignedUserId: draft.assignedUserId });
                          router.refresh();
                        })
                      }
                    >
                      {s.done ? <CheckSquare className="size-4 text-success" /> : <Square className="size-4 text-muted-foreground" />}
                      <span className={cn(s.done && "text-muted-foreground line-through")}>{s.title}</span>
                    </button>
                  ))}
                  {canManage && (
                    <div className="flex gap-2">
                      <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder={t("tasks.addSubtask")} className="h-8" />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!newSub.trim() || pending}
                        onClick={() =>
                          start(async () => {
                            const result = await saveTaskAction(null, { title: newSub, parentId: draft.id, projectId: draft.projectId, assignedUserId: draft.assignedUserId });
                            if (result.ok && result.id) {
                              setSubtasks((all) => [...all, { id: result.id!, title: newSub.trim(), done: false }]);
                              setNewSub("");
                              router.refresh();
                            }
                          })
                        }
                      >
                        <Plus className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {draft.id && (
                <Button asChild variant="ghost" size="sm" className="w-fit">
                  <Link href={`/app/tasks/${draft.id}`}>
                    <ExternalLink className="size-4" /> {t("hub.tasks.open")}
                  </Link>
                </Button>
              )}
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
                          await deleteTaskAction(draft.id!);
                          setDraft(null);
                          router.refresh();
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

      {project && (
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/tasks/projects/${project}`}>{t("projectHub.open")}</Link>
          </Button>
        </div>
      )}

      <Dialog open={projectName !== null} onOpenChange={(o) => !o && setProjectName(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("tasks.newProject")}</DialogTitle>
            <DialogDescription className="sr-only">{t("tasks.newProject")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await saveProjectAction(null, projectName ?? "", null);
                if (result.ok && result.id) {
                  setProjectName(null);
                  router.push(href({ project: result.id }));
                } else toast.error(t(result.error ?? "common.error"));
              });
            }}
          >
            <Input value={projectName ?? ""} onChange={(e) => setProjectName(e.target.value)} required maxLength={200} autoFocus aria-label={t("tasks.project")} />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
