/**
 * Projects and tasks: who does what by when. Tasks may belong to a project,
 * a client or an order, and may have subtasks (one level). Moving a card on
 * the board sets status and position in one step.
 */
import { aliasedTable, and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { clients, orders, projects, taskDependencies, tasks } from "@/db/schema";
import { audit, type Via } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { today } from "./money";
import { notify } from "./notifications";
import { requirePermission } from "./permissions";

export class TaskError extends Error {
  constructor(public readonly code: "BLOCKED" | "CYCLE", public readonly blockers: string[] = []) {
    super(code);
  }
}

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type Task = typeof tasks.$inferSelect;
export type Project = typeof projects.$inferSelect;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const optionalId = z.string().uuid().nullish().transform((v) => v || null);
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v || null);

export const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: optionalText(5000),
  status: z.enum(TASK_STATUSES).default("TODO"),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  dueDate: optionalDate,
  projectId: optionalId,
  parentId: optionalId,
  clientId: optionalId,
  orderId: optionalId,
  assignedUserId: optionalId,
  estimateMinutes: z.coerce.number().int().min(1).max(10_000).nullish().transform((v) => v ?? null),
});
export type TaskInput = z.input<typeof taskInput>;

/** What still has to be finished before a task can move on. */
async function openBlockers(tx: Tx, id: string): Promise<string[]> {
  const blocker = aliasedTable(tasks, "blocker");
  const rows = await tx
    .select({ title: blocker.title })
    .from(taskDependencies)
    .innerJoin(blocker, eq(blocker.id, taskDependencies.dependsOnId))
    .where(and(eq(taskDependencies.taskId, id), ne(blocker.status, "DONE")));
  return rows.map((r) => r.title);
}

/** A task waiting for another stays in "to do" until that one is finished. */
async function assertUnblocked(tx: Tx, id: string, status: TaskStatus): Promise<void> {
  if (status === "TODO") return;
  const blockers = await openBlockers(tx, id);
  if (blockers.length) throw new TaskError("BLOCKED", blockers);
}

async function tellAssignee(ctx: Context, task: Task): Promise<void> {
  if (!task.assignedUserId || task.assignedUserId === ctx.user.userId) return;
  await notify(ctx.organization.id, [task.assignedUserId], {
    category: "assigned",
    kind: "taskAssigned",
    vars: { title: task.title, who: ctx.user.name },
    href: `/app/tasks/${task.id}`,
    entity: "task",
    entityId: task.id,
    priority: task.priority === "HIGH" ? 2 : 1,
    dedupeKey: `task-assigned:${task.id}:${task.assignedUserId}`,
  });
}

