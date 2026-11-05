/**
 * Personal dashboards: each person arranges their own overview pages from
 * widgets. A widget shows only figures from the modules behind it, and only
 * to people allowed to see them — a layout that names a widget someone may
 * not see simply leaves it out.
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLog, dashboards } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { AppModule, WorkspaceType } from "@/lib/modules";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { moduleOn } from "./modules";
import type { Permission, Role } from "./permissions";

export const WIDGET_TYPES = [
  "quickActions",
  "revenue",
  "expenses",
  "profit",
  "outstanding",
  "openOrders",
  "clients",
  "notifications",
  "recommendations",
  "cashFlow",
  "clientGrowth",
  "myTasks",
  "projects",
  "agenda",
  "content",
  "social",
  "services",
  "activity",
  "recentInvoices",
  "insights",
  "inbox",
  "approvals",
  "deadlines",
  "teamWorkload",
  "timeWeek",
  "daySummary",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export type WidgetSize = 1 | 2 | 3 | 4;
export type Widget = { id: string; type: WidgetType; size: WidgetSize; collapsed: boolean };

/** What each widget needs: a permission and a module switched on; and how wide it starts. */
export const WIDGETS: Record<WidgetType, { needs: Permission | null; module: AppModule | null; size: WidgetSize }> = {
  quickActions: { needs: null, module: null, size: 4 },
  revenue: { needs: "finance.read", module: "finance", size: 1 },
  expenses: { needs: "finance.read", module: "finance", size: 1 },
  profit: { needs: "finance.read", module: "finance", size: 1 },
  outstanding: { needs: "invoices.read", module: "invoices", size: 1 },
  openOrders: { needs: "orders.read", module: "orders", size: 1 },
  clients: { needs: "clients.read", module: "crm", size: 1 },
  notifications: { needs: null, module: null, size: 2 },
  recommendations: { needs: null, module: null, size: 2 },
  cashFlow: { needs: "finance.read", module: "finance", size: 2 },
  clientGrowth: { needs: "clients.read", module: "crm", size: 2 },
  myTasks: { needs: "tasks.read", module: "tasks", size: 2 },
  projects: { needs: "tasks.read", module: "tasks", size: 2 },
  agenda: { needs: "calendar.read", module: "calendar", size: 2 },
  content: { needs: "content.read", module: "content", size: 2 },
  social: { needs: "content.read", module: "social", size: 2 },
  services: { needs: "settings.manage", module: "integrations", size: 2 },
  activity: { needs: "settings.manage", module: null, size: 2 },
  recentInvoices: { needs: "invoices.read", module: "invoices", size: 4 },
  insights: { needs: null, module: null, size: 2 },
  inbox: { needs: null, module: null, size: 2 },
  approvals: { needs: null, module: null, size: 2 },
  deadlines: { needs: "tasks.read", module: "tasks", size: 2 },
  teamWorkload: { needs: "employees.read", module: "tasks", size: 2 },
  timeWeek: { needs: "time.read", module: "time", size: 1 },
  daySummary: { needs: "ai.use", module: "assistant", size: 2 },
};

/** The widgets this person may place, in catalogue order. */
export function availableWidgets(ctx: Context): WidgetType[] {
  return WIDGET_TYPES.filter((type) => {
    const w = WIDGETS[type];
    return (!w.needs || ctx.permissions.has(w.needs)) && (!w.module || moduleOn(ctx, w.module));
  });
}

const widgetSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(WIDGET_TYPES),
  size: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  collapsed: z.boolean().default(false),
});
const MAX_WIDGETS = 40;
const MAX_DASHBOARDS = 10;

/** Whatever a row or a browser holds → valid widgets, each id once. */
export function cleanWidgets(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const entry of raw) {
    const parsed = widgetSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push(parsed.data);
    if (out.length >= MAX_WIDGETS) break;
  }
  return out;
}

export function newWidget(type: WidgetType): Widget {
  return { id: randomUUID().slice(0, 8), type, size: WIDGETS[type].size, collapsed: false };
}

/** What a first dashboard shows, by kind of workspace. */
const FIRST_WIDGETS: Partial<Record<WorkspaceType, WidgetType[]>> = {
  CREATOR: ["quickActions", "insights", "content", "social", "myTasks", "deadlines", "revenue", "expenses", "agenda"],
  FREELANCER: ["quickActions", "insights", "myTasks", "projects", "timeWeek", "outstanding", "revenue", "expenses", "agenda"],
  PERSONAL: ["quickActions", "myTasks", "agenda", "projects", "expenses", "inbox"],
};

/** In a company it depends on the person's work: what an employee and a manager look at differs. */
const ROLE_WIDGETS: Partial<Record<Role, WidgetType[]>> = {
  MANAGER: ["quickActions", "insights", "teamWorkload", "projects", "approvals", "deadlines", "agenda", "inbox"],
  EMPLOYEE: ["quickActions", "myTasks", "deadlines", "agenda", "inbox", "timeWeek"],
  ACCOUNTANT: ["quickActions", "insights", "outstanding", "revenue", "expenses", "profit", "cashFlow", "recentInvoices"],
  VIEWER: ["myTasks", "agenda", "projects", "inbox"],
  CUSTOM: ["quickActions", "myTasks", "deadlines", "agenda", "inbox"],
};

