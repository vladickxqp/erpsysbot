/**
 * Recurring invoices: rent, retainers, subscriptions. On each due date the
 * company gets a draft — or, when chosen, an issued invoice, sent by e-mail
 * to the client. Due dates in the past are caught up (at most twelve per run),
 * and a date is claimed before the invoice is made, so two servers or a crash
 * never bill twice.
 */
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { clients, recurringInvoices } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "./audit";
import { companyContext } from "./automations";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { createInvoiceDraft, issueInvoice } from "./invoices";
import { mailAvailable } from "./mail";
import { addDays, checkRates, linesInput, today, totals } from "./money";
import { requirePermission } from "./permissions";
import { sendDocument } from "./send";

export const INTERVALS = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type Interval = (typeof INTERVALS)[number];
export type Recurring = typeof recurringInvoices.$inferSelect;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const recurringInput = z.object({
  clientId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  items: linesInput,
  interval: z.enum(INTERVALS),
  startDate: isoDate,
  endDate: isoDate.nullish().transform((v) => v || null),
  autoIssue: z.boolean().default(false),
  autoSend: z.boolean().default(false),
});
export type RecurringInput = z.input<typeof recurringInput>;

/** The next date after `from`: weeks add days, months keep the anchor day (31 → 30 in April → 31 in May). */
export function nextOccurrence(from: string, interval: Interval, anchorDay: number): string {
  if (interval === "WEEKLY") return addDays(from, 7);
  const months = interval === "MONTHLY" ? 1 : interval === "QUARTERLY" ? 3 : 12;
  const [y, m] = from.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, last));
  return target.toISOString().slice(0, 10);
}

export async function saveRecurring(ctx: Context, id: string | null, raw: RecurringInput): Promise<Recurring> {
  requirePermission(ctx.permissions, "invoices.create");
  const input = recurringInput.parse(raw);
  if (input.autoIssue) requirePermission(ctx.permissions, "invoices.issue");
  checkRates(input.items, ctx.organization);
  const values = {
    clientId: input.clientId,
    title: input.title,
    items: input.items,
    interval: input.interval,
    anchorDay: Number(input.startDate.slice(8, 10)),
    nextDate: input.startDate,
    endDate: input.endDate,
    autoIssue: input.autoIssue,
    autoSend: input.autoIssue && input.autoSend,
  };
  return withTenant(ctx.organization.id, async (tx) => {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId));
    if (!client) throw new NotFoundError();
    if (id) {
      const [row] = await tx.update(recurringInvoices).set({ ...values, lastError: null }).where(eq(recurringInvoices.id, id)).returning();
      if (!row) throw new NotFoundError();
      return row;
    }
    const [row] = await tx
      .insert(recurringInvoices)
      .values({ ...values, organizationId: ctx.organization.id, createdBy: ctx.user.userId })
      .returning();
    await audit(tx, ctx, "invoice.recurring", "invoice", row.id, { interval: row.interval });
    return row;
  });
}

export async function setRecurringActive(ctx: Context, id: string, active: boolean): Promise<void> {
  requirePermission(ctx.permissions, "invoices.create");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.update(recurringInvoices).set({ active }).where(eq(recurringInvoices.id, id)).returning({ id: recurringInvoices.id });
    if (!row) throw new NotFoundError();
  });
}

export async function deleteRecurring(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "invoices.create");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx.delete(recurringInvoices).where(eq(recurringInvoices.id, id)).returning({ id: recurringInvoices.id });
    if (!row) throw new NotFoundError();
  });
}

export async function listRecurring(ctx: Context) {
  requirePermission(ctx.permissions, "invoices.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({ r: recurringInvoices, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
      .from(recurringInvoices)
      .innerJoin(clients, eq(clients.id, recurringInvoices.clientId))
      .orderBy(asc(recurringInvoices.nextDate));
    return rows.map(({ r, client }) => ({
      ...r,
      clientName: displayName(client),
      grossCents: totals(linesInput.parse(r.items), ctx.organization.smallBusiness).grossCents,
    }));
  });
}

export type RunResult = { created: number; issued: number; sent: number; failed: number };

/** Makes every invoice of this company that is due by `day`. Runs with the owner's rights. */
export async function runRecurring(ctx: Context, day = today(ctx.organization.timezone)): Promise<RunResult> {
  const result: RunResult = { created: 0, issued: 0, sent: 0, failed: 0 };
  if (ctx.disabledModules.has("invoices")) return result;
  const due = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(recurringInvoices)
      .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.nextDate, day), or(isNull(recurringInvoices.endDate), lte(recurringInvoices.nextDate, recurringInvoices.endDate)))),
  );
  for (const plan of due) {
    let date = plan.nextDate;
    for (let round = 0; round < 12 && date <= day && (!plan.endDate || date <= plan.endDate); round++) {
      const next = nextOccurrence(date, plan.interval as Interval, plan.anchorDay);
      // Claim this date first: whoever moves nextDate on bills it, nobody else.
      const claimed = await withTenant(ctx.organization.id, (tx) =>
        tx
          .update(recurringInvoices)
          .set({ nextDate: next, active: !plan.endDate || next <= plan.endDate })
          .where(and(eq(recurringInvoices.id, plan.id), eq(recurringInvoices.nextDate, date)))
          .returning({ id: recurringInvoices.id }),
      );
      if (!claimed.length) break;
      try {
        const draft = await createInvoiceDraft(ctx, {
          clientId: plan.clientId,
          serviceDate: date,
          dueDate: addDays(date, ctx.organization.paymentTermsDays),
          notes: plan.title,
          items: linesInput.parse(plan.items),
        });
        result.created++;
        let lastError: string | null = null;
        if (plan.autoIssue) {
          try {
            await issueInvoice(ctx, draft.id);
            result.issued++;
            if (plan.autoSend) {
              const [client] = await withTenant(ctx.organization.id, (tx) => tx.select({ email: clients.email }).from(clients).where(eq(clients.id, plan.clientId)));
              if (client?.email && mailAvailable()) {
                await sendDocument(ctx, "invoice", draft.id, { to: client.email });
                result.sent++;
              } else lastError = "NO_MAIL";
            }
          } catch (e) {
            lastError = e instanceof Error ? e.message.slice(0, 200) : "FAILED";
          }
        }
        await withTenant(ctx.organization.id, (tx) => tx.update(recurringInvoices).set({ lastInvoiceId: draft.id, lastError }).where(eq(recurringInvoices.id, plan.id)));
      } catch (e) {
        result.failed++;
        const message = e instanceof Error ? e.message.slice(0, 200) : "FAILED";
        // Give the date back, so it is tried again once the problem is fixed.
        await withTenant(ctx.organization.id, (tx) => tx.update(recurringInvoices).set({ nextDate: date, active: true, lastError: message }).where(eq(recurringInvoices.id, plan.id)));
        break;
      }
      date = next;
    }
  }
  return result;
}

/** For every company with something due (the server's timer). */
export async function runAllRecurring(): Promise<void> {
  const orgs = await getDb().selectDistinct({ id: recurringInvoices.organizationId }).from(recurringInvoices).where(eq(recurringInvoices.active, true));
  for (const { id } of orgs) {
    try {
      const ctx = await companyContext(id);
      if (ctx) await runRecurring(ctx);
    } catch (e) {
      console.error("recurring: run failed", e instanceof Error ? e.message : e);
    }
  }
}
