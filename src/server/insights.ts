/**
 * What deserves attention, worked out from the company's own records. Each
 * insight names the records behind it and says why it is shown; nothing is
 * estimated. A person may put one aside: it stays away until the records
 * behind it change or the time is over, so nothing nags.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { clients, contentItems, deals, insightDismissals, projects, quotes, tasks, transactions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { displayName } from "./clients";
import type { Context } from "./context";
import { addDays, today } from "./money";
import { moduleOn } from "./modules";
import { overdueInvoices } from "./reminders";
import { myPreferences } from "./preferences";
import type { AppModule } from "@/lib/modules";
import type { Permission } from "./permissions";

export type InsightItem = { label: string; hint?: string; amountCents?: number; date?: string | null; href: string };
export type Insight = {
  key: string;
  vars: Record<string, string | number>;
  /** 2 act now, 1 worth a look, 0 when there is time. */
  importance: 0 | 1 | 2;
  items: InsightItem[];
  /** Where the suggested next step happens. */
  href: string;
  fingerprint: string;
};

/** How long "not now" lasts. */
const SNOOZE_DAYS = 7;
const MAX_ITEMS = 6;
const STALE_DAYS = 7;
const BLOCKED_DAYS = 3;
const FOLLOW_UP_DAYS = 14;
const QUOTE_DAYS = 10;
const PROJECT_WARNING_DAYS = 7;
const CONTENT_WARNING_DAYS = 3;
const REPEAT_COUNT = 3;

const fingerprint = (ids: readonly string[]) => [...ids].sort().join(",").slice(0, 400);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

const open = (ctx: Context, permission: Permission, module?: AppModule) => ctx.permissions.has(permission) && (!module || moduleOn(ctx, module));

