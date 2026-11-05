/**
 * Everything around one task: what it waits for, what waits for it, who said
 * what, its files, appointments and time, so nobody has to look in six places.
 */
import { aliasedTable, and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { appointments, clients, documents, orders, projectMembers, projects, taskComments, taskDependencies, tasks, timeEntries, users } from "@/db/schema";
import { getDb } from "@/db/client";
import { withTenant, type Tx } from "@/db/tenant";
import { mentionedUsers, suggestPriority } from "@/lib/smart-task";
import { audit } from "./audit";
import { createAppointment, zonedTime } from "./calendar";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { today } from "./money";
import { notify } from "./notifications";
import { requirePermission } from "./permissions";
import { TaskError } from "./tasks";
import { memberOptions } from "./team";
import { minutesOf } from "./time";

/** Follows what a task waits for, to find out whether `target` is among it. */
async function waitsFor(tx: Tx, start: string, target: string): Promise<boolean> {
  const seen = new Set<string>();
  let frontier = [start];
  while (frontier.length) {
    if (frontier.includes(target)) return true;
    for (const id of frontier) seen.add(id);
    const next = await tx.select({ id: taskDependencies.dependsOnId }).from(taskDependencies).where(inArray(taskDependencies.taskId, frontier));
    frontier = next.map((n) => n.id).filter((id) => !seen.has(id));
  }
  return false;
}

export async function addDependency(ctx: Context, taskId: string, dependsOnId: string): Promise<void> {
  requirePermission(ctx.permissions, "tasks.manage");
  if (taskId === dependsOnId) throw new TaskError("CYCLE");
  await withTenant(ctx.organization.id, async (tx) => {
    const found = await tx.select({ id: tasks.id }).from(tasks).where(inArray(tasks.id, [taskId, dependsOnId]));
    if (found.length !== 2) throw new NotFoundError();
    if (await waitsFor(tx, dependsOnId, taskId)) throw new TaskError("CYCLE");
    await tx.insert(taskDependencies).values({ organizationId: ctx.organization.id, taskId, dependsOnId }).onConflictDoNothing();
    await audit(tx, ctx, "task.update", "task", taskId, { dependsOn: dependsOnId });
  });
}

export async function removeDependency(ctx: Context, taskId: string, dependsOnId: string): Promise<void> {
  requirePermission(ctx.permissions, "tasks.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    await tx.delete(taskDependencies).where(and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnId, dependsOnId)));
    await audit(tx, ctx, "task.update", "task", taskId, { removedDependency: dependsOnId });
  });
}

const commentInput = z.string().trim().min(1).max(4000);

/** A comment; whoever it names with @ and whoever owns the task hear about it. */
export async function addComment(ctx: Context, taskId: string, raw: string): Promise<void> {
  requirePermission(ctx.permissions, "tasks.read");
  const body = commentInput.parse(raw);
  const task = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!row) throw new NotFoundError();
    await tx.insert(taskComments).values({ organizationId: ctx.organization.id, taskId, userId: ctx.user.userId, body });
    return row;
  });
  const mentioned = mentionedUsers(body, await memberOptions(ctx)).filter((id) => id !== ctx.user.userId);
  const href = `/app/tasks/${taskId}`;
  const vars = { who: ctx.user.name, title: task.title };
  await notify(ctx.organization.id, mentioned, { category: "mention", kind: "mentionTask", vars, href, entity: "task", entityId: taskId, priority: 2, dedupeKey: `mention:${taskId}:${Date.now()}` });
  if (task.assignedUserId && task.assignedUserId !== ctx.user.userId && !mentioned.includes(task.assignedUserId)) {
    await notify(ctx.organization.id, [task.assignedUserId], { category: "update", kind: "taskComment", vars, href, entity: "task", entityId: taskId, dedupeKey: `comment:${taskId}:${Date.now()}` });
  }
}

export async function deleteComment(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(taskComments).where(and(eq(taskComments.id, id), eq(taskComments.userId, ctx.user.userId))).returning({ id: taskComments.id });
    if (!row) throw new NotFoundError();
  });
}