const OWNER_WIDGETS: WidgetType[] = ["quickActions", "insights", "revenue", "expenses", "profit", "outstanding", "projects", "myTasks", "approvals", "clients", "agenda", "recentInvoices", "activity"];

/** A first dashboard, made of what this person may see. */
export function defaultWidgets(ctx: Context): Widget[] {
  const allowed = availableWidgets(ctx);
  const kind = ctx.organization.workspaceType as WorkspaceType;
  const wanted = FIRST_WIDGETS[kind] ?? ROLE_WIDGETS[ctx.role] ?? OWNER_WIDGETS;
  return wanted.filter((w) => allowed.includes(w)).map(newWidget);
}

/** Back to the start: the layout a new person of this kind gets. */
export async function resetDashboard(ctx: Context, id: string): Promise<void> {
  await saveDashboard(ctx, id, { widgets: defaultWidgets(ctx) });
}

/** One widget worth offering, with the reason; the person decides, nothing is moved for them. */
export function suggestedWidget(ctx: Context, placed: readonly Widget[], declined: readonly string[], facts: { deadlines: number; insights: number; timeEntries: number }): { type: WidgetType; reason: string } | null {
  const allowed = new Set(availableWidgets(ctx));
  const offers: [WidgetType, boolean, string][] = [
    ["insights", facts.insights > 0, "insights"],
    ["deadlines", facts.deadlines >= 3, "deadlines"],
    ["timeWeek", facts.timeEntries > 0, "time"],
  ];
  for (const [type, fits, reason] of offers) {
    if (fits && allowed.has(type) && !placed.some((w) => w.type === type) && !declined.includes(type)) return { type, reason };
  }
  return null;
}

export type Dashboard = { id: string; name: string; widgets: Widget[] };

const nameSchema = z.string().trim().min(1).max(60);

/** This person's dashboards in their order; the first visit creates one. */
export async function listDashboards(ctx: Context, defaultName: string): Promise<Dashboard[]> {
  return withTenant(ctx.organization.id, async (tx) => {
    const mine = and(eq(dashboards.userId, ctx.user.userId));
    let rows = await tx.select().from(dashboards).where(mine).orderBy(asc(dashboards.position), asc(dashboards.createdAt));
    if (!rows.length) {
      rows = await tx
        .insert(dashboards)
        .values({ organizationId: ctx.organization.id, userId: ctx.user.userId, name: nameSchema.parse(defaultName), position: 0, widgets: defaultWidgets(ctx) })
        .returning();
    }
    return rows.map((r) => ({ id: r.id, name: r.name, widgets: cleanWidgets(r.widgets) }));
  });
}

export async function createDashboard(ctx: Context, name: string, template: "empty" | "default"): Promise<Dashboard> {
  const clean = nameSchema.parse(name);
  return withTenant(ctx.organization.id, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(dashboards).where(eq(dashboards.userId, ctx.user.userId));
    if (Number(n) >= MAX_DASHBOARDS) throw new NotFoundError();
    const [last] = await tx.select({ position: dashboards.position }).from(dashboards).where(eq(dashboards.userId, ctx.user.userId)).orderBy(desc(dashboards.position)).limit(1);
    const widgets = template === "default" ? defaultWidgets(ctx) : [];
    const [row] = await tx
      .insert(dashboards)
      .values({ organizationId: ctx.organization.id, userId: ctx.user.userId, name: clean, position: (last?.position ?? 0) + 1, widgets })
      .returning();
    return { id: row.id, name: row.name, widgets };
  });
}

/** Saves name and widgets of one's own dashboard; widgets one may not see are dropped. */
export async function saveDashboard(ctx: Context, id: string, patch: { name?: string; widgets?: unknown }): Promise<Dashboard> {
  const allowed = new Set(availableWidgets(ctx));
  const set: { name?: string; widgets?: Widget[] } = {};
  if (patch.name !== undefined) set.name = nameSchema.parse(patch.name);
  if (patch.widgets !== undefined) set.widgets = cleanWidgets(patch.widgets).filter((w) => allowed.has(w.type));
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .update(dashboards)
      .set(set)
      .where(and(eq(dashboards.id, id), eq(dashboards.userId, ctx.user.userId)))
      .returning();
    if (!row) throw new NotFoundError();
    return { id: row.id, name: row.name, widgets: cleanWidgets(row.widgets) };
  });
}

/** Deletes one's own dashboard; the last one stays. */
export async function deleteDashboard(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(dashboards).where(eq(dashboards.userId, ctx.user.userId));
    if (Number(n) <= 1) throw new NotFoundError();
    const [row] = await tx
      .delete(dashboards)
      .where(and(eq(dashboards.id, id), eq(dashboards.userId, ctx.user.userId)))
      .returning({ id: dashboards.id });
    if (!row) throw new NotFoundError();
  });
}

/** The latest entries of the audit trail (for owners and admins: settings.manage). */
export async function recentActivity(ctx: Context, limit = 12) {
  if (!ctx.permissions.has("settings.manage")) return [];
  return withTenant(ctx.organization.id, (tx) =>
    tx
      .select({ id: auditLog.id, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, userId: auditLog.userId, via: auditLog.via, data: auditLog.data, createdAt: auditLog.createdAt })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit),
  );
}
