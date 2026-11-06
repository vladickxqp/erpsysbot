/**
 * Automations: trigger → conditions → action.
 *
 * - Each rule fires at most once per subject (an invoice, an order, …): the
 *   run row is claimed first (unique rule + subject), so two servers or a
 *   second event never run it twice. A failed run is retried up to 3 times by
 *   the scheduler.
 * - Actions never fire triggers (creating a task is not an event here), so
 *   rules cannot loop.
 * - Actions run as the company's owner; messages go only to people of the
 *   company, by their linked Telegram.
 */
import { openCents } from "@/lib/invoicing";
import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appointments, automationRuns, automations, clients, deals, invoices, memberships, orders, products, projects, tasks, telegramLinks, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { DEFAULT_REGION, formatMoney, isLocale, regionOf, type Locale } from "@/i18n";
import { audit } from "./audit";
import { displayName, NotFoundError } from "./clients";
import { contextFor, type Context } from "./context";
import { companyLeads, notify } from "./notifications";
import { addDays, today } from "./money";
import { requirePermission } from "./permissions";
import { createTask } from "./tasks";
import { escapeHtml, sendMessage } from "./telegram/api";

export const EVENT_TRIGGERS = ["client.created", "client.status_changed", "deal.stage_changed", "appointment.completed", "project.created", "project.completed", "order.created", "order.completed"] as const;
export const SCHEDULED_TRIGGERS = ["invoice.overdue", "task.overdue", "stock.low"] as const;
export const TRIGGERS = [...EVENT_TRIGGERS, ...SCHEDULED_TRIGGERS] as const;
export const ACTIONS = ["task.create", "telegram.notify", "inbox.notify", "client.assign"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export type Automation = typeof automations.$inferSelect;

const MAX_ATTEMPTS = 3;

export const automationInput = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.enum(TRIGGERS),
  conditions: z
    .object({
      minAmountCents: z.coerce.number().int().min(0).optional(),
      minDaysOverdue: z.coerce.number().int().min(0).max(365).optional(),
      clientType: z.enum(["PERSON", "COMPANY"]).optional(),
      clientStatus: z.enum(["LEAD", "ACTIVE", "INACTIVE"]).optional(),
      /** The new status of a client or stage of a deal. */
      toStatus: z.string().trim().max(30).optional(),
    })
    .default({}),
  action: z.enum(ACTIONS),
  params: z
    .object({
      title: z.string().trim().max(300).optional(),
      message: z.string().trim().max(2000).optional(),
      dueInDays: z.coerce.number().int().min(0).max(365).optional(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      /** "owner", "admins", "assignee" (of the subject), "least_busy" or a user id. */
      to: z.string().trim().max(60).optional(),
    })
    .default({}),
  enabled: z.boolean().default(true),
});
export type AutomationInput = z.input<typeof automationInput>;

export async function saveAutomation(ctx: Context, id: string | null, raw: AutomationInput): Promise<Automation> {
  requirePermission(ctx.permissions, "automation.manage");
  const input = automationInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    if (id) {
      const [row] = await tx.update(automations).set(input).where(eq(automations.id, id)).returning();
      if (!row) throw new NotFoundError();
      await audit(tx, ctx, "automation.update", "automation", id, { enabled: row.enabled });
      return row;
    }
    const [row] = await tx.insert(automations).values({ ...input, organizationId: ctx.organization.id, createdBy: ctx.user.userId }).returning();
    await audit(tx, ctx, "automation.create", "automation", row.id, { trigger: row.trigger, action: row.action });
    return row;
  });
}

export async function deleteAutomation(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "automation.manage");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(automations).where(eq(automations.id, id)).returning({ id: automations.id });
    if (!row) throw new NotFoundError();
  });
}

export async function listAutomations(ctx: Context) {
  requirePermission(ctx.permissions, "automation.manage");
  return withTenant(ctx.organization.id, async (tx) => {
    const rules = await tx.select().from(automations).orderBy(asc(automations.createdAt));
    const runs = await tx
      .select({ run: automationRuns, name: automations.name })
      .from(automationRuns)
      .innerJoin(automations, eq(automations.id, automationRuns.automationId))
      .orderBy(desc(automationRuns.createdAt))
      .limit(50);
    return { rules, runs: runs.map((r) => ({ ...r.run, name: r.name })) };
  });
}

// --- Running ----------------------------------------------------------------------------------

