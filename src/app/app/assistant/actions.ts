"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { decideAction as decide, type AssistantAction } from "@/server/assistant/actions";
import { deleteAgent, runAgent, saveAgent } from "@/server/assistant/agents";
import { archiveConversation, deleteConversation, deleteMemory, readContext, renameConversation, saveMemory } from "@/server/assistant/conversations";
import { AssistantError, askAssistantDetailed, clearConversation } from "@/server/assistant/run";
import { draftProjectPlan, draftReminderText, summarizeClient, writeDaySummary, type PlanDraft } from "@/server/assistant/workflows";
import { NotFoundError } from "@/server/clients";
import { getT } from "@/i18n/server";
import { ForbiddenError } from "@/server/permissions";
import { createProjectPlan, type PlanInput } from "@/server/project-plan";
import { requireContext } from "@/server/request";
import { TaskError } from "@/server/tasks";

export type Proposal = { id: string; tool: string; input: Record<string, unknown>; status: string; result?: Record<string, unknown> | null; error?: string | null };
export type AskResult = { answer?: string; tools?: string[]; conversationId?: string | null; proposals?: Proposal[]; error?: AssistantError["code"] | "FORBIDDEN" };

const toProposal = (a: AssistantAction): Proposal => ({
  id: a.id,
  tool: a.tool,
  input: a.input as Record<string, unknown>,
  status: a.status,
  result: a.result as Record<string, unknown> | null,
  error: a.error,
});

export async function askAction(question: string, conversationId: string | null, context: string | null): Promise<AskResult> {
  const ctx = await requireContext();
  try {
    const result = await askAssistantDetailed(ctx, "web", question, undefined, { conversationId, context: readContext(context) });
    // Created records show up on the other pages at once.
    revalidatePath("/app", "layout");
    return { answer: result.answer, tools: result.tools, conversationId: result.conversationId, proposals: result.proposals.map(toProposal) };
  } catch (e) {
    if (e instanceof AssistantError) return { error: e.code };
    if (e instanceof ForbiddenError) return { error: "FORBIDDEN" };
    if (e instanceof NotFoundError) return { error: "FAILED" };
    throw e;
  }
}

type Result = { ok?: boolean; error?: string; text?: string; plan?: PlanDraft; id?: string; proposal?: Proposal };

async function guarded(work: () => Promise<Result | void>): Promise<Result> {
  try {
    const result = await work();
    revalidatePath("/app/assistant", "layout");
    return result ?? { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "common.forbidden" };
    if (e instanceof NotFoundError) return { error: "common.error" };
    if (e instanceof ZodError) return { error: "auth.check" };
    if (e instanceof TaskError) return { error: `hub.tasks.${e.code}` };
    if (e instanceof AssistantError) return { error: `assistant.${{ NOT_CONFIGURED: "notConfigured", LIMIT: "limit", BUSY: "busy", REFUSED: "refused", FAILED: "failed" }[e.code]}` };
    throw e;
  }
}

export async function decideProposalAction(id: string, approve: boolean): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => {
    const action = await decide(ctx, id, approve);
    revalidatePath("/app", "layout");
    return { ok: true, proposal: toProposal(action) };
  });
}

export async function renameConversationAction(id: string, title: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => renameConversation(ctx, id, title));
}

export async function archiveConversationAction(id: string, archived: boolean): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => archiveConversation(ctx, id, archived));
}

export async function deleteConversationAction(id: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => deleteConversation(ctx, id));
}

export async function clearAction(): Promise<void> {
  const ctx = await requireContext();
  await clearConversation(ctx, "telegram");
}

export async function saveMemoryAction(id: string | null, text: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => saveMemory(ctx, id, text));
}

export async function deleteMemoryAction(id: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => deleteMemory(ctx, id));
}

export async function saveAgentAction(id: string | null, input: { name: string; instructions: string; schedule: "DAILY" | "WEEKLY"; enabled: boolean }): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => saveAgent(ctx, id, input));
}

export async function deleteAgentAction(id: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(() => deleteAgent(ctx, id));
}

export async function runAgentAction(id: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, text: await runAgent(ctx, id) }));
}

export async function draftPlanAction(description: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, plan: await draftProjectPlan(ctx, description) }));
}

export async function createPlanAction(plan: PlanInput): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => {
    const { id } = await createProjectPlan(ctx, plan);
    revalidatePath("/app", "layout");
    return { ok: true, id };
  });
}

export async function clientSummaryAction(id: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, text: await summarizeClient(ctx, id) }));
}

export async function reminderTextAction(invoiceId: string): Promise<Result> {
  const ctx = await requireContext();
  return guarded(async () => ({ ok: true, text: await draftReminderText(ctx, invoiceId) }));
}

export async function daySummaryAction(): Promise<Result> {
  const ctx = await requireContext();
  const { t } = await getT();
  return guarded(async () => ({ ok: true, text: await writeDaySummary(ctx, (key, vars) => t(`hub.i.${key}.title`, vars)) }));
}
