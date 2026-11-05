/**
 * One person's settings in one company: favourites, quick actions, default
 * views, what reaches them and when, and their working time. Stored as one
 * document; whatever a row holds is read through the schema, so an old row
 * only ever lacks what was added since.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { userPreferences } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { NOTIFICATION_CATEGORIES } from "@/lib/preferences";
import type { Context } from "./context";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/preferences";

const preferencesSchema = z.object({
  /** Addresses inside the app, first the most wanted. */
  favorites: z.array(z.string().startsWith("/app").max(200)).max(20).default([]),
  /** Keys of the quick actions to show; empty: all that the person may use. */
  quickActions: z.array(z.string().max(40)).max(12).default([]),
  defaultViews: z
    .object({
      tasks: z.enum(["board", "list"]).optional(),
      calendar: z.enum(["day", "week", "month", "agenda"]).optional(),
    })
    .default({}),
  notifications: z
    .object({
      /** Categories that stay out of the inbox. */
      muted: z.array(z.enum(NOTIFICATION_CATEGORIES)).default([]),
      telegram: z.boolean().default(true),
      email: z.boolean().default(false),
      /** instant: as it happens; daily: one message each morning. */
      frequency: z.enum(["instant", "daily"]).default("instant"),
      /** No message outside the app between these times (company time zone). */
      quietFrom: time.nullable().default(null),
      quietTo: time.nullable().default(null),
    })
    .default({}),
  /** When this person works; without it the app makes no plan of their day. */
  workHours: z
    .object({ from: time, to: time, days: z.array(z.number().int().min(1).max(7)).min(1) })
    .nullable()
    .default(null),
  /** Suggestions to add a widget that were turned down. */
  dismissedWidgets: z.array(z.string().max(40)).max(40).default([]),
});

export type Preferences = z.output<typeof preferencesSchema>;
export type PreferencesPatch = Partial<z.input<typeof preferencesSchema>>;

export function cleanPreferences(raw: unknown): Preferences {
  const parsed = preferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : preferencesSchema.parse({});
}

export async function preferencesOf(organizationId: string, userId: string): Promise<Preferences> {
  const [row] = await withTenant(organizationId, (tx) =>
    tx
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(and(eq(userPreferences.organizationId, organizationId), eq(userPreferences.userId, userId))),
  );
  return cleanPreferences(row?.data);
}

export function myPreferences(ctx: Context): Promise<Preferences> {
  return preferencesOf(ctx.organization.id, ctx.user.userId);
}

/** Changes the named parts, leaves the rest. */
export async function savePreferences(ctx: Context, patch: PreferencesPatch): Promise<Preferences> {
  const current = await myPreferences(ctx);
  const next = preferencesSchema.parse({ ...current, ...patch });
  await withTenant(ctx.organization.id, (tx) =>
    tx
      .insert(userPreferences)
      .values({ organizationId: ctx.organization.id, userId: ctx.user.userId, data: next })
      .onConflictDoUpdate({ target: [userPreferences.organizationId, userPreferences.userId], set: { data: next, updatedAt: new Date() } }),
  );
  return next;
}

/** Whether a local time ("HH:MM") lies in a range that may run over midnight. */
export function inQuietTime(now: string, from: string | null, to: string | null): boolean {
  if (!from || !to || from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}
