/**
 * What reaches a person: a row in their inbox, and — unless they turned it
 * off, chose one message a day, or it is their quiet time — a message by
 * Telegram or e-mail. The same `dedupeKey` is kept once per person, so a job
 * running again never repeats itself.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memberships, notifications, organizations, telegramLinks, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isLocale, MESSAGES, translator } from "@/i18n";
import type { Context } from "./context";
import { mailAvailable, sendMail, takeMailBudget } from "./mail";
import { cleanPreferences, inQuietTime, preferencesOf, type NotificationCategory, type Preferences } from "./preferences";
import { appUrl } from "./settings";
import { escapeHtml, sendMessage } from "./telegram/api";
import { userPreferences } from "@/db/schema";

export type Note = {
  category: NotificationCategory;
  /** Text under hub.n.<kind>. */
  kind: string;
  vars?: Record<string, string | number>;
  href?: string | null;
  entity?: string | null;
  entityId?: string | null;
  priority?: 0 | 1 | 2;
  dedupeKey: string;
};

export type Notification = typeof notifications.$inferSelect;

/** Writes the note for each person who wants this kind; returns how many got it. */
export async function notify(organizationId: string, userIds: readonly string[], note: Note): Promise<number> {
  let written = 0;
  for (const userId of new Set(userIds)) {
    const prefs = await preferencesOf(organizationId, userId);
    if (prefs.notifications.muted.includes(note.category)) continue;
    const [row] = await withTenant(organizationId, (tx) =>
      tx
        .insert(notifications)
        .values({
          organizationId,
          userId,
          category: note.category,
          kind: note.kind,
          vars: note.vars ?? {},
          href: note.href ?? null,
          entity: note.entity ?? null,
          entityId: note.entityId ?? null,
          priority: note.priority ?? 1,
          dedupeKey: note.dedupeKey,
        })
        .onConflictDoNothing()
        .returning(),
    );
    if (!row) continue;
    written++;
    await deliver(organizationId, row, prefs).catch((e) => console.error("notify: delivery failed", e instanceof Error ? e.message : e));
  }
  return written;
}

/** Owners and admins of a company: who hears about what concerns the company as a whole. */
export async function companyLeads(organizationId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), inArray(memberships.role, ["OWNER", "ADMIN"])));
  return rows.map((r) => r.userId);
}

function localTime(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at).replace(/^24/, "00");
}

/** The text of a note in the person's language. */
export function noteText(note: Pick<Notification, "kind" | "vars">, locale: string): string {
  const t = translator(MESSAGES[isLocale(locale) ? locale : "de"]);
  return t(`hub.n.${note.kind}`, (note.vars ?? {}) as Record<string, string | number>);
}

/** Sends one note outside the app, if that is wanted now. Important notes only wait for quiet time. */
async function deliver(organizationId: string, note: Notification, prefs: Preferences, at = new Date()): Promise<boolean> {
  const p = prefs.notifications;
  if (!p.telegram && !p.email) return false;
  if (p.frequency === "daily" && note.priority < 2) return false;
  if (note.priority === 0) return false;
  const db = getDb();
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId));
  if (inQuietTime(localTime(org?.timezone ?? "Europe/Berlin", at), p.quietFrom, p.quietTo)) return false;
  const [person] = await db.select({ email: users.email, locale: users.locale, name: users.name }).from(users).where(eq(users.id, note.userId));
  if (!person) return false;
  const text = noteText(note, person.locale);
  const link = note.href && appUrl() ? `${appUrl()}${note.href}` : null;
  let sent = false;
  if (p.telegram) {
    const [chat] = await db
      .select({ chatId: telegramLinks.chatId })
      .from(telegramLinks)
      .where(and(eq(telegramLinks.userId, note.userId), eq(telegramLinks.notify, true)))
      .limit(1);
    if (chat) {
      await sendMessage(chat.chatId, link ? `${escapeHtml(text)}\n${escapeHtml(link)}` : escapeHtml(text));
      sent = true;
    }
  }
  if (p.email && mailAvailable() && takeMailBudget(organizationId)) {
    await sendMail({ to: person.email, subject: text.slice(0, 120), text: link ? `${text}\n\n${link}` : text });
    sent = true;
  }
  if (sent) await withTenant(organizationId, (tx) => tx.update(notifications).set({ deliveredAt: at }).where(eq(notifications.id, note.id)));
  return sent;
}

/** What quiet time held back goes out once it is over. Called by the scheduler. */
export async function deliverWaiting(at = new Date()): Promise<number> {
  const db = getDb();
  const waiting = await db
    .select({ organizationId: userPreferences.organizationId, userId: userPreferences.userId, data: userPreferences.data })
    .from(userPreferences);
  let sent = 0;
  for (const person of waiting) {
    const prefs = cleanPreferences(person.data);
    if (!prefs.notifications.quietFrom) continue;
    const since = new Date(at.getTime() - 24 * 3_600_000);
    const open = await withTenant(person.organizationId, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, person.userId),
            isNull(notifications.deliveredAt),
            isNull(notifications.readAt),
            isNull(notifications.dismissedAt),
            sql`${notifications.createdAt} > ${since}`,
          ),
        )
        .orderBy(asc(notifications.createdAt))
        .limit(10),
    );
    for (const note of open) if (await deliver(person.organizationId, note, prefs, at)) sent++;
  }
  return sent;
}

export async function markRead(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, (tx) =>
    tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, ctx.user.userId))),
  );
}

export async function markAllRead(ctx: Context): Promise<void> {
  await withTenant(ctx.organization.id, (tx) =>
    tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.user.userId), isNull(notifications.readAt))),
  );
}

export async function dismissNotification(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, (tx) =>
    tx.update(notifications).set({ dismissedAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, ctx.user.userId))),
  );
}

export async function openNotifications(ctx: Context, limit = 100): Promise<Notification[]> {
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.user.userId), isNull(notifications.dismissedAt)))
      .orderBy(desc(notifications.priority), desc(notifications.createdAt))
      .limit(limit),
  );
}
