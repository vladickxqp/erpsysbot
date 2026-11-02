"use server";

import { revalidatePath } from "next/cache";
import { AssistantError, askAssistant, clearConversation } from "@/server/assistant/run";
import { ForbiddenError } from "@/server/permissions";
import { requireContext } from "@/server/request";

export type AskResult = { answer?: string; error?: AssistantError["code"] | "FORBIDDEN" };

export async function askAction(question: string): Promise<AskResult> {
  const ctx = await requireContext();
  try {
    const answer = await askAssistant(ctx, "web", question);
    // Created records show up on the other pages at once.
    revalidatePath("/app", "layout");
    return { answer };
  } catch (e) {
    if (e instanceof AssistantError) return { error: e.code };
    if (e instanceof ForbiddenError) return { error: "FORBIDDEN" };
    throw e;
  }
}

export async function clearAction(): Promise<void> {
  const ctx = await requireContext();
  await clearConversation(ctx, "web");
  revalidatePath("/app/assistant");
}
