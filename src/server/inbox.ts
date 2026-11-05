/**
 * One list of what asks for this person: what was assigned to them, where they
 * were named, what waits for their decision, what went wrong, what the
 * insights found. Each thing appears once, the important ones first, with only
 * the actions the person may really take.
 */
import { and, asc, eq, lte, ne } from "drizzle-orm";
import { contentItems, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { decideAction, pendingActions } from "./assistant/actions";
import { getContent, updateContent } from "./content";
import type { Context } from "./context";
import { NotFoundError } from "./clients";
import { myInsights, type Insight } from "./insights";
import { today } from "./money";
import { moduleOn } from "./modules";
import { openNotifications } from "./notifications";
import { requirePermission } from "./permissions";

export const INBOX_CATEGORIES = ["important", "assigned", "mention", "approval", "update", "insight"] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

export type InboxAction = "open" | "read" | "dismiss" | "complete" | "approve" | "reject";

export type InboxItem = {
  /** Which kind of source and its id, e.g. "note:…", "task:…", "content:…". */
  id: string;
  category: Exclude<InboxCategory, "important">;
  /** Text under hub.n.<kind>. */
  kind: string;
  vars: Record<string, string | number>;
  href: string | null;
  at: string;
  priority: 0 | 1 | 2;
  read: boolean;
  actions: InboxAction[];
  insight?: Insight;
};

type Decide = (ctx: Context, id: string, approve: boolean) => Promise<void>;
const deciders = new Map<string, Decide>();
const addDecider = (kind: string, decide: Decide) => deciders.set(kind, decide);

async function aiProposals(ctx: Context): Promise<InboxItem[]> {
  if (!ctx.permissions.has("ai.use")) return [];
  return (await pendingActions(ctx)).map((a) => ({
    id: `ai:${a.id}`,
    category: "approval",
    kind: "aiProposal",
    vars: { tool: a.tool },
    href: a.conversationId ? `/app/assistant?c=${a.conversationId}` : "/app/assistant",
    at: a.createdAt.toISOString(),
    priority: 1,
    read: false,
    actions: ["open", "approve", "reject"],
  }));
}

addDecider("ai", async (ctx, id, approve) => {
  await decideAction(ctx, id, approve);
});

async function dueTasks(ctx: Context): Promise<InboxItem[]> {
  if (!ctx.permissions.has("tasks.read") || !moduleOn(ctx, "tasks")) return [];
  const now = today(ctx.organization.timezone);
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.assignedUserId, ctx.user.userId), ne(tasks.status, "DONE"), lte(tasks.dueDate, now)))
      .orderBy(asc(tasks.dueDate))
      .limit(50),
  );
  return rows.map((t) => ({
    id: `task:${t.id}`,
    category: "assigned",
    kind: t.dueDate! < now ? "taskOverdue" : "taskToday",
    vars: { title: t.title },
    href: `/app/tasks/${t.id}`,
    at: t.updatedAt.toISOString(),
    priority: t.dueDate! < now || t.priority === "HIGH" ? 2 : 1,
    read: false,
    actions: ctx.permissions.has("tasks.manage") ? ["open", "complete"] : ["open"],
  }));
}

async function contentReviews(ctx: Context): Promise<InboxItem[]> {
  if (!ctx.permissions.has("content.publish") || !moduleOn(ctx, "content")) return [];
  const rows = await withTenant(ctx.organization.id, (tx) => tx.select().from(contentItems).where(eq(contentItems.status, "REVIEW")).limit(30));
  return rows.map((c) => ({
    id: `content:${c.id}`,
    category: "approval",
    kind: "contentReview",
    vars: { title: c.title },
    href: `/app/content/${c.id}`,
    at: c.updatedAt.toISOString(),
    priority: 1,
    read: false,
    // Approving means it goes out on its date, so without a date there is nothing to approve yet.
    actions: c.scheduledAt ? ["open", "approve", "reject"] : ["open", "reject"],
  }));
}

addDecider("content", async (ctx, id, approve) => {
  requirePermission(ctx.permissions, "content.publish");
  const { item: c } = await getContent(ctx, id);
  if (c.status !== "REVIEW") throw new NotFoundError();
  await updateContent(ctx, id, {
    title: c.title,
    body: c.body,
    description: c.description,
    platform: c.platform as never,
    contentType: c.contentType as never,
    status: approve ? (c.scheduledAt ? "SCHEDULED" : "DRAFT") : "DRAFT",
    category: c.category,
    hashtags: c.hashtags,
    mediaIds: c.mediaIds,
    scheduledAt: c.scheduledAt,
    assignedUserId: c.assignedUserId,
    projectId: c.projectId,
  });
});

export async function inbox(ctx: Context): Promise<InboxItem[]> {
  const notes = await openNotifications(ctx);
  const due = await dueTasks(ctx);
  const reviews = await contentReviews(ctx);
  const extra: InboxItem[] = await aiProposals(ctx);
  const insights = await myInsights(ctx);

  // A task already listed as due needs no second line for having been assigned.
  const listed = new Set(due.map((t) => t.id.slice("task:".length)));
  const items: InboxItem[] = [
    ...notes
      .filter((n) => !(n.entity === "task" && n.entityId && listed.has(n.entityId) && n.kind === "taskAssigned"))
      .map(
        (n): InboxItem => ({
          id: `note:${n.id}`,
          category: (n.category === "failure" ? "update" : n.category) as InboxItem["category"],
          kind: n.kind,
          vars: (n.vars ?? {}) as Record<string, string | number>,
          href: n.href,
          at: n.createdAt.toISOString(),
          priority: n.priority as InboxItem["priority"],
          read: !!n.readAt,
          actions: [...(n.href ? (["open"] as const) : []), ...(n.readAt ? [] : (["read"] as const)), "dismiss"],
        }),
      ),
    ...due,
    ...reviews,
    ...extra,
    ...insights.map(
      (i): InboxItem => ({
        id: `insight:${i.key}`,
        category: "insight",
        kind: `insight_${i.key}`,
        vars: i.vars,
        href: i.href,
        at: new Date().toISOString(),
        priority: i.importance,
        read: false,
        actions: ["open", "dismiss"],
        insight: i,
      }),
    ),
  ];
  return items.sort((a, b) => Number(a.read) - Number(b.read) || b.priority - a.priority || b.at.localeCompare(a.at));
}

/** How many unread things, for the bell. */
export function unreadCount(items: readonly InboxItem[]): number {
  return items.filter((i) => !i.read && i.priority > 0).length;
}

/** Approve or reject what waits for this person. */
export async function decide(ctx: Context, id: string, approve: boolean): Promise<void> {
  const [kind, recordId] = id.split(":");
  const handler = deciders.get(kind);
  if (!handler || !recordId) throw new NotFoundError();
  await handler(ctx, recordId, approve);
}

