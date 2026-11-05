"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { NotFoundError } from "@/server/clients";
import { dismissInsight } from "@/server/insights";
import { decide } from "@/server/inbox";
import { dismissNotification, markAllRead, markRead } from "@/server/notifications";
import { ForbiddenError } from "@/server/permissions";
import { savePreferences, type PreferencesPatch } from "@/server/preferences";
import { requireContext } from "@/server/request";
import { moveTask, TaskError } from "@/server/tasks";

export type InboxResult = { ok?: boolean; error?: string; vars?: Record<string, string> };

async function guarded(work: () => Promise<void>): Promise<InboxResult> {
  try {
    await work();
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    if (e instanceof TaskError) return { error: `hub.tasks.${e.code}`, vars: { names: e.blockers.join(", ") } };
    if (e instanceof Error && "code" in e) return { error: "common.error" };
    throw e;
  }
}

const noteId = (id: string) => id.replace(/^note:/, "");

export async function readAction(id: string): Promise<InboxResult> {
  const ctx = await requireContext();
  return guarded(() => markRead(ctx, noteId(id)));
}

export async function readAllAction(): Promise<InboxResult> {
  const ctx = await requireContext();
  return guarded(() => markAllRead(ctx));
}

export async function dismissAction(id: string, fingerprint?: string): Promise<InboxResult> {
  const ctx = await requireContext();
  return guarded(() => (id.startsWith("insight:") ? dismissInsight(ctx, id.slice("insight:".length), fingerprint ?? "") : dismissNotification(ctx, noteId(id))));
}

export async function completeAction(id: string): Promise<InboxResult> {
  const ctx = await requireContext();
  return guarded(() => moveTask(ctx, id.replace(/^task:/, ""), "DONE"));
}

export async function decideAction(id: string, approve: boolean): Promise<InboxResult> {
  const ctx = await requireContext();
  return guarded(() => decide(ctx, id, approve));
}

export async function savePreferencesAction(patch: PreferencesPatch): Promise<InboxResult> {
  const ctx = await requireContext();
  return guarded(async () => {
    await savePreferences(ctx, patch);
  });
}
