"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { createTask, deleteTask, getTask, moveTask, saveProject, updateTask, type TaskInput, type TaskStatus } from "@/server/tasks";

export type TaskResult = { ok?: boolean; id?: string; error?: string };

function failure(e: unknown): TaskResult {
  if (e instanceof ForbiddenError) return { error: "common.forbidden" };
  if (e instanceof NotFoundError) return { error: "common.error" };
  if (e instanceof ZodError) return { error: "auth.check" };
  throw e;
}

const refresh = () => {
  revalidatePath("/app/tasks");
  revalidatePath("/app");
};

export async function saveTaskAction(id: string | null, payload: TaskInput): Promise<TaskResult> {
  const ctx = await requireContext();
  try {
    const task = id ? await updateTask(ctx, id, payload) : await createTask(ctx, payload);
    refresh();
    return { ok: true, id: task.id };
  } catch (e) {
    return failure(e);
  }
}

export async function moveTaskAction(id: string, status: TaskStatus, beforeId: string | null): Promise<TaskResult> {
  const ctx = await requireContext();
  try {
    await moveTask(ctx, id, status, beforeId);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteTaskAction(id: string): Promise<TaskResult> {
  const ctx = await requireContext();
  try {
    await deleteTask(ctx, id);
    refresh();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function subtasksAction(id: string) {
  const ctx = await requireContext();
  const { subtasks } = await getTask(ctx, id);
  return subtasks.map((s) => ({ id: s.id, title: s.title, done: s.status === "DONE" }));
}

export async function saveProjectAction(id: string | null, name: string, clientId: string | null): Promise<TaskResult> {
  const ctx = await requireContext();
  try {
    const project = await saveProject(ctx, id, { name, clientId });
    refresh();
    return { ok: true, id: project.id };
  } catch (e) {
    return failure(e);
  }
}
