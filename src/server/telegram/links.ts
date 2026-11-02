/**
 * Linking a Telegram account to a user.
 *
 * The app hands out a one-time code (only its SHA-256 is stored, valid for
 * 15 minutes); the user opens t.me/<bot>?start=<code>, and the bot redeems it
 * for whoever sent it. One Telegram account per user and vice versa.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memberships, telegramLinks, telegramLinkTokens } from "@/db/schema";

const TOKEN_MINUTES = 15;

export type TelegramLink = typeof telegramLinks.$inferSelect;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createLinkToken(userId: string, organizationId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const db = getDb();
  await db.delete(telegramLinkTokens).where(lt(telegramLinkTokens.expiresAt, new Date()));
  await db.insert(telegramLinkTokens).values({
    tokenHash: hash(token),
    userId,
    organizationId,
    expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000),
  });
  return token;
}

export type LinkResult = { ok: true; link: TelegramLink } | { ok: false; reason: "invalid" | "taken" };

/** Redeems a code for this Telegram account. A code works once. */
export async function redeemLinkToken(
  token: string,
  telegram: { userId: string; chatId: string; username: string | null },
): Promise<LinkResult> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, reason: "invalid" };
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .delete(telegramLinkTokens)
      .where(and(eq(telegramLinkTokens.tokenHash, hash(token)), gt(telegramLinkTokens.expiresAt, new Date())))
      .returning();
    if (!row) return { ok: false, reason: "invalid" } as const;
    const [other] = await tx.select().from(telegramLinks).where(eq(telegramLinks.telegramUserId, telegram.userId));
    if (other && other.userId !== row.userId) return { ok: false, reason: "taken" } as const;
    await tx.delete(telegramLinks).where(eq(telegramLinks.userId, row.userId));
    const [link] = await tx
      .insert(telegramLinks)
      .values({
        userId: row.userId,
        telegramUserId: telegram.userId,
        chatId: telegram.chatId,
        username: telegram.username,
        organizationId: row.organizationId,
      })
      .returning();
    return { ok: true, link } as const;
  });
}

export async function linkOfUser(userId: string): Promise<TelegramLink | null> {
  const [link] = await getDb().select().from(telegramLinks).where(eq(telegramLinks.userId, userId));
  return link ?? null;
}

export async function linkOfTelegram(telegramUserId: string): Promise<TelegramLink | null> {
  const [link] = await getDb().select().from(telegramLinks).where(eq(telegramLinks.telegramUserId, telegramUserId));
  return link ?? null;
}

export async function unlink(userId: string): Promise<void> {
  await getDb().delete(telegramLinks).where(eq(telegramLinks.userId, userId));
}

/** Switches the bot's company — only to one the user belongs to. */
export async function setLinkCompany(userId: string, organizationId: string): Promise<boolean> {
  const db = getDb();
  const [member] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
  if (!member) return false;
  await db.update(telegramLinks).set({ organizationId }).where(eq(telegramLinks.userId, userId));
  return true;
}

export async function setNotify(userId: string, notify: boolean): Promise<void> {
  await getDb().update(telegramLinks).set({ notify }).where(eq(telegramLinks.userId, userId));
}