/** Every insight this person may see, without looking at what they put aside. */
export async function computeInsights(ctx: Context): Promise<Insight[]> {
  const now = today(ctx.organization.timezone);
  const found: Insight[] = [];
  const add = (key: string, importance: Insight["importance"], ids: string[], items: InsightItem[], href: string, vars: Insight["vars"] = {}) => {
    if (ids.length) found.push({ key, importance, items: items.slice(0, MAX_ITEMS), href, vars: { count: ids.length, ...vars }, fingerprint: fingerprint(ids) });
  };

  if (open(ctx, "invoices.read", "invoices")) {
    const overdue = await overdueInvoices(ctx);
    add(
      "overdueInvoices",
      2,
      overdue.map((o) => o.id),
      overdue.map((o) => ({ label: o.number ?? "—", hint: o.clientName, amountCents: o.openCents, date: o.dueDate, href: `/app/invoices/${o.id}` })),
      "/app/invoices?filter=OVERDUE",
    );
  }

  if (open(ctx, "tasks.read", "tasks")) {
    const mine = ctx.user.userId;
    const { deadlines, blocked, stale, vague, repeated } = await withTenant(ctx.organization.id, async (tx) => ({
      deadlines: await tx
        .select({ id: projects.id, name: projects.name, dueDate: projects.dueDate, openTasks: sql<number>`(select count(*)::int from tasks t where t.project_id = projects.id and t.status <> 'DONE')` })
        .from(projects)
        .where(and(eq(projects.status, "ACTIVE"), isNotNull(projects.dueDate), lte(projects.dueDate, addDays(now, PROJECT_WARNING_DAYS))))
        .orderBy(asc(projects.dueDate))
        .limit(20),
      blocked: await tx
        .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
        .from(tasks)
        .where(
          and(
            eq(tasks.assignedUserId, mine),
            ne(tasks.status, "DONE"),
            lt(tasks.updatedAt, daysAgo(BLOCKED_DAYS)),
            sql`exists (select 1 from task_dependencies d join tasks b on b.id = d.depends_on_id where d.task_id = ${tasks.id} and b.status <> 'DONE')`,
          ),
        )
        .limit(20),
      stale: await tx
        .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
        .from(tasks)
        .where(and(eq(tasks.assignedUserId, mine), inArray(tasks.status, ["IN_PROGRESS", "REVIEW"]), lt(tasks.updatedAt, daysAgo(STALE_DAYS))))
        .limit(20),
      vague: await tx
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(
          and(
            eq(projects.status, "ACTIVE"),
            isNull(projects.dueDate),
            sql`exists (select 1 from tasks t where t.project_id = ${projects.id} and t.status <> 'DONE')`,
            sql`not exists (select 1 from tasks t where t.project_id = ${projects.id} and t.status <> 'DONE' and t.due_date is not null)`,
          ),
        )
        .limit(20),
      repeated: await tx
        .select({ title: tasks.title, n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(gte(tasks.createdAt, daysAgo(60)))
        .groupBy(tasks.title)
        .having(sql`count(*) >= ${REPEAT_COUNT}`)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
    }));
    const pressing = deadlines.filter((p) => Number(p.openTasks) > 0);
    add(
      "projectDeadline",
      pressing.some((p) => p.dueDate! <= addDays(now, 2)) ? 2 : 1,
      pressing.map((p) => p.id),
      pressing.map((p) => ({ label: p.name, hint: String(p.openTasks), date: p.dueDate, href: `/app/tasks/projects/${p.id}` })),
      "/app/tasks",
    );
    add("blockedTasks", 1, blocked.map((t) => t.id), blocked.map((t) => ({ label: t.title, date: t.dueDate, href: `/app/tasks/${t.id}` })), "/app/today", { days: BLOCKED_DAYS });
    add("staleTasks", 1, stale.map((t) => t.id), stale.map((t) => ({ label: t.title, date: t.dueDate, href: `/app/tasks/${t.id}` })), "/app/today", { days: STALE_DAYS });
    add("vagueProjects", 0, vague.map((p) => p.id), vague.map((p) => ({ label: p.name, href: `/app/tasks/projects/${p.id}` })), "/app/tasks");
    if (open(ctx, "automation.manage", "automation")) {
      add("repeatedTasks", 0, repeated.map((r) => r.title), repeated.map((r) => ({ label: r.title, hint: String(r.n), href: "/app/automations" })), "/app/automations", { min: REPEAT_COUNT });
    }
  }

  if (open(ctx, "finance.read", "finance") && open(ctx, "tasks.read", "tasks")) {
    const over = await withTenant(ctx.organization.id, (tx) =>
      tx
        .select({ id: projects.id, name: projects.name, budgetCents: projects.budgetCents, costCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int` })
        .from(projects)
        .innerJoin(transactions, and(eq(transactions.projectId, projects.id), eq(transactions.type, "EXPENSE")))
        .where(and(eq(projects.status, "ACTIVE"), isNotNull(projects.budgetCents)))
        .groupBy(projects.id)
        .having(sql`sum(${transactions.amountCents}) > ${projects.budgetCents}`)
        .limit(20),
    );
    add("overBudget", 2, over.map((p) => `${p.id}:${p.costCents}`), over.map((p) => ({ label: p.name, amountCents: Number(p.costCents) - (p.budgetCents ?? 0), href: `/app/tasks/projects/${p.id}` })), "/app/tasks");
  }

  if (open(ctx, "clients.read", "pipeline")) {
    const silent = await withTenant(ctx.organization.id, (tx) =>
      tx
        .select({ deal: deals, client: clients })
        .from(deals)
        .innerJoin(clients, eq(clients.id, deals.clientId))
        .where(
          and(
            notInArray(deals.stage, ["WON", "LOST"]),
            or(eq(deals.assignedUserId, ctx.user.userId), isNull(deals.assignedUserId)),
            lt(deals.updatedAt, daysAgo(FOLLOW_UP_DAYS)),
            or(isNull(deals.nextFollowUp), lt(deals.nextFollowUp, now)),
          ),
        )
        .limit(20),
    );
    add("silentDeals", 1, silent.map((r) => r.deal.id), silent.map((r) => ({ label: r.deal.title, hint: displayName(r.client), amountCents: r.deal.valueCents, href: "/app/pipeline" })), "/app/pipeline", { days: FOLLOW_UP_DAYS });
  }

  if (open(ctx, "orders.read", "quotes")) {
    const waiting = await withTenant(ctx.organization.id, (tx) =>
      tx.select({ quote: quotes, client: clients }).from(quotes).innerJoin(clients, eq(clients.id, quotes.clientId)).where(and(eq(quotes.status, "SENT"), lt(quotes.updatedAt, daysAgo(QUOTE_DAYS)))).limit(20),
    );
    add("openQuotes", 1, waiting.map((r) => r.quote.id), waiting.map((r) => ({ label: r.quote.number ?? "—", hint: displayName(r.client), amountCents: r.quote.grossCents, href: `/app/quotes/${r.quote.id}` })), "/app/quotes", { days: QUOTE_DAYS });
  }

  if (open(ctx, "content.read", "content")) {
    const soon = await withTenant(ctx.organization.id, (tx) =>
      tx
        .select({ id: contentItems.id, title: contentItems.title, scheduledAt: contentItems.scheduledAt })
        .from(contentItems)
        .where(and(inArray(contentItems.status, ["IDEA", "DRAFT", "REVIEW"]), isNotNull(contentItems.scheduledAt), lte(contentItems.scheduledAt, new Date(Date.now() + CONTENT_WARNING_DAYS * 86_400_000))))
        .orderBy(asc(contentItems.scheduledAt))
        .limit(20),
    );
    add("contentDeadline", 1, soon.map((c) => c.id), soon.map((c) => ({ label: c.title, date: c.scheduledAt?.toISOString().slice(0, 10), href: `/app/content/${c.id}` })), "/app/content?view=list");
  }

  if (open(ctx, "clients.read", "crm")) {
    const unreachable = await withTenant(ctx.organization.id, (tx) =>
      tx.select().from(clients).where(and(eq(clients.status, "ACTIVE"), isNull(clients.archivedAt), isNull(clients.email), isNull(clients.phone))).limit(20),
    );
    add("missingContact", 0, unreachable.map((c) => c.id), unreachable.map((c) => ({ label: displayName(c), href: `/app/clients/${c.id}` })), "/app/clients");
  }

  return found.sort((a, b) => b.importance - a.importance);
}

/** What this person should see now: nothing they put aside, and nothing if they switched insights off. */
export async function myInsights(ctx: Context): Promise<Insight[]> {
  const prefs = await myPreferences(ctx);
  if (prefs.notifications.muted.includes("insight")) return [];
  const [all, aside] = await Promise.all([
    computeInsights(ctx),
    withTenant(ctx.organization.id, (tx) => tx.select().from(insightDismissals).where(eq(insightDismissals.userId, ctx.user.userId))),
  ]);
  const now = Date.now();
  return all.filter((i) => {
    const put = aside.find((d) => d.key === i.key);
    return !put || put.fingerprint !== i.fingerprint || put.until.getTime() < now;
  });
}

/** "Not now": until the records change or a week has passed. */
export async function dismissInsight(ctx: Context, key: string, print: string): Promise<void> {
  const until = new Date(Date.now() + SNOOZE_DAYS * 86_400_000);
  await withTenant(ctx.organization.id, (tx) =>
    tx
      .insert(insightDismissals)
      .values({ organizationId: ctx.organization.id, userId: ctx.user.userId, key, fingerprint: print, until })
      .onConflictDoUpdate({ target: [insightDismissals.organizationId, insightDismissals.userId, insightDismissals.key], set: { fingerprint: print, until } }),
  );
}
