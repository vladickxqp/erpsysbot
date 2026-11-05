"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { CalendarError } from "@/server/calendar";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { addComment, addDependency, deleteComment, orderPlan, planTask, removeDependency, scheduleTask, setProjectMember } from "@/server/task-hub";
import { createTask, getTask, listProjects, saveProject, TaskError, updateTask, type TaskInput } from "@/server/tasks";
import { memberOptions } from "@/server/team";

export type HubResult = { ok?: boolean; id?: string; error?: string; vars?: Record<string, string> };

async function guarded(work: () => Promise<HubResult | void>): Promise<HubResult> {
  try {
    const result = await work();
    revalidatePath("/app", "layout");
    return result ?? { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    if (e instanceof TaskError) return { error: `hub.tasks.${e.code}`, vars: { names: e.blockers.join(", ") } };
    if (e instanceof CalendarError) return { error: e.code === "OVERLAP" ? "calendar.OVERLAP" : "auth.check" };
    throw e;
  }
}

/** What the small task form offers: only filled when it opens. */
export async function quickTaskOptions() {
  const ctx = await requireContext();
  const [projects, members] = await Promise.all([ctx.permissions.has("tasks.read") ? listProjects(ctx) : Promise.resolve([]), memberOptions(ctx)]);
  return { projects: projects.map((p) => ({ id: p.id, name: p.name })), members, me: ctx.user.userId };
}

export async function quickTaskAction(payload: TaskInput): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, id: (await createTask(ctx, payload)).id }));
}

export async function changeTaskAction(id: string, patch: Partial<TaskInput>): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    const { task } = await getTask(ctx, id);
    const current: TaskInput = {
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      projectId: task.projectId,
      parentId: task.parentId,
      clientId: task.clientId,
      orderId: task.orderId,
      assignedUserId: task.assignedUserId,
      estimateMinutes: task.estimateMinutes,
    };
    await updateTask(ctx, id, { ...current, ...patch });
  });
}

export async function addDependencyAction(taskId: string, dependsOnId: string): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => addDependency(ctx, taskId, dependsOnId));
}

export async function removeDependencyAction(taskId: string, dependsOnId: string): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => removeDependency(ctx, taskId, dependsOnId));
}

export async function addCommentAction(taskId: string, body: string): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => addComment(ctx, taskId, body));
}

export async function deleteCommentAction(id: string): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => deleteComment(ctx, id));
}

export async function scheduleTaskAction(id: string, date: string, start: string, minutes: number): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => scheduleTask(ctx, id, { date, start, minutes }));
}

export async function planTaskAction(id: string, day: string | null): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => planTask(ctx, id, day));
}

export async function orderPlanAction(ids: string[]): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => orderPlan(ctx, ids));
}

export async function setProjectMemberAction(projectId: string, userId: string, member: boolean): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(() => setProjectMember(ctx, projectId, userId, member));
}

export async function saveProjectDetailsAction(id: string, details: { name: string; clientId: string | null; dueDate: string | null; status: "ACTIVE" | "DONE" | "ARCHIVED"; description: string | null; budgetCents: number | null }): Promise<HubResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await saveProject(ctx, id, details);
  });
}
