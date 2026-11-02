/**
 * Creator Studio: content from the first idea to the published post.
 *
 * An item moves IDEA → DRAFT → REVIEW → SCHEDULED → PUBLISHED. Only people
 * with content.publish may mark it published (or send it to a connected
 * channel, src/server/social.ts) — nothing goes out on its own, and nothing
 * the generator writes is published without someone pressing the button.
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/tenant";
import { contentComments, contentItems, contentTemplates, documents, projects, socialAccounts } from "@/db/schema";
import { audit, type Via } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

import { CONTENT_STATUSES, CONTENT_TYPES, PLATFORMS, type ContentStatus, type Platform } from "@/lib/content";

export { CONTENT_STATUSES, CONTENT_TYPES, PLATFORMS };
export type { ContentStatus, ContentType, Platform } from "@/lib/content";
export type ContentItem = typeof contentItems.$inferSelect;

export class ContentError extends Error {
  constructor(public readonly code: "NEEDS_DATE" | "PUBLISH_FORBIDDEN") {
    super(code);
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const optionalId = z.string().uuid().nullish().transform((v) => v || null);

/** "#a, b #c" or ["a", "#b"] → ["#a", "#b", "#c"]: one leading #, no spaces, each once. */
export function cleanHashtags(value: string | readonly string[] | null | undefined): string[] {
  const parts = (typeof value === "string" ? value : (value ?? []).join(" ")).split(/[\s,;]+/);
  const out: string[] = [];
  for (const raw of parts) {
    const tag = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 60);
    if (tag && !out.some((t) => t.toLowerCase() === `#${tag}`.toLowerCase())) out.push(`#${tag}`);
  }
  return out.slice(0, 30);
}

export const contentInput = z.object({
  title: z.string().trim().min(1).max(300),
  body: optionalText(20000),
  description: optionalText(5000),
  platform: z.enum(PLATFORMS).default("OTHER"),
  contentType: z.enum(CONTENT_TYPES).default("POST"),
  status: z.enum(CONTENT_STATUSES).default("DRAFT"),
  category: optionalText(80),
  hashtags: z.union([z.string(), z.array(z.string())]).nullish().transform(cleanHashtags),
  mediaIds: z.array(z.string().uuid()).max(20).default([]),
  scheduledAt: z.coerce.date().nullish().transform((v) => v ?? null),
  assignedUserId: optionalId,
  projectId: optionalId,
});
export type ContentInput = z.input<typeof contentInput>;

async function checkLinks(tx: Tx, input: z.output<typeof contentInput>) {
  // Links must point into this company (RLS hides others, so "not found" is enough).
  if (input.projectId && !(await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId))).length) throw new NotFoundError();
  const media = [...new Set(input.mediaIds)];
  if (media.length) {
    const found = await tx.select({ id: documents.id }).from(documents).where(inArray(documents.id, media));
    if (found.length !== media.length) throw new NotFoundError();
  }
  return media;
}

function checkStatus(ctx: Context, input: z.output<typeof contentInput>, current?: ContentItem) {
  if (input.status === "SCHEDULED" && !input.scheduledAt) throw new ContentError("NEEDS_DATE");
  if (input.status === "PUBLISHED" && current?.status !== "PUBLISHED" && !ctx.permissions.has("content.publish")) throw new ContentError("PUBLISH_FORBIDDEN");
}

export async function createContent(ctx: Context, raw: ContentInput, via: Via = "web"): Promise<ContentItem> {
  requirePermission(ctx.permissions, "content.manage");
  const input = contentInput.parse(raw);
  checkStatus(ctx, input);
  return withTenant(ctx.organization.id, async (tx) => {
    const mediaIds = await checkLinks(tx, input);
    const [row] = await tx
      .insert(contentItems)
      .values({
        ...input,
        mediaIds,
        organizationId: ctx.organization.id,
        assignedUserId: input.assignedUserId ?? ctx.user.userId,
        createdBy: ctx.user.userId,
        publishedAt: input.status === "PUBLISHED" ? new Date() : null,
      })
      .returning();
    await audit(tx, ctx, "content.create", "content", row.id, { title: row.title, status: row.status }, via);
    return row;
  });
}

