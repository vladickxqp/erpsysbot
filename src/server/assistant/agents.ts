/**
 * Standing instructions: "every Monday, look at open quotes and tell me which
 * need a call". An agent runs on its schedule with the rights of the person who
 * set it up, may only read, and reports to their inbox. Anything it would like
 * to change stays a suggestion in its report.
 */
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { aiAgents, memberships, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { NotFoundError } from "../clients";
import { contextFor, type Context } from "../context";
import { notify } from "../notifications";
import { isSuspended } from "../platform";
import { requirePermission } from "../permissions";
import { AssistantError, askAssistantDetailed, assistantAvailable, assistantCreate, type CreateMessage } from "./run";

export type Agent = typeof aiAgents.$inferSelect;

const MAX_AGENTS = 10;
const DAY = 86_400_000;
export const AGENT_SCHEDULES = ["DAILY", "WEEKLY"] as const;

const agentInput = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(10).max(2000),
  schedule: z.enum(AGENT_SCHEDULES),
  enabled: z.boolean().default(true),
});

export async function listAgents(ctx: Context): Promise<Agent[]> {
  requirePermission(ctx.permissions, "ai.use");
  return withTenant(ctx.organization.id, (tx) => tx.select().from(aiAgents).where(eq(aiAgents.userId, ctx.user.userId)).orderBy(asc(aiAgents.createdAt)));
}

export async function saveAgent(ctx: Context, id: string | null, raw: z.input<typeof agentInput>): Promise<void> {
  requirePermission(ctx.permissions, "ai.use");
  const input = agentInput.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [row] = await tx.update(aiAgents).set(input).where(and(eq(aiAgents.id, id), eq(aiAgents.userId, ctx.user.userId))).returning({ id: aiAgents.id });
      if (!row) throw new NotFoundError();
      return;
    }
    const mine = await tx.select({ id: aiAgents.id }).from(aiAgents).where(eq(aiAgents.userId, ctx.user.userId));
    if (mine.length >= MAX_AGENTS) throw new NotFoundError();
    await tx.insert(aiAgents).values({ ...input, organizationId: ctx.organization.id, userId: ctx.user.userId });
  });
}

export async function deleteAgent(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, (tx) => tx.delete(aiAgents).where(and(eq(aiAgents.id, id), eq(aiAgents.userId, ctx.user.userId))));
}

/** One run: the answer goes to the agent and into its owner's inbox. */
export async function runAgent(ctx: Context, id: string, create: CreateMessage = assistantCreate): Promise<string> {
  requirePermission(ctx.permissions, "ai.use");
  const [agent] = await withTenant(ctx.organization.id, (tx) => tx.select().from(aiAgents).where(and(eq(aiAgents.id, id), eq(aiAgents.userId, ctx.user.userId))));
  if (!agent) throw new NotFoundError();
  // Noted before it runs: a run that fails waits for its next turn, it does not repeat every few minutes.
  const at = new Date();
  await withTenant(ctx.organization.id, (tx) => tx.update(aiAgents).set({ lastRunAt: at }).where(eq(aiAgents.id, id)));
  const { answer } = await askAssistantDetailed(ctx, "web", agent.instructions, create, { readOnly: true });
  await withTenant(ctx.organization.id, (tx) => tx.update(aiAgents).set({ lastResult: answer.slice(0, 8000) }).where(eq(aiAgents.id, id)));
  await notify(ctx.organization.id, [ctx.user.userId], {
    category: "update",
    kind: "agentResult",
    vars: { name: agent.name },
    href: "/app/assistant/settings",
    dedupeKey: `agent:${id}:${at.toISOString().slice(0, 13)}`,
  });
  return answer;
}

/** Called by the scheduler: every agent whose time has come, with its owner's current rights. */
export async function runDueAgents(at = new Date()): Promise<number> {
  if (!assistantAvailable()) return 0;
  const due = (schedule: "DAILY" | "WEEKLY") => new Date(at.getTime() - (schedule === "DAILY" ? DAY : 7 * DAY) + 3_600_000);
  const rows = await getDb()
    .select({ agent: aiAgents, user: users })
    .from(aiAgents)
    .innerJoin(users, eq(users.id, aiAgents.userId))
    .innerJoin(memberships, and(eq(memberships.userId, aiAgents.userId), eq(memberships.organizationId, aiAgents.organizationId)))
    .where(
      and(
        eq(aiAgents.enabled, true),
        or(isNull(aiAgents.lastRunAt), and(eq(aiAgents.schedule, "DAILY"), lt(aiAgents.lastRunAt, due("DAILY"))), and(eq(aiAgents.schedule, "WEEKLY"), lt(aiAgents.lastRunAt, due("WEEKLY")))),
      ),
    )
    .limit(50);
  let ran = 0;
  for (const { agent, user } of rows) {
    const ctx = await contextFor({ sessionId: "agent", userId: user.id, email: user.email, name: user.name, locale: user.locale, isPlatformAdmin: false, activeOrganizationId: agent.organizationId });
    if (!ctx || ctx.organization.id !== agent.organizationId || !ctx.permissions.has("ai.use") || (await isSuspended(agent.organizationId))) continue;
    try {
      await runAgent(ctx, agent.id);
      ran++;
    } catch (e) {
      // Over the day's limit or the provider is away: the next round tries again.
      if (!(e instanceof AssistantError)) throw e;
    }
  }
  return ran;
}
