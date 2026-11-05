/**
 * The figures behind the dashboard widgets — every one from a module's own
 * query, none invented. Only what the placed widgets need is loaded, and only
 * what the person may see; an empty module yields an empty widget, not a
 * made-up number.
 */
import type { AppModule } from "@/lib/modules";
import { assistantAvailable } from "./assistant/run";
import { storedSummary } from "./assistant/workflows";
import { inbox } from "./inbox";
import { myInsights } from "./insights";
import { myPreferences } from "./preferences";
import { listEntries, minutesOf } from "./time";
import { withTenant } from "@/db/tenant";
import { tasks as tasksTable } from "@/db/schema";
import { and, isNotNull, ne, sql } from "drizzle-orm";
import { dayBounds, listAppointments, localParts } from "./calendar";
import { contentOverview } from "./content";
import type { Context } from "./context";
import { clientStats, invoiceStats, openOrderStats } from "./dashboard";
import { recentActivity, type WidgetType } from "./dashboards";
import { dueFollowUps } from "./deals";
import { financeSummary, monthlyFlow } from "./finance";
import { integrationStates } from "./integrations";
import { lowStock } from "./inventory";
import { listInvoices } from "./invoices";
import { moduleOn } from "./modules";
import { addDays, today } from "./money";
import { socialTotals } from "./social";
import { listProjects, listTasks } from "./tasks";
import { memberOptions } from "./team";

/** The quick actions this person can really use: permission and module. */
export function quickActions(ctx: Context): { key: string; href: string }[] {
  const all: [string, string, Parameters<Context["permissions"]["has"]>[0], AppModule][] = [
    ["task", "/app/tasks?new=1", "tasks.manage", "tasks"],
    ["project", "/app/tasks?newProject=1", "tasks.manage", "tasks"],
    ["client", "/app/clients?new=1", "clients.create", "crm"],
    ["invoice", "/app/invoices/new", "invoices.create", "invoices"],
    ["appointment", "/app/calendar?new=1", "calendar.manage", "calendar"],
    ["document", "/app/documents", "documents.manage", "documents"],
    ["content", "/app/content/new", "content.manage", "content"],
    ["time", "/app/time", "time.manage", "time"],
  ];
  const actions = all.filter(([, , needs, module]) => ctx.permissions.has(needs) && moduleOn(ctx, module)).map(([key, href]) => ({ key, href }));
  if (ctx.permissions.has("ai.use") && assistantAvailable() && moduleOn(ctx, "assistant")) actions.push({ key: "assistant", href: "/app/assistant" });
  return actions;
}

export type Notice = { key: string; vars?: Record<string, string | number>; href: string; tone: "danger" | "warning" | "info" };

const has = (ctx: Context, p: Parameters<Context["permissions"]["has"]>[0]) => ctx.permissions.has(p);