export async function taskHub(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "tasks.read");
  const can = (p: Parameters<Context["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  const now = today(ctx.organization.timezone);
  const data = await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .select({ task: tasks, project: projects, client: clients, order: orders })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .leftJoin(orders, eq(orders.id, tasks.orderId))
      .where(eq(tasks.id, id))
      .limit(1);
    if (!row) throw new NotFoundError();
    const blocker = aliasedTable(tasks, "blocker");
    const waitsOn = await tx
      .select({ id: blocker.id, title: blocker.title, status: blocker.status })
      .from(taskDependencies)
      .innerJoin(blocker, eq(blocker.id, taskDependencies.dependsOnId))
      .where(eq(taskDependencies.taskId, id));
    const waiting = await tx
      .select({ id: blocker.id, title: blocker.title, status: blocker.status })
      .from(taskDependencies)
      .innerJoin(blocker, eq(blocker.id, taskDependencies.taskId))
      .where(eq(taskDependencies.dependsOnId, id));
    const subtasks = await tx.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(eq(tasks.parentId, id)).orderBy(asc(tasks.createdAt));
    const comments = await tx.select().from(taskComments).where(eq(taskComments.taskId, id)).orderBy(asc(taskComments.createdAt)).limit(200);
    const files = can("documents.read") ? await tx.select({ id: documents.id, name: documents.name }).from(documents).where(eq(documents.taskId, id)).orderBy(desc(documents.createdAt)).limit(50) : [];
    const events = can("calendar.read")
      ? await tx.select({ id: appointments.id, title: appointments.title, startsAt: appointments.startsAt }).from(appointments).where(eq(appointments.taskId, id)).orderBy(asc(appointments.startsAt)).limit(20)
      : [];
    const time = can("time.read") ? await tx.select().from(timeEntries).where(and(eq(timeEntries.taskId, id), isNotNull(timeEntries.endedAt))) : [];
    // Other open tasks it could wait for: those of the same project first.
    const candidates = await tx
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(ne(tasks.id, id), ne(tasks.status, "DONE")))
      .orderBy(row.task.projectId ? sql`(${tasks.projectId} = ${row.task.projectId}) desc nulls last` : desc(tasks.createdAt))
      .limit(100);
    return { ...row, waitsOn, waiting, subtasks, comments, files, events, minutes: time.reduce((sum, e) => sum + minutesOf(e), 0), candidates };
  });
  const members = await memberOptions(ctx);
  const nameOf = (userId: string | null) => members.find((m) => m.id === userId)?.name ?? null;
  const projectDueInDays = data.project?.dueDate ? Math.round((Date.parse(data.project.dueDate) - Date.parse(now)) / 86_400_000) : null;
  const dependents = data.waiting.filter((w) => w.status !== "DONE").length;
  return {
    task: data.task,
    project: data.project ? { id: data.project.id, name: data.project.name, dueDate: data.project.dueDate } : null,
    client: data.client && can("clients.read") ? { id: data.client.id, name: displayName(data.client) } : null,
    order: data.order && can("orders.read") ? { id: data.order.id, number: data.order.number, title: data.order.title } : null,
    assignee: nameOf(data.task.assignedUserId),
    waitsOn: data.waitsOn,
    blocked: data.waitsOn.filter((b) => b.status !== "DONE"),
    waiting: data.waiting,
    subtasks: data.subtasks,
    comments: data.comments.map((c) => ({ ...c, author: nameOf(c.userId) })),
    files: data.files,
    events: data.events,
    minutes: data.minutes,
    candidates: data.candidates,
    members,
    hint: data.task.status === "DONE" ? null : suggestPriority({ dueDate: data.task.dueDate, today: now, dependents, projectDueInDays, current: data.task.priority }),
  };
}

const slotInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), minutes: z.coerce.number().int().min(5).max(600) });

/** Blocks time in the calendar for a task, linked to it. */
export async function scheduleTask(ctx: Context, id: string, raw: z.input<typeof slotInput>): Promise<void> {
  requirePermission(ctx.permissions, "calendar.manage");
  const slot = slotInput.parse(raw);
  const [task] = await withTenant(ctx.organization.id, (tx) => tx.select().from(tasks).where(eq(tasks.id, id)));
  if (!task) throw new NotFoundError();
  const startsAt = zonedTime(slot.date, slot.start, ctx.organization.timezone);
  const [row] = await createAppointment(ctx, { title: task.title, clientId: task.clientId, assignedUserId: task.assignedUserId, startsAt, endsAt: new Date(startsAt.getTime() + slot.minutes * 60_000) });
  await withTenant(ctx.organization.id, (tx) => tx.update(appointments).set({ taskId: id }).where(eq(appointments.id, row.id)));
}

// --- Project team -----------------------------------------------------------------------------

export async function projectTeam(ctx: Context, projectId: string): Promise<{ id: string; name: string }[]> {
  requirePermission(ctx.permissions, "tasks.read");
  const rows = await withTenant(ctx.organization.id, (tx) => tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId)));
  if (!rows.length) return [];
  return getDb().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, rows.map((r) => r.userId))).orderBy(asc(users.name));
}

export async function setProjectMember(ctx: Context, projectId: string, userId: string, member: boolean): Promise<void> {
  requirePermission(ctx.permissions, "tasks.manage");
  if (!(await memberOptions(ctx)).some((m) => m.id === userId)) throw new NotFoundError();
  const added = await withTenant(ctx.organization.id, async (tx) => {
    const [project] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId));
    if (!project) throw new NotFoundError();
    if (!member) {
      await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
      return null;
    }
    const [row] = await tx.insert(projectMembers).values({ organizationId: ctx.organization.id, projectId, userId }).onConflictDoNothing().returning({ id: projectMembers.id });
    return row ? project.name : null;
  });
  if (added && userId !== ctx.user.userId) {
    await notify(ctx.organization.id, [userId], { category: "assigned", kind: "projectMember", vars: { project: added }, href: `/app/tasks/projects/${projectId}`, entity: "project", entityId: projectId, dedupeKey: `project-member:${projectId}:${userId}` });
  }
}

