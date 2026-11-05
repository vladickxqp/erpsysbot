/**
 * Team chat: channels for everyone in the company and direct conversations
 * between two people. A direct conversation is readable by those two and by
 * nobody else, whatever their role. Naming someone with @ reaches their inbox.
 */
import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { chatChannels, chatMembers, chatMessages } from "@/db/schema";
import { withTenant, type Tx } from "@/db/tenant";
import { mentionedUsers } from "@/lib/smart-task";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { assertModule } from "./modules";
import { notify } from "./notifications";
import { memberOptions } from "./team";

export type Channel = typeof chatChannels.$inferSelect;

const GENERAL = "general";
const MAX_CHANNELS = 200;
const channelName = z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} _-]+$/u);
const messageBody = z.string().trim().min(1).max(4000);

const directKey = (a: string, b: string) => [a, b].sort().join(":");

async function channelFor(tx: Tx, ctx: Context, id: string): Promise<Channel> {
  const [row] = await tx.select().from(chatChannels).where(eq(chatChannels.id, id));
  if (!row || (row.kind === "DIRECT" && !row.directKey?.split(":").includes(ctx.user.userId))) throw new NotFoundError();
  return row;
}

/** The channels this person sees, with what is new for them. */
export async function listChannels(ctx: Context) {
  assertModule(ctx, "chat");
  const me = ctx.user.userId;
  const rows = await withTenant(ctx.organization.id, async (tx) => {
    await tx.insert(chatChannels).values({ organizationId: ctx.organization.id, name: GENERAL, kind: "CHANNEL" }).onConflictDoNothing();
    const list = await tx
      .select({
        channel: chatChannels,
        unread: sql<number>`(select count(*)::int from chat_messages m where m.channel_id = ${chatChannels.id} and m.user_id is distinct from ${me} and m.created_at > coalesce(${chatMembers.lastReadAt}, 'epoch'))`,
      })
      .from(chatChannels)
      .leftJoin(chatMembers, and(eq(chatMembers.channelId, chatChannels.id), eq(chatMembers.userId, me)))
      .where(or(eq(chatChannels.kind, "CHANNEL"), sql`${chatChannels.directKey} like ${`%${me}%`}`))
      .orderBy(asc(chatChannels.kind), asc(chatChannels.name))
      .limit(MAX_CHANNELS + 100);
    return list;
  });
  const names = new Map((await memberOptions(ctx)).map((m) => [m.id, m.name]));
  return rows.map(({ channel, unread }) => {
    const other = channel.directKey?.split(":").find((id) => id !== me);
    return { id: channel.id, kind: channel.kind, name: channel.kind === "DIRECT" ? (names.get(other ?? "") ?? "—") : (channel.name ?? "—"), unread: Number(unread) };
  });
}

export async function createChannel(ctx: Context, raw: string): Promise<string> {
  assertModule(ctx, "chat");
  const name = channelName.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(chatChannels).where(eq(chatChannels.kind, "CHANNEL"));
    if (Number(n) >= MAX_CHANNELS) throw new NotFoundError();
    const [created] = await tx.insert(chatChannels).values({ organizationId: ctx.organization.id, name, kind: "CHANNEL", createdBy: ctx.user.userId }).onConflictDoNothing().returning({ id: chatChannels.id });
    if (created) return created.id;
    const [existing] = await tx.select({ id: chatChannels.id }).from(chatChannels).where(eq(chatChannels.name, name));
    return existing.id;
  });
}

/** The conversation with one colleague; opened once, found again after that. */
export async function openDirect(ctx: Context, userId: string): Promise<string> {
  assertModule(ctx, "chat");
  if (userId === ctx.user.userId || !(await memberOptions(ctx)).some((m) => m.id === userId)) throw new NotFoundError();
  const key = directKey(ctx.user.userId, userId);
  return withTenant(ctx.organization.id, async (tx) => {
    const [created] = await tx.insert(chatChannels).values({ organizationId: ctx.organization.id, kind: "DIRECT", directKey: key, createdBy: ctx.user.userId }).onConflictDoNothing().returning({ id: chatChannels.id });
    if (created) return created.id;
    const [existing] = await tx.select({ id: chatChannels.id }).from(chatChannels).where(eq(chatChannels.directKey, key));
    return existing.id;
  });
}

/** Messages of a channel, oldest first; with `after` only what is newer. Reading marks them as read. */
export async function readMessages(ctx: Context, channelId: string, after?: Date) {
  assertModule(ctx, "chat");
  const rows = await withTenant(ctx.organization.id, async (tx) => {
    await channelFor(tx, ctx, channelId);
    const list = await tx
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.channelId, channelId), after ? gt(chatMessages.createdAt, after) : undefined))
      .orderBy(desc(chatMessages.createdAt))
      .limit(200);
    await tx
      .insert(chatMembers)
      .values({ organizationId: ctx.organization.id, channelId, userId: ctx.user.userId, lastReadAt: new Date() })
      .onConflictDoUpdate({ target: [chatMembers.channelId, chatMembers.userId], set: { lastReadAt: new Date() } });
    return list.reverse();
  });
  const names = new Map((await memberOptions(ctx)).map((m) => [m.id, m.name]));
  return rows.map((m) => ({ id: m.id, userId: m.userId, who: names.get(m.userId ?? "") ?? "—", body: m.body, at: m.createdAt.toISOString() }));
}

export async function sendMessage(ctx: Context, channelId: string, raw: string): Promise<void> {
  assertModule(ctx, "chat");
  const body = messageBody.parse(raw);
  const { channel, row } = await withTenant(ctx.organization.id, async (tx) => {
    const channel = await channelFor(tx, ctx, channelId);
    const [row] = await tx.insert(chatMessages).values({ organizationId: ctx.organization.id, channelId, userId: ctx.user.userId, body }).returning();
    return { channel, row };
  });
  const people = await memberOptions(ctx);
  const named = channel.kind === "DIRECT" ? (channel.directKey ?? "").split(":") : mentionedUsers(body, people);
  await notify(ctx.organization.id, named.filter((id) => id !== ctx.user.userId), {
    category: "mention",
    kind: channel.kind === "DIRECT" ? "chatDirect" : "chatMention",
    vars: { who: ctx.user.name, channel: channel.name ?? "" },
    href: `/app/chat?c=${channelId}`,
    entity: "chat",
    entityId: channelId,
    dedupeKey: `chat:${channelId}:${ctx.user.userId}:${Math.floor(row.createdAt.getTime() / 60_000)}`,
  });
}