type Subject = {
  key: string;
  amountCents?: number;
  daysOverdue?: number;
  clientType?: string;
  clientStatus?: string;
  assignedUserId?: string | null;
  clientId?: string | null;
  orderId?: string | null;
  projectId?: string | null;
  toStatus?: string;
  vars: Record<string, string>;
};

function matches(rule: Automation, subject: Subject): boolean {
  const c = (rule.conditions ?? {}) as z.output<typeof automationInput>["conditions"];
  if (c.minAmountCents != null && (subject.amountCents ?? 0) < c.minAmountCents) return false;
  if (c.minDaysOverdue != null && (subject.daysOverdue ?? 0) < c.minDaysOverdue) return false;
  if (c.clientType && subject.clientType !== c.clientType) return false;
  if (c.clientStatus && subject.clientStatus !== c.clientStatus) return false;
  if (c.toStatus && subject.toStatus !== c.toStatus) return false;
  return true;
}

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** The owner's context: automations act for the company, not for whoever caused the event. */
export async function companyContext(organizationId: string): Promise<Context | null> {
  const [owner] = await getDb()
    .select({ user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "OWNER")))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (!owner) return null;
  const u = owner.user;
  return contextFor({ sessionId: "automation", userId: u.id, email: u.email, name: u.name, locale: u.locale, isPlatformAdmin: false, activeOrganizationId: organizationId });
}

/** Whoever looks after the fewest clients, staff first; ties go to who joined first. */
async function leastBusyMember(organizationId: string): Promise<string> {
  const people = await getDb()
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(memberships.createdAt));
  const loads = await withTenant(organizationId, (tx) =>
    tx.select({ userId: clients.assignedUserId, n: sql<number>`count(*)::int` }).from(clients).where(isNotNull(clients.assignedUserId)).groupBy(clients.assignedUserId),
  );
  const load = new Map(loads.map((l) => [l.userId, Number(l.n)]));
  const staff = people.filter((p) => p.role !== "VIEWER");
  const sorted = (staff.length ? staff : people).slice().sort((a, b) => (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0));
  return sorted[0].userId;
}

async function perform(ctx: Context, rule: Automation, subject: Subject): Promise<string> {
  const p = (rule.params ?? {}) as z.output<typeof automationInput>["params"];
  const target = p.to === "assignee" ? (subject.assignedUserId ?? ctx.user.userId) : p.to && p.to !== "owner" ? p.to : ctx.user.userId;
  if (rule.action === "task.create") {
    const task = await createTask(ctx, {
      title: fill(p.title || rule.name, subject.vars),
      description: p.message ? fill(p.message, subject.vars) : null,
      dueDate: addDays(today(ctx.organization.timezone), p.dueInDays ?? 1),
      priority: p.priority ?? "MEDIUM",
      assignedUserId: target,
      clientId: subject.clientId ?? null,
      orderId: subject.orderId ?? null,
      projectId: subject.projectId ?? null,
    });
    return `task ${task.id}`;
  }
  if (rule.action === "client.assign") {
    if (!subject.clientId) throw new Error("no client");
    const person = p.to === "least_busy" ? await leastBusyMember(ctx.organization.id) : target;
    await withTenant(ctx.organization.id, async (tx) => {
      await tx.update(clients).set({ assignedUserId: person, updatedAt: new Date() }).where(eq(clients.id, subject.clientId!));
      await audit(tx, ctx, "client.update", "client", subject.clientId!, { assignedUserId: person, rule: rule.id });
    });
    await notify(ctx.organization.id, [person], {
      category: "assigned",
      kind: "clientAssigned",
      vars: { client: subject.vars.client ?? "" },
      href: `/app/clients/${subject.clientId}`,
      entity: "client",
      entityId: subject.clientId,
      dedupeKey: `client-assigned:${subject.clientId}:${person}`,
    });
    return `client ${person}`;
  }
  if (rule.action === "inbox.notify") {
    const people = p.to === "admins" || !p.to ? await companyLeads(ctx.organization.id) : [target];
    const written = await notify(ctx.organization.id, people, {
      category: "update",
      kind: "automation",
      vars: { message: fill(p.message || rule.name, subject.vars) },
      href: subject.projectId ? `/app/tasks/projects/${subject.projectId}` : subject.clientId ? `/app/clients/${subject.clientId}` : "/app/automations",
      dedupeKey: `automation:${rule.id}:${subject.key}`,
    });
    return `inbox ${written}`;
  }
  // telegram.notify: to one person, or to the company's owners and admins.
  const recipients =
    p.to === "admins" || !p.to
      ? await getDb()
          .select({ chatId: telegramLinks.chatId })
          .from(memberships)
          .innerJoin(telegramLinks, eq(telegramLinks.userId, memberships.userId))
          .where(and(eq(memberships.organizationId, ctx.organization.id), inArray(memberships.role, ["OWNER", "ADMIN"])))
      : await getDb()
          .select({ chatId: telegramLinks.chatId })
          .from(memberships)
          .innerJoin(telegramLinks, eq(telegramLinks.userId, memberships.userId))
          .where(and(eq(memberships.organizationId, ctx.organization.id), eq(memberships.userId, target)));
  const text = `⚡ <b>${escapeHtml(rule.name)}</b>\n${escapeHtml(fill(p.message || rule.name, subject.vars))}`;
  for (const r of recipients) await sendMessage(r.chatId, text);
  return `telegram ${recipients.length}`;
}

