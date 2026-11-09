"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";
import { chooseWorkspace, createWorkspace, WorkspaceError } from "@/server/workspace";
import { applyBusinessProfile, type ProfileInput } from "@/server/business-profile";

export async function chooseWorkspaceAction(type: string): Promise<{ error?: string } | void> {
  const ctx = await requireContext();
  try {
    await chooseWorkspace(ctx, type);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof ZodError) return { error: "common.error" };
    throw e;
  }
  revalidatePath("/app", "layout");
  redirect("/app");
}

/** The reviewed proposal of the welcome screen, applied as confirmed. */
export async function applyProfileAction(input: ProfileInput): Promise<{ error?: string } | void> {
  const ctx = await requireContext();
  try {
    await applyBusinessProfile(ctx, input);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function createWorkspaceAction(name: string): Promise<{ error?: string } | void> {
  const ctx = await requireContext();
  try {
    await createWorkspace(ctx, name);
  } catch (e) {
    if (e instanceof WorkspaceError) return { error: e.code === "TOO_MANY" ? "workspace.TOO_MANY" : "common.forbidden" };
    if (e instanceof ZodError) return { error: "auth.check" };
    throw e;
  }
  revalidatePath("/app", "layout");
  redirect("/app/welcome");
}
