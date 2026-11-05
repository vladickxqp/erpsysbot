/**
 * A project with its tasks and what they wait for, created in one go. Used by
 * the planning dialog and by the assistant once the person has confirmed.
 */
import { z } from "zod";
import type { Via } from "./audit";
import type { Context } from "./context";
import { requirePermission } from "./permissions";
import { addDependency, setProjectMember } from "./task-hub";
import { createTask, saveProject } from "./tasks";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const planInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  clientId: z.string().uuid().nullish(),
  dueDate: date.nullish(),
  team: z.array(z.string().uuid()).max(30).default([]),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(5000).nullish(),
        dueDate: date.nullish(),
        assignedUserId: z.string().uuid().nullish(),
        /** Positions in this list of the tasks to finish first. */
        dependsOn: z.array(z.number().int().min(0)).max(20).default([]),
      }),
    )
    .max(60)
    .default([]),
});
export type PlanInput = z.input<typeof planInput>;

/** Saves the plan and returns the project's id; the order of `tasks` decides what may wait for what. */
export async function createProjectPlan(ctx: Context, raw: PlanInput, via: Via = "web"): Promise<{ id: string; tasks: number }> {
  requirePermission(ctx.permissions, "tasks.manage");
  const plan = planInput.parse(raw);
  const project = await saveProject(ctx, null, { name: plan.name, description: plan.description ?? null, clientId: plan.clientId ?? null, dueDate: plan.dueDate ?? null });
  for (const userId of plan.team) await setProjectMember(ctx, project.id, userId, true);
  const ids: string[] = [];
  for (const task of plan.tasks) {
    const row = await createTask(ctx, { title: task.title, description: task.description, dueDate: task.dueDate, projectId: project.id, clientId: plan.clientId ?? null, assignedUserId: task.assignedUserId }, via);
    ids.push(row.id);
  }
  for (const [index, task] of plan.tasks.entries()) {
    // Only earlier tasks count: a plan cannot wait for itself.
    for (const first of task.dependsOn) if (first < index) await addDependency(ctx, ids[index], ids[first]);
  }
  return { id: project.id, tasks: ids.length };
}