/** Runs every matching rule once for this subject; a failure is recorded and retried later. */
async function runRules(organizationId: string, trigger: Trigger, subject: Subject): Promise<number> {
  const rules = await withTenant(organizationId, (tx) =>
    tx.select().from(automations).where(and(eq(automations.trigger, trigger), eq(automations.enabled, true))),
  );
  if (!rules.length) return 0;
  let ran = 0;
  let ctx: Context | null | undefined;
  for (const rule of rules) {
    if (!matches(rule, subject)) continue;
    const claimed = await withTenant(organizationId, async (tx) => {
      const [fresh] = await tx
        .insert(automationRuns)
        .values({ organizationId, automationId: rule.id, subject: subject.key, ok: false, message: "running" })
        .onConflictDoNothing()
        .returning({ id: automationRuns.id });
      if (fresh) return fresh.id;
      // Retry a failed run, a few times.
      const [retry] = await tx
        .update(automationRuns)
        .set({ attempts: sql`${automationRuns.attempts} + 1`, message: "retry" })
        .where(
          and(
            eq(automationRuns.automationId, rule.id),
            eq(automationRuns.subject, subject.key),
            eq(automationRuns.ok, false),
            ne(automationRuns.message, "running"),
            lt(automationRuns.attempts, MAX_ATTEMPTS),
          ),
        )
        .returning({ id: automationRuns.id });
      return retry?.id ?? null;
    });
    if (!claimed) continue;
    ctx ??= await companyContext(organizationId);
    let ok = false;
    let message: string;
    try {
      if (!ctx) throw new Error("no owner");
      message = await perform(ctx, rule, subject);
      ok = true;
      ran++;
    } catch (e) {
      message = e instanceof Error ? e.message.slice(0, 500) : "error";
      // A rule that fails must not fail in silence.
      await notify(organizationId, await companyLeads(organizationId), {
        category: "failure",
        kind: "automationFailed",
        vars: { name: rule.name },
        href: "/app/automations",
        priority: 2,
        dedupeKey: `automation-failed:${rule.id}:${subject.key}`,
      }).catch(() => undefined);
    }
    await withTenant(organizationId, (tx) => tx.update(automationRuns).set({ ok, message }).where(eq(automationRuns.id, claimed)));
  }
  return ran;
}

