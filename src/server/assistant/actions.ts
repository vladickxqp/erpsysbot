/**
 * What the assistant does is on record. Reading and small things run at once;
 * anything that creates business records, sends something or saves a file is
 * only prepared and waits for the person: the row holds what would happen, and
 * nothing happens until they confirm. "Done" is only ever written after the
 * server function really succeeded.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { assistantActions, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { Via } from "../audit";
import { NotFoundError } from "../clients";
import type { Context } from "../context";
import { requirePermission } from "../permissions";
import { blocksOf, parseToolInput, riskOf, runTool, toolNeeds } from "./tools";

export type AssistantAction = typeof assistantActions.$inferSelect;
export type ToolOutcome = { content: string; isError: boolean; blocks?: unknown[]; proposed?: AssistantAction };

const trimResult = (content: string): unknown => {
  try {
    return JSON.parse(content.slice(0, 20_000));
  } catch {
    return { text: content.slice(0, 2000) };
  }
};

/** Runs or prepares one tool call of a conversation. */
export async function callTool(ctx: Context, name: string, raw: unknown, via: Via, options: { conversationId?: string | null; readOnly?: boolean } = {}): Promise<ToolOutcome> {
  const risk = riskOf(name);
  const org = ctx.organization.id;
  if (options.readOnly && risk !== "read") return { content: "This run may only read.", isError: true };
  if (risk === "confirm") {
    const input = parseToolInput(name, raw);
    if (!input.ok) return { content: input.error, isError: true };
    const needs = toolNeeds(name);
    if (needs && !ctx.permissions.has(needs)) return { content: "This user is not allowed to do that.", isError: true };
    const [row] = await withTenant(org, (tx) =>
      tx.insert(assistantActions).values({ organizationId: org, userId: ctx.user.userId, conversationId: options.conversationId ?? null, tool: name, input: input.data as object, risk, status: "PROPOSED" }).returning(),
    );
    return {
      content: JSON.stringify({ status: "waiting_for_confirmation", note: "Nothing has happened yet. The user sees this proposal and confirms or rejects it in the app. Say briefly what you prepared and do not claim it is done." }),
      isError: false,
      proposed: row,
    };
  }
  const result = await runTool(ctx, name, raw, via);
  const blocks = blocksOf(result.content);
  await withTenant(org, (tx) =>
    tx.insert(assistantActions).values({
      organizationId: org,
      userId: ctx.user.userId,
      conversationId: options.conversationId ?? null,
      tool: name,
      input: (raw ?? {}) as object,
      risk,
      status: result.isError ? "FAILED" : "DONE",
      result: risk === "low" && !result.isError ? (trimResult(result.content) as object) : null,
      error: result.isError ? result.content.slice(0, 500) : null,
    }),
  );
  return blocks ? { content: "", isError: false, blocks } : result;
}

/** The person's yes or no. Runs through the same server functions as the app, with their own rights. */
export async function decideAction(ctx: Context, id: string, approve: boolean): Promise<AssistantAction> {
  requirePermission(ctx.permissions, "ai.use");
  const org = ctx.organization.id;
  // Claimed first: a double click or a second tab cannot run it twice.
  const [claimed] = await withTenant(org, (tx) =>
    tx
      .update(assistantActions)
      .set({ status: approve ? "RUNNING" : "REJECTED", decidedAt: new Date() })
      .where(and(eq(assistantActions.id, id), eq(assistantActions.userId, ctx.user.userId), eq(assistantActions.status, "PROPOSED")))
      .returning(),
  );
  if (!claimed) throw new NotFoundError();
  if (!approve) return claimed;
  const result = await runTool(ctx, claimed.tool, claimed.input, "ai");
  const [row] = await withTenant(org, (tx) =>
    tx
      .update(assistantActions)
      .set({ status: result.isError ? "FAILED" : "DONE", result: result.isError ? null : (trimResult(result.content) as object), error: result.isError ? result.content.slice(0, 500) : null })
      .where(eq(assistantActions.id, id))
      .returning(),
  );
  return row;
}

export async function pendingActions(ctx: Context, conversationId?: string): Promise<AssistantAction[]> {
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(assistantActions)
      .where(and(eq(assistantActions.userId, ctx.user.userId), eq(assistantActions.status, "PROPOSED"), conversationId ? eq(assistantActions.conversationId, conversationId) : undefined))
      .orderBy(desc(assistantActions.createdAt))
      .limit(30),
  );
}

/** What the assistant did: one's own, or with ai.admin everyone's in the company. */
export async function actionHistory(ctx: Context, options: { everyone?: boolean; includeReads?: boolean; limit?: number } = {}) {
  requirePermission(ctx.permissions, options.everyone ? "ai.admin" : "ai.use");
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(assistantActions)
      .where(and(options.everyone ? undefined : eq(assistantActions.userId, ctx.user.userId), options.includeReads ? undefined : inArray(assistantActions.risk, ["low", "confirm"])))
      .orderBy(desc(assistantActions.createdAt))
      .limit(options.limit ?? 100),
  );
  const ids = [...new Set(rows.map((r) => r.userId))];
  const names = ids.length ? await getDb().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  return rows.map((r) => ({ ...r, who: names.find((n) => n.id === r.userId)?.name ?? null }));
}
