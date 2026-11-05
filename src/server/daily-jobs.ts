/**
 * What is looked at once a day, from 8 o'clock in each company's time zone:
 * who should follow up which overdue invoice, and the insights that cannot
 * wait. Every note has a key of its own, so running twice changes nothing.
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { clients, invoices, memberships, organizations, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { displayName } from "./clients";
import { contextFor } from "./context";
import { computeInsights } from "./insights";
import { today } from "./money";
import { companyLeads, notify } from "./notifications";

const HOUR = 8;
const done = new Map<string, string>();

const localHour = (timeZone: string, at: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(at)) % 24;

/** Each overdue invoice goes to whoever looks after the client, else to the company's leads. */
export async function followUpInvoices(organizationId: string, day: string): Promise<number> {
  const rows = await withTenant(organizationId, (tx) =>
    tx
      .select({ invoice: invoices, client: clients })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), lt(invoices.dueDate, day)))
      .limit(100),
  );
  let written = 0;
  const leads = await companyLeads(organizationId);
  for (const { invoice, client } of rows) {
    written += await notify(organizationId, client.assignedUserId ? [client.assignedUserId] : leads, {
      category: "assigned",
      kind: "invoiceFollowUp",
      vars: { number: invoice.number ?? "—", client: displayName(client) },
      href: `/app/invoices/${invoice.id}`,
      entity: "invoice",
      entityId: invoice.id,
      priority: 2,
      dedupeKey: `invoice-overdue:${invoice.id}`,
    });
  }
  return written;
}

/** The insights that cannot wait reach each person who may act on them, once per state of the facts. */
export async function pushInsights(organizationId: string): Promise<number> {
  const people = await getDb()
    .select({ user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId));
  let written = 0;
  for (const { user } of people) {
    const ctx = await contextFor({ sessionId: "daily", userId: user.id, email: user.email, name: user.name, locale: user.locale, isPlatformAdmin: false, activeOrganizationId: organizationId });
    if (!ctx || ctx.organization.id !== organizationId) continue;
    for (const insight of await computeInsights(ctx)) {
      if (insight.importance < 2 || insight.key === "overdueInvoices") continue;
      written += await notify(organizationId, [user.id], {
        category: "insight",
        kind: `insight_${insight.key}`,
        vars: insight.vars,
        href: insight.href,
        priority: 2,
        dedupeKey: `insight:${insight.key}:${insight.fingerprint.slice(0, 200)}`,
      });
    }
  }
  return written;
}

export async function runDailyJobs(at = new Date()): Promise<void> {
  const orgs = await getDb().select({ id: organizations.id, timezone: organizations.timezone }).from(organizations);
  for (const org of orgs) {
    const day = today(org.timezone, at);
    if (done.get(org.id) === day || localHour(org.timezone, at) < HOUR) continue;
    done.set(org.id, day);
    await followUpInvoices(org.id, day);
    await pushInsights(org.id);
  }
}
