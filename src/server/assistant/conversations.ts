/**
 * Conversations and memory of one person with the assistant. Everything here
 * belongs to that person: it is read and changed only with their own id, and
 * the memory is theirs to see, change and delete.
 */
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { assistantActions, assistantConversations, assistantMemories, assistantMessages } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { NotFoundError } from "../clients";
import type { Context } from "../context";

export type Conversation = typeof assistantConversations.$inferSelect;
export type AssistantContext = { type: string; id: string } | null;

const CONTEXT_TYPES = ["client", "project", "task", "invoice", "document", "content"] as const;
const MAX_MEMORIES = 50;

/** "project:<uuid>" from a link; anything else is no context at all. */
export function readContext(raw: string | null | undefined): AssistantContext {
  const match = /^([a-z]+):([0-9a-f-]{36})$/i.exec(raw ?? "");
  return match && (CONTEXT_TYPES as readonly string[]).includes(match[1]) ? { type: match[1], id: match[2] } : null;
}

export async function startConversation(ctx: Context, title: string, context: AssistantContext): Promise<Conversation> {
  const [row] = await withTenant(ctx.organization.id, (tx) =>
    tx
      .insert(assistantConversations)
      .values({ organizationId: ctx.organization.id, userId: ctx.user.userId, title: title.trim().slice(0, 80) || "Chat", contextType: context?.type ?? null, contextId: context?.id ?? null })
      .returning(),
  );
  return row;
}

async function mine(ctx: Context, id: string): Promise<Conversation> {
  const [row] = await withTenant(ctx.organization.id, (tx) =>
    tx.select().from(assistantConversations).where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, ctx.user.userId))),
  );
  if (!row) throw new NotFoundError();
  return row;
}

export { mine as getConversation };

export async function listConversations(ctx: Context, query: { q?: string; archived?: boolean } = {}) {
  const q = query.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: assistantConversations.id, title: assistantConversations.title, updatedAt: assistantConversations.updatedAt, contextType: assistantConversations.contextType, archivedAt: assistantConversations.archivedAt })
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.userId, ctx.user.userId),
          query.archived ? isNotNull(assistantConversations.archivedAt) : isNull(assistantConversations.archivedAt),
          like
            ? or(
                ilike(assistantConversations.title, like),
                sql`exists (select 1 from assistant_messages m where m.conversation_id = ${assistantConversations.id} and m.content ilike ${like})`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(assistantConversations.updatedAt))
      .limit(100),
  );
}

export async function conversationMessages(ctx: Context, id: string) {
  await mine(ctx, id);
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: assistantMessages.id, role: assistantMessages.role, content: assistantMessages.content, tools: assistantMessages.tools, createdAt: assistantMessages.createdAt })
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, id))
      .orderBy(asc(assistantMessages.createdAt))
      .limit(400),
  );
}

export async function renameConversation(ctx: Context, id: string, title: string): Promise<void> {
  await mine(ctx, id);
  const clean = z.string().trim().min(1).max(80).parse(title);
  await withTenant(ctx.organization.id, (tx) => tx.update(assistantConversations).set({ title: clean }).where(eq(assistantConversations.id, id)));
}

export async function archiveConversation(ctx: Context, id: string, archived: boolean): Promise<void> {
  await mine(ctx, id);
  await withTenant(ctx.organization.id, (tx) => tx.update(assistantConversations).set({ archivedAt: archived ? new Date() : null }).where(eq(assistantConversations.id, id)));
}

export async function deleteConversation(ctx: Context, id: string): Promise<void> {
  await mine(ctx, id);
  await withTenant(ctx.organization.id, async (tx) => {
    await tx.delete(assistantMessages).where(eq(assistantMessages.conversationId, id));
    // What was only proposed goes too; the record of what happened stays.
    await tx.delete(assistantActions).where(and(eq(assistantActions.conversationId, id), eq(assistantActions.status, "PROPOSED")));
    await tx.delete(assistantConversations).where(eq(assistantConversations.id, id));
  });
}

// --- Memory -----------------------------------------------------------------------------------

const memoryText = z.string().trim().min(2).max(500);

export async function listMemories(ctx: Context) {
  return withTenant(ctx.organization.id, (tx) => tx.select().from(assistantMemories).where(eq(assistantMemories.userId, ctx.user.userId)).orderBy(asc(assistantMemories.createdAt)).limit(MAX_MEMORIES));
}

export async function saveMemory(ctx: Context, id: string | null, raw: string): Promise<void> {
  const content = memoryText.parse(raw);
  await withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [row] = await tx.update(assistantMemories).set({ content }).where(and(eq(assistantMemories.id, id), eq(assistantMemories.userId, ctx.user.userId))).returning({ id: assistantMemories.id });
      if (!row) throw new NotFoundError();
      return;
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assistantMemories).where(eq(assistantMemories.userId, ctx.user.userId));
    if (Number(n) >= MAX_MEMORIES) throw new NotFoundError();
    await tx.insert(assistantMemories).values({ organizationId: ctx.organization.id, userId: ctx.user.userId, content });
  });
}

export async function deleteMemory(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, (tx) => tx.delete(assistantMemories).where(and(eq(assistantMemories.id, id), eq(assistantMemories.userId, ctx.user.userId))));
}
