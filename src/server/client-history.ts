/**
 * What a client relationship consists of beyond the address: the people at
 * the client, and one timeline of everything that happened — calls, e-mails,
 * meetings and notes written by hand, next to the quotes, orders, invoices,
 * appointments, tasks and files of the other modules.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { appointments, clientActivities, clientContacts, clients, deals, documents, invoices, orders, quotes, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export const ACTIVITY_KINDS = ["CALL", "EMAIL", "MEETING", "NOTE"] as const;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const contactInput = z.object({
  name: z.string().trim().min(1).max(160),
  role: optional(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "email"),
  phone: optional(40),
});
export type ContactInput = z.input<typeof contactInput>;

export const activityInput = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  subject: z.string().trim().min(1).max(300),
  body: optional(5000),
  occurredAt: z.coerce.date().optional(),
});
export type ActivityInput = z.input<typeof activityInput>;

export async function listContacts(ctx: Context, clientId: string) {
  requirePermission(ctx.permissions, "clients.read");
  return withTenant(ctx.organization.id, (tx) => tx.select().from(clientContacts).where(eq(clientContacts.clientId, clientId)).orderBy(clientContacts.name));
}

export async function saveContact(ctx: Context, clientId: string, id: string | null, raw: ContactInput) {
  requirePermission(ctx.permissions, "clients.update");
  const input = contactInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
    if (!client) throw new NotFoundError();
    if (id) {
      const [row] = await tx
        .update(clientContacts)
        .set(input)
        .where(and(eq(clientContacts.id, id), eq(clientContacts.clientId, clientId)))
        .returning();
      if (!row) throw new NotFoundError();
      return row;
    }
    const [row] = await tx
      .insert(clientContacts)
      .values({ ...input, clientId, organizationId: ctx.organization.id })
      .returning();
    return row;
  });
}

export async function deleteContact(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "clients.update");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(clientContacts).where(eq(clientContacts.id, id)).returning({ id: clientContacts.id });
    if (!row) throw new NotFoundError();
  });
}

export async function addActivity(ctx: Context, clientId: string, raw: ActivityInput) {
  requirePermission(ctx.permissions, "clients.update");
  const input = activityInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const when = input.occurredAt ?? new Date();
    const [client] = await tx.update(clients).set({ lastInteractionAt: when }).where(eq(clients.id, clientId)).returning({ id: clients.id });
    if (!client) throw new NotFoundError();
    const [row] = await tx
      .insert(clientActivities)
      .values({ ...input, occurredAt: when, clientId, organizationId: ctx.organization.id, userId: ctx.user.userId })
      .returning();
    await audit(tx, ctx, "client.update", "client", clientId, { activity: input.kind });
    return row;
  });
}

/** Only one's own entries; the rest of the timeline belongs to its modules. */
export async function deleteActivity(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "clients.update");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .delete(clientActivities)
      .where(and(eq(clientActivities.id, id), eq(clientActivities.userId, ctx.user.userId)))
      .returning({ id: clientActivities.id });
    if (!row) throw new NotFoundError();
  });
}

export type TimelineEntry = {
  key: string;
  kind: string;
  title: string;
  body: string | null;
  at: string;
  href: string | null;
  /** A hand-written entry of this person: may be deleted. */
  activityId: string | null;
  userId: string | null;
};

/** Everything about one client, newest first; each module only for those who may see it. */
export async function clientTimeline(ctx: Context, clientId: string, limit = 100): Promise<TimelineEntry[]> {
  requirePermission(ctx.permissions, "clients.read");
  const can = (p: Parameters<Context["permissions"]["has"]>[0]) => ctx.permissions.has(p);
  return withTenant(ctx.organization.id, async (tx) => {
    const out: TimelineEntry[] = [];
    const push = (e: Omit<TimelineEntry, "activityId" | "userId" | "body"> & Partial<TimelineEntry>) => out.push({ activityId: null, userId: null, body: null, ...e });
    const q = { limit };
    for (const a of await tx.select().from(clientActivities).where(eq(clientActivities.clientId, clientId)).orderBy(desc(clientActivities.occurredAt)).limit(q.limit)) {
      push({ key: `a-${a.id}`, kind: a.kind, title: a.subject, body: a.body, at: a.occurredAt.toISOString(), href: null, activityId: a.id, userId: a.userId });
    }
    if (can("invoices.read")) {
      for (const i of await tx.select().from(invoices).where(eq(invoices.clientId, clientId)).orderBy(desc(invoices.createdAt)).limit(q.limit)) {
        push({ key: `i-${i.id}`, kind: "INVOICE", title: i.number ?? "", at: i.createdAt.toISOString(), href: `/app/invoices/${i.id}` });
      }
    }
    if (can("orders.read")) {
      for (const o of await tx.select().from(orders).where(eq(orders.clientId, clientId)).orderBy(desc(orders.createdAt)).limit(q.limit)) {
        push({ key: `o-${o.id}`, kind: "ORDER", title: o.title ?? String(o.number), at: o.createdAt.toISOString(), href: `/app/orders/${o.id}` });
      }
      for (const o of await tx.select().from(quotes).where(eq(quotes.clientId, clientId)).orderBy(desc(quotes.createdAt)).limit(q.limit)) {
        push({ key: `q-${o.id}`, kind: "QUOTE", title: o.number ?? o.title ?? "", at: o.createdAt.toISOString(), href: `/app/quotes/${o.id}` });
      }
    }
    if (can("calendar.read")) {
      for (const a of await tx.select().from(appointments).where(eq(appointments.clientId, clientId)).orderBy(desc(appointments.startsAt)).limit(q.limit)) {
        push({ key: `m-${a.id}`, kind: "APPOINTMENT", title: a.title, at: a.startsAt.toISOString(), href: "/app/calendar" });
      }
    }
    if (can("tasks.read")) {
      for (const task of await tx.select().from(tasks).where(eq(tasks.clientId, clientId)).orderBy(desc(tasks.createdAt)).limit(q.limit)) {
        push({ key: `t-${task.id}`, kind: "TASK", title: task.title, at: task.createdAt.toISOString(), href: "/app/tasks" });
      }
    }
    for (const d of await tx.select().from(deals).where(eq(deals.clientId, clientId)).orderBy(desc(deals.createdAt)).limit(q.limit)) {
      push({ key: `d-${d.id}`, kind: "DEAL", title: d.title, at: d.createdAt.toISOString(), href: "/app/pipeline" });
    }
    if (can("documents.read")) {
      for (const d of await tx.select().from(documents).where(eq(documents.clientId, clientId)).orderBy(desc(documents.createdAt)).limit(q.limit)) {
        push({ key: `f-${d.id}`, kind: "DOCUMENT", title: d.name, at: d.createdAt.toISOString(), href: `/app/documents/${d.id}/file` });
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  });
}