export async function loadWidgetData(ctx: Context, types: Set<WidgetType>) {
  const tz = ctx.organization.timezone;
  const now = today(tz);
  const monthStart = `${now.slice(0, 7)}-01`;
  const want = (...t: WidgetType[]) => t.some((x) => types.has(x));
  const signals = want("notifications", "recommendations");

  // One after the other: the embedded database for tests and development has a single connection.
  const finance = want("revenue", "expenses", "profit") || (signals && has(ctx, "finance.read") && moduleOn(ctx, "finance")) ? await financeSummary(ctx, monthStart, now) : null;
  const outstanding = (want("outstanding") || signals) && has(ctx, "invoices.read") && moduleOn(ctx, "invoices") ? await invoiceStats(ctx) : null;
  const openOrders = want("openOrders") && has(ctx, "orders.read") ? await openOrderStats(ctx) : null;
  const clients = want("clients", "clientGrowth") && has(ctx, "clients.read") ? await clientStats(ctx) : null;
  const cashFlow = want("cashFlow") && has(ctx, "finance.read") ? await monthlyFlow(ctx) : null;
  const tasks = (want("myTasks") || signals) && has(ctx, "tasks.read") && moduleOn(ctx, "tasks") ? await listTasks(ctx, { assignedUserId: ctx.user.userId, open: true }) : null;
  const projects = want("projects") && has(ctx, "tasks.read") ? await listProjects(ctx) : null;
  const agenda =
    (want("agenda") || signals) && has(ctx, "calendar.read") && moduleOn(ctx, "calendar")
      ? await listAppointments(ctx, { ...dayBounds(now, tz), userId: ctx.user.userId, activeOnly: true })
      : null;
  const content = (want("content") || signals) && has(ctx, "content.read") && moduleOn(ctx, "content") ? await contentOverview(ctx) : null;
  const social = want("social") && has(ctx, "content.read") ? await socialTotals(ctx) : null;
  const activity = want("activity") ? await recentActivity(ctx) : null;
  const names = activity?.length ? new Map((await memberOptions(ctx)).map((m) => [m.id, m.name])) : null;
  const invoices = want("recentInvoices") && has(ctx, "invoices.read") ? await listInvoices(ctx, { pageSize: 6 }) : null;
  const followUps = signals && has(ctx, "clients.read") && moduleOn(ctx, "pipeline") ? await dueFollowUps(ctx, ctx.user.userId) : null;
  const stock = signals && has(ctx, "orders.read") && moduleOn(ctx, "inventory") ? await lowStock(ctx) : null;
  const prefs = want("quickActions") ? await myPreferences(ctx) : null;
  const insights = want("insights") ? await myInsights(ctx) : null;
  const inboxItems = want("inbox", "approvals") ? await inbox(ctx) : null;
  const deadlines = want("deadlines") && has(ctx, "tasks.read") ? (await listTasks(ctx, { assignedUserId: ctx.user.userId, open: true })).filter((t) => t.dueDate && t.dueDate <= addDays(now, 14)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)).slice(0, 8) : null;
  const workload =
    want("teamWorkload") && has(ctx, "tasks.read")
      ? await withTenant(ctx.organization.id, (tx) =>
          tx
            .select({ userId: tasksTable.assignedUserId, open: sql<number>`count(*)::int`, late: sql<number>`count(*) filter (where ${tasksTable.dueDate} < ${now})::int` })
            .from(tasksTable)
            .where(and(ne(tasksTable.status, "DONE"), isNotNull(tasksTable.assignedUserId)))
            .groupBy(tasksTable.assignedUserId),
        )
      : null;
  const people = workload?.length ? new Map((await memberOptions(ctx)).map((m) => [m.id, m.name])) : null;
  const weekStart = new Date(`${addDays(now, -((new Date(`${now}T12:00:00Z`).getUTCDay() + 6) % 7))}T00:00:00Z`);
  const time = want("timeWeek") && has(ctx, "time.read") ? (await listEntries(ctx, { from: weekStart })).filter((e) => e.endedAt).reduce((sum, e) => sum + minutesOf(e), 0) : null;
  const daySummary = want("daySummary") ? await storedSummary(ctx) : null;

  const overdueTasks = tasks?.filter((t) => t.dueDate && t.dueDate < now) ?? [];
  const dueToday = tasks?.filter((t) => t.dueDate === now) ?? [];

  const notifications: Notice[] = [];
  if (outstanding?.overdue) notifications.push({ key: "overdueInvoices", vars: { count: outstanding.overdue }, href: "/app/invoices?filter=OVERDUE", tone: "danger" });
  if (overdueTasks.length) notifications.push({ key: "overdueTasks", vars: { count: overdueTasks.length }, href: "/app/tasks?mine=1&view=list", tone: "danger" });
  if (dueToday.length) notifications.push({ key: "tasksToday", vars: { count: dueToday.length }, href: "/app/tasks?mine=1&view=list", tone: "warning" });
  if (agenda?.length) notifications.push({ key: "appointmentsToday", vars: { count: agenda.length }, href: "/app/calendar?view=day", tone: "info" });
  if (followUps?.length) notifications.push({ key: "followUps", vars: { count: followUps.length }, href: "/app/pipeline", tone: "warning" });
  if (content?.overdue) notifications.push({ key: "contentOverdue", vars: { count: content.overdue }, href: "/app/content?view=list&status=SCHEDULED", tone: "warning" });
  if (content?.byStatus.REVIEW && has(ctx, "content.publish")) notifications.push({ key: "contentReview", vars: { count: content.byStatus.REVIEW }, href: "/app/content?view=list&status=REVIEW", tone: "info" });
  if (stock?.length) notifications.push({ key: "lowStock", vars: { count: stock.length }, href: "/app/purchasing", tone: "warning" });

  // Suggestions follow from the same figures; each names what to do and where.
  const recommendations: Notice[] = [];
  if (outstanding?.overdue) recommendations.push({ key: "sendReminders", vars: { count: outstanding.overdue }, href: "/app/invoices?filter=OVERDUE", tone: "warning" });
  if (finance && finance.expenseCents > finance.incomeCents - finance.refundCents && finance.expenseCents > 0)
    recommendations.push({ key: "expensesAboveRevenue", href: "/app/finance", tone: "warning" });
  if (followUps?.length) recommendations.push({ key: "callLeads", vars: { count: followUps.length }, href: "/app/pipeline", tone: "info" });
  if (content && has(ctx, "content.manage") && content.upcoming.length === 0)
    recommendations.push({ key: has(ctx, "ai.use") && assistantAvailable() ? "planContentAi" : "planContent", href: has(ctx, "ai.use") && assistantAvailable() ? "/app/content/generate" : "/app/content", tone: "info" });
  if (content?.byStatus.REVIEW && has(ctx, "content.publish")) recommendations.push({ key: "reviewContent", vars: { count: content.byStatus.REVIEW }, href: "/app/content?view=list&status=REVIEW", tone: "info" });
  if (stock?.length) recommendations.push({ key: "reorder", vars: { count: stock.length }, href: "/app/purchasing", tone: "warning" });
  if (overdueTasks.length > 2) recommendations.push({ key: "replanTasks", vars: { count: overdueTasks.length }, href: "/app/tasks?mine=1", tone: "info" });

  return {
    finance: finance && { incomeCents: finance.incomeCents - finance.refundCents, expenseCents: finance.expenseCents, resultCents: finance.resultCents },
    outstanding,
    openOrders,
    clients,
    cashFlow,
    myTasks: tasks
      ?.slice()
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
      .slice(0, 8)
      .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, overdue: !!t.dueDate && t.dueDate < now })),
    projects: projects?.slice(0, 8).map((p) => ({ id: p.id, name: p.name, open: p.open, done: p.done, dueDate: p.dueDate })),
    agenda: agenda?.map((a) => ({ id: a.id, title: a.title, start: localParts(a.startsAt, tz).time, end: localParts(a.endsAt, tz).time, clientName: a.clientName })),
    content,
    social: social && {
      followers: social.followers,
      views: social.views,
      followersDelta: social.followersDelta,
      viewsDelta: social.viewsDelta,
      channels: social.channels.map((c) => ({ id: c.id, name: c.name, provider: c.provider, followers: c.followers, followersDelta: c.followersDelta })),
    },
    services: types.has("services") ? integrationStates().map((s) => ({ key: s.key, state: s.state })) : null,
    activity: activity?.map((a) => ({
      id: a.id,
      action: a.action,
      who: (a.userId && names?.get(a.userId)) || null,
      via: a.via,
      at: a.createdAt.toISOString(),
    })),
    recentInvoices: invoices?.rows.map((i) => ({ id: i.id, number: i.number, clientName: i.clientName, status: i.status, overdue: i.overdue, kind: i.kind, grossCents: i.grossCents, currency: i.currency, issueDate: i.issueDate })),
    notifications: types.has("notifications") ? notifications : null,
    recommendations: types.has("recommendations") ? recommendations : null,
    assistant: has(ctx, "ai.use") && assistantAvailable() && moduleOn(ctx, "assistant"),
    quickActions: types.has("quickActions") ? quickActions(ctx).filter((a) => !prefs?.quickActions.length || prefs.quickActions.includes(a.key)) : null,
    insights,
    inbox: types.has("inbox") ? (inboxItems?.filter((i) => !i.read && !i.insight).slice(0, 6) ?? []) : null,
    approvals: types.has("approvals") ? (inboxItems?.filter((i) => i.category === "approval").slice(0, 6) ?? []) : null,
    deadlines: deadlines?.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate!, overdue: t.dueDate! < now })),
    teamWorkload: workload?.map((w) => ({ name: people?.get(w.userId!) ?? "—", open: Number(w.open), late: Number(w.late) })).sort((a, b) => b.open - a.open),
    timeWeek: time,
    daySummary,
  };
}

export type WidgetData = Awaited<ReturnType<typeof loadWidgetData>>;