export async function updateContent(ctx: Context, id: string, raw: ContentInput, via: Via = "web"): Promise<ContentItem> {
  requirePermission(ctx.permissions, "content.manage");
  const input = contentInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [current] = await tx.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
    if (!current) throw new NotFoundError();
    checkStatus(ctx, input, current);
    const mediaIds = await checkLinks(tx, input);
    const [row] = await tx
      .update(contentItems)
      .set({
        ...input,
        mediaIds,
        publishedAt: input.status === "PUBLISHED" ? (current.publishedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, id))
      .returning();
    if (current.status !== row.status) await audit(tx, ctx, "content.status", "content", id, { from: current.status, to: row.status }, via);
    return row;
  });
}

/** Dropped on another day of the calendar: same time of day, new date. */
export async function rescheduleContent(ctx: Context, id: string, scheduledAt: Date): Promise<void> {
  requirePermission(ctx.permissions, "content.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(contentItems)
      .set({ scheduledAt, updatedAt: new Date() })
      .where(and(eq(contentItems.id, id), ne(contentItems.status, "PUBLISHED")))
      .returning({ id: contentItems.id });
    if (!row) throw new NotFoundError();
  });
}

export async function deleteContent(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "content.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(contentItems).where(eq(contentItems.id, id)).returning({ title: contentItems.title });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "content.delete", "content", id, { title: row.title });
  });
}

export type ContentQuery = { from?: Date; to?: Date; status?: ContentStatus; platform?: Platform; q?: string };

/**
 * Content for the calendar and the lists. With a range: items planned in it
 * (published ones by their publishing time), else everything, newest first.
 */
export async function listContent(ctx: Context, query: ContentQuery = {}) {
  requirePermission(ctx.permissions, "content.read");
  const when = sql`coalesce(${contentItems.publishedAt}, ${contentItems.scheduledAt})`;
  const filters: SQL[] = [];
  if (query.from) filters.push(sql`${when} >= ${query.from.toISOString()}`);
  if (query.to) filters.push(sql`${when} < ${query.to.toISOString()}`);
  if (query.status) filters.push(eq(contentItems.status, query.status));
  if (query.platform) filters.push(eq(contentItems.platform, query.platform));
  const q = query.q?.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
  if (q) filters.push(or(ilike(contentItems.title, `%${q}%`), ilike(contentItems.body, `%${q}%`), ilike(contentItems.category, `%${q}%`))!);
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(contentItems)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(query.from ? asc(when) : desc(contentItems.updatedAt))
      .limit(1000),
  );
}

export async function getContent(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "content.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [item] = await tx.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
    if (!item) throw new NotFoundError();
    const [comments, media] = await Promise.all([
      tx.select().from(contentComments).where(eq(contentComments.contentId, id)).orderBy(asc(contentComments.createdAt)),
      item.mediaIds.length
        ? tx.select({ id: documents.id, name: documents.name, mimeType: documents.mimeType }).from(documents).where(inArray(documents.id, item.mediaIds))
        : Promise.resolve([]),
    ]);
    const account = item.socialAccountId
      ? (await tx.select({ name: socialAccounts.name, provider: socialAccounts.provider }).from(socialAccounts).where(eq(socialAccounts.id, item.socialAccountId)))[0]
      : undefined;
    // Keep the order the media were attached in.
    const byId = new Map(media.map((m) => [m.id, m]));
    return { item, comments, media: item.mediaIds.map((m) => byId.get(m)).filter((m) => !!m), account: account ?? null };
  });
}

export async function addComment(ctx: Context, contentId: string, body: string): Promise<void> {
  requirePermission(ctx.permissions, "content.read");
  const text = z.string().trim().min(1).max(4000).parse(body);
  await withTenant(ctx.organization.id, async (tx) => {
    const [item] = await tx.select({ id: contentItems.id }).from(contentItems).where(eq(contentItems.id, contentId));
    if (!item) throw new NotFoundError();
    await tx.insert(contentComments).values({ organizationId: ctx.organization.id, contentId, userId: ctx.user.userId, body: text });
  });
}