/** Called after an event has been committed. Never throws into the caller. */
export async function fireAutomations(ctx: Context, trigger: (typeof EVENT_TRIGGERS)[number], id: string): Promise<void> {
  if (ctx.disabledModules.has("automation")) return;
  try {
    const locale: Locale = isLocale(ctx.organization.locale) ? ctx.organization.locale : "de";
    const region = regionOf(ctx.organization);
    const subject = await withTenant(ctx.organization.id, async (tx): Promise<Subject | null> => {
      if (trigger === "client.created") {
        const [c] = await tx.select().from(clients).where(eq(clients.id, id));
        return c ? { key: `client:${id}`, clientType: c.type, clientStatus: c.status, clientId: id, assignedUserId: c.assignedUserId, vars: { client: displayName(c), number: String(c.number) } } : null;
      }
      if (trigger === "client.status_changed") {
        const [c] = await tx.select().from(clients).where(eq(clients.id, id));
        return c ? { key: `client:${id}:status:${c.status}:${c.updatedAt.getTime()}`, clientType: c.type, clientStatus: c.status, toStatus: c.status, clientId: id, assignedUserId: c.assignedUserId, vars: { client: displayName(c), status: c.status } } : null;
      }
      if (trigger === "deal.stage_changed") {
        const [d] = await tx.select({ deal: deals, client: clients }).from(deals).innerJoin(clients, eq(clients.id, deals.clientId)).where(eq(deals.id, id));
        return d ? { key: `deal:${id}:stage:${d.deal.stage}`, amountCents: d.deal.valueCents, toStatus: d.deal.stage, clientId: d.deal.clientId, assignedUserId: d.deal.assignedUserId, vars: { title: d.deal.title, client: displayName(d.client), stage: d.deal.stage, amount: formatMoney(d.deal.valueCents, locale, region) } } : null;
      }
      if (trigger === "appointment.completed") {
        const [a] = await tx.select().from(appointments).where(eq(appointments.id, id));
        return a ? { key: `appointment:${id}:completed`, clientId: a.clientId, assignedUserId: a.assignedUserId, vars: { title: a.title } } : null;
      }
      if (trigger === "project.created" || trigger === "project.completed") {
        const [p] = await tx.select().from(projects).where(eq(projects.id, id));
        return p ? { key: `project:${id}:${trigger === "project.created" ? "created" : "completed"}`, clientId: p.clientId, projectId: id, vars: { title: p.name } } : null;
      }
      const [o] = await tx.select({ order: orders, client: clients }).from(orders).innerJoin(clients, eq(clients.id, orders.clientId)).where(eq(orders.id, id));
      if (!o) return null;
      return {
        key: `order:${id}:${trigger === "order.created" ? "created" : "completed"}`,
        amountCents: o.order.grossCents,
        clientId: o.order.clientId,
        orderId: id,
        assignedUserId: o.order.assignedUserId,
        vars: { client: displayName(o.client), number: `#${o.order.number}`, amount: formatMoney(o.order.grossCents, locale, region), title: o.order.title ?? "" },
      };
    });
    if (subject) await runRules(ctx.organization.id, trigger, subject);
  } catch (e) {
    console.error("automation: event failed", e instanceof Error ? e.message : e);
  }
}

/** The time-based triggers, for every company that has such rules. */
export async function runScheduledAutomations(): Promise<number> {
  const db = getDb();
  const orgs = await db
    .selectDistinct({ id: automations.organizationId })
    .from(automations)
    .where(and(eq(automations.enabled, true), inArray(automations.trigger, [...SCHEDULED_TRIGGERS])));
  let total = 0;
  for (const { id: orgId } of orgs) {
    type Row = { timezone: string; locale: string; country: string; currency: string; disabled_modules: string[] };
    const [org] = await db.execute<Row>(sql`select timezone, locale, country, currency, disabled_modules from organizations where id = ${orgId}`).then((r) =>
      Array.isArray(r) ? r : ((r as { rows?: Row[] }).rows ?? []),
    );
    if (org?.disabled_modules?.includes("automation")) continue;
    const tz = org?.timezone ?? "Europe/Berlin";
    const locale: Locale = isLocale(org?.locale) ? org.locale : "de";
    const region = org ? regionOf(org) : DEFAULT_REGION;
    const day = today(tz);
    const { overdue, lateTasks, low } = await withTenant(orgId, async (tx) => ({
      overdue: await tx
        .select({ invoice: invoices, client: clients })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), lt(invoices.dueDate, day))),
      lateTasks: await tx.select().from(tasks).where(and(ne(tasks.status, "DONE"), isNotNull(tasks.dueDate), lt(tasks.dueDate, day))),
      low: await tx
        .select()
        .from(products)
        .where(and(eq(products.trackStock, true), isNotNull(products.minStock), sql`${products.stockQuantity} <= ${products.minStock}`)),
    }));
    for (const { invoice, client } of overdue) {
      const days = Math.floor((Date.parse(day) - Date.parse(invoice.dueDate!)) / 86_400_000);
      total += await runRules(orgId, "invoice.overdue", {
        key: `invoice:${invoice.id}:overdue`,
        amountCents: openCents(invoice),
        daysOverdue: days,
        clientId: invoice.clientId,
        vars: { client: displayName(client), number: invoice.number ?? "", amount: formatMoney(openCents(invoice), locale, region), days: String(days) },
      });
    }
    for (const task of lateTasks) {
      total += await runRules(orgId, "task.overdue", {
        key: `task:${task.id}:overdue`,
        assignedUserId: task.assignedUserId,
        clientId: task.clientId,
        vars: { title: task.title, due: task.dueDate ?? "" },
      });
    }
    for (const product of low) {
      total += await runRules(orgId, "stock.low", {
        key: `product:${product.id}:low:${day}`,
        vars: { product: product.name, stock: String(Number(product.stockQuantity)), min: String(Number(product.minStock)) },
      });
    }
  }
  return total;
}
