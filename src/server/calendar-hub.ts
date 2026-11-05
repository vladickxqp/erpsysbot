/**
 * Everything with a date, next to the appointments: task and project deadlines,
 * planned content, invoices falling due, who is away. Each kind only for those
 * who may see it and while its module is on.
 */
import { and, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { contentItems, invoices, projects, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { localParts } from "./calendar";
import type { Context } from "./context";
import { awayBetween } from "./hr";
import { addDays } from "./money";
import { moduleOn } from "./modules";
import type { CalendarEvent } from "@/lib/calendar-events";


const MAX_ABSENCE_DAYS = 62;

export async function calendarEvents(ctx: Context, from: string, to: string, options: { mine?: boolean; from?: Date; to?: Date } = {}): Promise<CalendarEvent[]> {
  const can = (p: Parameters<Context["permissions"]["has"]>[0], m: Parameters<typeof moduleOn>[1]) => ctx.permissions.has(p) && moduleOn(ctx, m);
  const tz = ctx.organization.timezone;
  const events: CalendarEvent[] = [];
  await withTenant(ctx.organization.id, async (tx) => {
    if (can("tasks.read", "tasks")) {
      const rows = await tx
        .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
        .from(tasks)
        .where(and(ne(tasks.status, "DONE"), gte(tasks.dueDate, from), lte(tasks.dueDate, to), options.mine ? eq(tasks.assignedUserId, ctx.user.userId) : undefined))
        .limit(300);
      for (const t of rows) events.push({ id: `t-${t.id}`, kind: "task", title: t.title, day: t.dueDate!, href: `/app/tasks/${t.id}` });
      const list = await tx
        .select({ id: projects.id, name: projects.name, dueDate: projects.dueDate })
        .from(projects)
        .where(and(eq(projects.status, "ACTIVE"), gte(projects.dueDate, from), lte(projects.dueDate, to)))
        .limit(100);
      for (const p of list) events.push({ id: `p-${p.id}`, kind: "project", title: p.name, day: p.dueDate!, href: `/app/tasks/projects/${p.id}` });
    }
    if (can("content.read", "content")) {
      const rows = await tx
        .select({ id: contentItems.id, title: contentItems.title, scheduledAt: contentItems.scheduledAt })
        .from(contentItems)
        .where(and(ne(contentItems.status, "PUBLISHED"), isNotNull(contentItems.scheduledAt), gte(contentItems.scheduledAt, new Date(`${from}T00:00:00Z`)), lte(contentItems.scheduledAt, new Date(`${addDays(to, 1)}T00:00:00Z`))))
        .limit(200);
      for (const c of rows) events.push({ id: `c-${c.id}`, kind: "content", title: c.title, day: localParts(c.scheduledAt!, tz).date, href: `/app/content/${c.id}` });
    }
    if (can("invoices.read", "invoices") && !options.mine) {
      const rows = await tx
        .select({ id: invoices.id, number: invoices.number, dueDate: invoices.dueDate })
        .from(invoices)
        .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), gte(invoices.dueDate, from), lte(invoices.dueDate, to)))
        .limit(200);
      for (const i of rows) events.push({ id: `i-${i.id}`, kind: "invoice", title: i.number ?? "—", day: i.dueDate!, href: `/app/invoices/${i.id}` });
    }
  });
  if (moduleOn(ctx, "hr")) {
    for (const a of await awayBetween(ctx, from, to)) {
      if (options.mine && a.userId !== ctx.user.userId) continue;
      let day = a.startDate < from ? from : a.startDate;
      const last = a.endDate > to ? to : a.endDate;
      for (let n = 0; day <= last && n < MAX_ABSENCE_DAYS; n++, day = addDays(day, 1)) events.push({ id: `a-${a.id}-${day}`, kind: "absence", title: a.name, day, href: "/app/hr" });
    }
  }
  return events.sort((a, b) => a.day.localeCompare(b.day));
}