/** Only one's own comment. */
export async function deleteComment(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "content.read");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .delete(contentComments)
      .where(and(eq(contentComments.id, id), eq(contentComments.userId, ctx.user.userId)))
      .returning({ id: contentComments.id });
    if (!row) throw new NotFoundError();
  });
}

/** What goes out on a channel: the text (or the title), then the hashtags. */
export function postText(item: Pick<ContentItem, "title" | "body" | "hashtags">): string {
  const main = item.body?.trim() || item.title.trim();
  const tags = item.hashtags.filter((t) => !main.includes(t)).join(" ");
  return [main, tags].filter(Boolean).join("\n\n");
}

// --- Templates ---------------------------------------------------------------------------------
export const templateInput = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.enum(PLATFORMS).default("OTHER"),
  contentType: z.enum(CONTENT_TYPES).default("POST"),
  body: z.string().trim().min(1).max(20000),
  hashtags: z.union([z.string(), z.array(z.string())]).nullish().transform(cleanHashtags),
});
export type TemplateInput = z.input<typeof templateInput>;

export async function listTemplates(ctx: Context) {
  requirePermission(ctx.permissions, "content.read");
  return withTenant(ctx.organization.id, (tx) => tx.select().from(contentTemplates).orderBy(asc(contentTemplates.name)).limit(500));
}

export async function saveTemplate(ctx: Context, id: string | null, raw: TemplateInput) {
  requirePermission(ctx.permissions, "content.manage");
  const input = templateInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [row] = await tx.update(contentTemplates).set(input).where(eq(contentTemplates.id, id)).returning();
      if (!row) throw new NotFoundError();
      return row;
    }
    const [row] = await tx
      .insert(contentTemplates)
      .values({ ...input, organizationId: ctx.organization.id, createdBy: ctx.user.userId })
      .returning();
    return row;
  });
}

export async function deleteTemplate(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "content.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(contentTemplates).where(eq(contentTemplates.id, id)).returning({ id: contentTemplates.id });
    if (!row) throw new NotFoundError();
  });
}

// --- Overview ------------------------------------------------------------------------------------
export type ContentOverview = {
  byStatus: Record<ContentStatus, number>;
  /** Scheduled within the next 7 days, soonest first. */
  upcoming: { id: string; title: string; platform: string; scheduledAt: string }[];
  /** Scheduled for a time that has passed, still not published. */
  overdue: number;
  publishedThisMonth: number;
};

export async function contentOverview(ctx: Context): Promise<ContentOverview> {
  requirePermission(ctx.permissions, "content.read");
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const tz = ctx.organization.timezone;
  return withTenant(ctx.organization.id, async (tx) => {
    const counts = await tx.select({ status: contentItems.status, n: count() }).from(contentItems).groupBy(contentItems.status);
    const upcoming = await tx
      .select({ id: contentItems.id, title: contentItems.title, platform: contentItems.platform, scheduledAt: contentItems.scheduledAt })
      .from(contentItems)
      .where(and(ne(contentItems.status, "PUBLISHED"), isNotNull(contentItems.scheduledAt), gte(contentItems.scheduledAt, now), lt(contentItems.scheduledAt, week)))
      .orderBy(asc(contentItems.scheduledAt))
      .limit(8);
    const [late] = await tx
      .select({ n: count() })
      .from(contentItems)
      .where(and(eq(contentItems.status, "SCHEDULED"), lt(contentItems.scheduledAt, now)));
    const [month] = await tx
      .select({ n: count() })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.status, "PUBLISHED"),
          sql`date_trunc('month', ${contentItems.publishedAt} at time zone ${tz}) = date_trunc('month', now() at time zone ${tz})`,
        ),
      );
    const byStatus = Object.fromEntries(CONTENT_STATUSES.map((s) => [s, 0])) as Record<ContentStatus, number>;
    for (const c of counts) byStatus[c.status] = Number(c.n);
    return {
      byStatus,
      upcoming: upcoming.map((u) => ({ ...u, scheduledAt: u.scheduledAt!.toISOString() })),
      overdue: Number(late?.n ?? 0),
      publishedThisMonth: Number(month?.n ?? 0),
    };
  });
}