export async function createTask(ctx: Context, raw: TaskInput, via: Via = "web"): Promise<Task> {
  requirePermission(ctx.permissions, "tasks.manage");
  const input = taskInput.parse(raw);
  const created = await withTenant(ctx.organization.id, async (tx) => {
    // Links must point into this company (RLS hides others, so "not found" is enough).
    if (input.projectId && !(await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId))).length) throw new NotFoundError();
    if (input.clientId && !(await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId))).length) throw new NotFoundError();
    if (input.orderId && !(await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId))).length) throw new NotFoundError();
    if (input.parentId && !(await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.parentId), isNull(tasks.parentId)))).length) {
      throw new NotFoundError();
    }
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${tasks.position}), 0) + 1` }).from(tasks).where(eq(tasks.status, input.status));
    const [row] = await tx
      .insert(tasks)
      .values({
        ...input,
        organizationId: ctx.organization.id,
        assignedUserId: input.assignedUserId ?? ctx.user.userId,
        createdBy: ctx.user.userId,
        position: Number(next),
        completedAt: input.status === "DONE" ? new Date() : null,
      })
      .returning();
    await audit(tx, ctx, "task.create", "task", row.id, { title: row.title }, via);
    return row;
  });
  await tellAssignee(ctx, created);
  return created;
}

export async function updateTask(ctx: Context, id: string, raw: TaskInput, via: Via = "web"): Promise<Task> {
  requirePermission(ctx.permissions, "tasks.manage");
  const input = taskInput.parse(raw);
  const { row, reassigned } = await withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!current) throw new NotFoundError();
    if (current.status !== input.status) await assertUnblocked(tx, id, input.status);
    const [row] = await tx
      .update(tasks)
      .set({
        ...input,
        parentId: input.parentId === id ? current.parentId : input.parentId,
        completedAt: input.status === "DONE" ? (current.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    await audit(tx, ctx, "task.update", "task", id, { status: input.status }, via);
    return { row, reassigned: row.assignedUserId !== current.assignedUserId };
  });
  if (reassigned) await tellAssignee(ctx, row);
  return row;
}

/** A card dropped on the board: new status, placed before `beforeId` (or at the end). */
export async function moveTask(ctx: Context, id: string, status: TaskStatus, beforeId: string | null = null): Promise<void> {
  requirePermission(ctx.permissions, "tasks.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!current) throw new NotFoundError();
    if (current.status !== status) await assertUnblocked(tx, id, status);
    const column = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.status, status), ne(tasks.id, id), isNull(tasks.parentId)))
      .orderBy(asc(tasks.position), asc(tasks.createdAt));
    const ids = column.map((c) => c.id);
    const at = beforeId ? ids.indexOf(beforeId) : -1;
    ids.splice(at === -1 ? ids.length : at, 0, id);
    for (const [index, taskId] of ids.entries()) {
      await tx
        .update(tasks)
        .set(
          taskId === id
            ? { status, position: index + 1, completedAt: status === "DONE" ? (current.completedAt ?? new Date()) : null, updatedAt: new Date() }
            : { position: index + 1 },
        )
        .where(eq(tasks.id, taskId));
    }
    if (current.status !== status) await audit(tx, ctx, "task.move", "task", id, { from: current.status, to: status });
  });
}

export async function deleteTask(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "tasks.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    await tx.delete(tasks).where(eq(tasks.parentId, id));
    const [row] = await tx.delete(tasks).where(eq(tasks.id, id)).returning({ title: tasks.title });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "task.delete", "task", id, { title: row.title });
  });
}

export type TaskQuery = { q?: string; projectId?: string; clientId?: string; orderId?: string; assignedUserId?: string; open?: boolean; overdue?: boolean };

/** Top-level tasks with their subtask counts, newest first within status. */
export async function listTasks(ctx: Context, query: TaskQuery = {}) {
  requirePermission(ctx.permissions, "tasks.read");
  const filters: SQL[] = [isNull(tasks.parentId)];
  if (query.projectId) filters.push(eq(tasks.projectId, query.projectId));
  if (query.clientId) filters.push(eq(tasks.clientId, query.clientId));
  if (query.orderId) filters.push(eq(tasks.orderId, query.orderId));
  if (query.assignedUserId) filters.push(eq(tasks.assignedUserId, query.assignedUserId));
  if (query.open || query.overdue) filters.push(ne(tasks.status, "DONE"));
  if (query.overdue) filters.push(lt(tasks.dueDate, today(ctx.organization.timezone)));
  const q = query.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(tasks.title, like), ilike(tasks.description, like))!);
  }
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({
        task: tasks,
        project: projects.name,
        client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName },
        subtasks: sql<number>`(select count(*)::int from tasks s where s.parent_id = ${tasks.id})`,
        subtasksDone: sql<number>`(select count(*)::int from tasks s where s.parent_id = ${tasks.id} and s.status = 'DONE')`,
        blockers: sql<number>`(select count(*)::int from task_dependencies d join tasks b on b.id = d.depends_on_id where d.task_id = ${tasks.id} and b.status <> 'DONE')`,
      })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(and(...filters))
      .orderBy(asc(tasks.position), desc(tasks.createdAt))
      .limit(500);
    return rows.map((r) => ({
      ...r.task,
      projectName: r.project,
      clientName: r.client ? displayName(r.client) : null,
      subtasks: Number(r.subtasks),
      subtasksDone: Number(r.subtasksDone),
      blockers: Number(r.blockers),
    }));
  });
}

export async function getTask(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "tasks.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!task) throw new NotFoundError();
    const subtasks = await tx.select().from(tasks).where(eq(tasks.parentId, id)).orderBy(asc(tasks.createdAt));
    return { task, subtasks };
  });
}

// --- Projects ---------------------------------------------------------------------------------

export const projectInput = z.object({
  name: z.string().trim().min(1).max(200),
  clientId: optionalId,
  dueDate: optionalDate,
  status: z.enum(["ACTIVE", "DONE", "ARCHIVED"]).default("ACTIVE"),
  description: optionalText(5000),
  budgetCents: z.coerce.number().int().min(0).nullish().transform((v) => v ?? null),
});

export async function saveProject(ctx: Context, id: string | null, raw: z.input<typeof projectInput>): Promise<Project> {
  requirePermission(ctx.permissions, "tasks.manage");
  const input = projectInput.parse(raw);
  const { row, event } = await withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [before] = await tx.select({ status: projects.status }).from(projects).where(eq(projects.id, id));
      const [row] = await tx.update(projects).set(input).where(eq(projects.id, id)).returning();
      if (!row) throw new NotFoundError();
      return { row, event: row.status === "DONE" && before?.status !== "DONE" ? ("project.completed" as const) : null };
    }
    const [row] = await tx.insert(projects).values({ ...input, organizationId: ctx.organization.id }).returning();
    await audit(tx, ctx, "project.create", "project", row.id, { name: row.name });
    return { row, event: "project.created" as const };
  });
  if (event) await (await import("./automations")).fireAutomations(ctx, event, row.id);
  return row;
}

export async function listProjects(ctx: Context, includeClosed = false) {
  requirePermission(ctx.permissions, "tasks.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({
        project: projects,
        open: sql<number>`(select count(*)::int from tasks t where t.project_id = ${projects.id} and t.status <> 'DONE')`,
        done: sql<number>`(select count(*)::int from tasks t where t.project_id = ${projects.id} and t.status = 'DONE')`,
      })
      .from(projects)
      .where(includeClosed ? undefined : inArray(projects.status, ["ACTIVE"]))
      .orderBy(asc(projects.name));
    return rows.map((r) => ({ ...r.project, open: Number(r.open), done: Number(r.done) }));
  });
}