// --- The day ----------------------------------------------------------------------------------

const DEFAULT_MINUTES = 30;

type PlanTask = { id: string; title: string; priority: "LOW" | "MEDIUM" | "HIGH"; dueDate: string | null; estimateMinutes: number | null; projectName: string | null; blocked: boolean };
export type Slot = { from: string; to: string; taskId: string; title: string };

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Lays tasks into the free time of a working day, in the given order; what does not fit stays out. */
export function fitIntoDay(list: readonly PlanTask[], work: { from: string; to: string }, busy: readonly { from: string; to: string }[]): { slots: Slot[]; left: string[] } {
  const free: [number, number][] = [];
  let cursor = toMinutes(work.from);
  const end = toMinutes(work.to);
  for (const b of [...busy].sort((x, y) => x.from.localeCompare(y.from))) {
    const from = Math.min(Math.max(toMinutes(b.from), cursor), end);
    if (from > cursor) free.push([cursor, from]);
    cursor = Math.max(cursor, Math.min(toMinutes(b.to), end));
  }
  if (cursor < end) free.push([cursor, end]);
  const slots: Slot[] = [];
  const left: string[] = [];
  for (const task of list) {
    const need = task.estimateMinutes ?? DEFAULT_MINUTES;
    const gap = free.find(([from, to]) => to - from >= need);
    if (!gap) {
      left.push(task.id);
      continue;
    }
    slots.push({ from: toTime(gap[0]), to: toTime(gap[0] + need), taskId: task.id, title: task.title });
    gap[0] += need;
  }
  return { slots, left };
}

const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Overdue first, then by date and priority: the order the day is offered in. */
export function suggestedOrder<T extends Pick<PlanTask, "priority" | "dueDate" | "blocked">>(list: readonly T[], day: string): T[] {
  return [...list].sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    const late = Number((b.dueDate ?? "9") < day) - Number((a.dueDate ?? "9") < day);
    if (late) return late;
    const priority = rank[a.priority] - rank[b.priority];
    return priority || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });
}

/** One person's open tasks that matter for a day, and those they chose for it. */
export async function myDayTasks(ctx: Context, day: string, horizonDays = 7) {
  requirePermission(ctx.permissions, "tasks.read");
  const until = new Date(`${day}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + horizonDays);
  const horizon = until.toISOString().slice(0, 10);
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select({
        task: tasks,
        projectName: projects.name,
        blockers: sql<number>`(select count(*)::int from task_dependencies d join tasks b on b.id = d.depends_on_id where d.task_id = ${tasks.id} and b.status <> 'DONE')`,
      })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.assignedUserId, ctx.user.userId), ne(tasks.status, "DONE"), or(lte(tasks.dueDate, horizon), eq(tasks.plannedFor, day))))
      .orderBy(asc(tasks.plannedPosition), asc(tasks.dueDate))
      .limit(200),
  );
  return rows.map((r) => ({
    id: r.task.id,
    title: r.task.title,
    priority: r.task.priority,
    status: r.task.status,
    dueDate: r.task.dueDate,
    estimateMinutes: r.task.estimateMinutes,
    plannedFor: r.task.plannedFor,
    projectName: r.projectName,
    blocked: Number(r.blockers) > 0,
  }));
}

export async function planTask(ctx: Context, id: string, day: string | null): Promise<void> {
  requirePermission(ctx.permissions, "tasks.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    let position = 0;
    if (day) {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${tasks.plannedPosition}), 0) + 1` })
        .from(tasks)
        .where(and(eq(tasks.plannedFor, day), eq(tasks.assignedUserId, ctx.user.userId)));
      position = Number(next);
    }
    const [row] = await tx.update(tasks).set({ plannedFor: day, plannedPosition: position, updatedAt: new Date() }).where(eq(tasks.id, id)).returning({ id: tasks.id });
    if (!row) throw new NotFoundError();
  });
}

/** The day's order as the person arranged it. */
export async function orderPlan(ctx: Context, ids: readonly string[]): Promise<void> {
  requirePermission(ctx.permissions, "tasks.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    for (const [index, id] of ids.slice(0, 200).entries()) {
      await tx.update(tasks).set({ plannedPosition: index + 1 }).where(and(eq(tasks.id, id), eq(tasks.assignedUserId, ctx.user.userId)));
    }
  });
}

/** Whether anything is due in the coming days, for the question of a deadlines widget. */
export async function deadlineCount(ctx: Context, from: string, to: string): Promise<number> {
  const [row] = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.assignedUserId, ctx.user.userId), ne(tasks.status, "DONE"), gte(tasks.dueDate, from), lte(tasks.dueDate, to))),
  );
  return Number(row?.n ?? 0);
}
