/**
 * Payment reminders for overdue invoices: level 1 is the friendly
 * Zahlungserinnerung, 2 and 3 are Mahnungen. Each states the open amount at
 * the time it was written and a new date to pay by; the invoice itself is
 * never touched.
 */
import { openCents } from "@/lib/invoicing";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { clients, invoices, paymentReminders } from "@/db/schema";
import { audit } from "./audit";
import { displayName, NotFoundError } from "./clients";
import type { Context } from "./context";
import { clientParty, sellerOf, type Party, type Seller } from "./invoices";
import { addDays, today } from "./money";
import { requirePermission } from "./permissions";

export const MAX_REMINDER_LEVEL = 3;
const PAY_WITHIN_DAYS = 7;

export class ReminderError extends Error {
  constructor(public readonly code: "NOT_OVERDUE" | "MAX_LEVEL") {
    super(code);
  }
}

export type Reminder = typeof paymentReminders.$inferSelect;

const reminderInput = z.object({ feeCents: z.coerce.number().int().min(0).max(100_00).default(0) });

export async function createReminder(ctx: Context, invoiceId: string, raw: z.input<typeof reminderInput> = {}): Promise<Reminder> {
  requirePermission(ctx.permissions, "invoices.issue");
  const input = reminderInput.parse(raw);
  const now = today(ctx.organization.timezone);
  return withTenant(ctx.organization.id, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice) throw new NotFoundError();
    const open = openCents(invoice);
    if (invoice.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID"].includes(invoice.status) || !invoice.dueDate || invoice.dueDate >= now || open <= 0) {
      throw new ReminderError("NOT_OVERDUE");
    }
    const [last] = await tx
      .select({ level: paymentReminders.level })
      .from(paymentReminders)
      .where(eq(paymentReminders.invoiceId, invoiceId))
      .orderBy(desc(paymentReminders.level))
      .limit(1);
    const level = (last?.level ?? 0) + 1;
    if (level > MAX_REMINDER_LEVEL) throw new ReminderError("MAX_LEVEL");
    const [row] = await tx
      .insert(paymentReminders)
      .values({
        organizationId: ctx.organization.id,
        invoiceId,
        level,
        issueDate: now,
        dueDate: addDays(now, PAY_WITHIN_DAYS),
        openCents: open,
        feeCents: input.feeCents,
      })
      .returning();
    await audit(tx, ctx, "reminder.create", "invoice", invoiceId, { level, open, fee: input.feeCents });
    return row;
  });
}

export async function listReminders(ctx: Context, invoiceId: string): Promise<Reminder[]> {
  requirePermission(ctx.permissions, "invoices.read");
  return withTenant(ctx.organization.id, (tx) =>
    tx.select().from(paymentReminders).where(eq(paymentReminders.invoiceId, invoiceId)).orderBy(asc(paymentReminders.level)),
  );
}

export async function markReminderSent(ctx: Context, id: string): Promise<void> {
  await withTenant(ctx.organization.id, (tx) => tx.update(paymentReminders).set({ sentAt: new Date() }).where(eq(paymentReminders.id, id)));
}

/** What the reminder PDF needs: the frozen parties of the invoice. */
export async function reminderData(ctx: Context, id: string) {
  requirePermission(ctx.permissions, "invoices.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [reminder] = await tx.select().from(paymentReminders).where(eq(paymentReminders.id, id)).limit(1);
    if (!reminder) throw new NotFoundError();
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, reminder.invoiceId)).limit(1);
    if (!invoice?.number) throw new NotFoundError();
    const buyer = (invoice.buyerSnapshot as Party | null) ?? (await clientParty(tx, invoice.clientId));
    const seller = (invoice.sellerSnapshot as Seller | null) ?? sellerOf(ctx.organization);
    return { reminder, invoice, buyer, seller };
  });
}

/** Overdue invoices with their last reminder level — for the list and the morning summary. */
export async function overdueInvoices(ctx: Context) {
  requirePermission(ctx.permissions, "invoices.read");
  const now = today(ctx.organization.timezone);
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select({
        id: invoices.id,
        number: invoices.number,
        dueDate: invoices.dueDate,
        openCents: sql<number>`${invoices.grossCents} - ${invoices.paidCents} - ${invoices.creditedCents}`,
        level: sql<number>`coalesce((select max(level) from payment_reminders r where r.invoice_id = ${invoices.id}), 0)::int`,
        client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName },
      })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"]), lt(invoices.dueDate, now)))
      .orderBy(asc(invoices.dueDate));
    return rows.map((r) => ({ ...r, openCents: Number(r.openCents), level: Number(r.level), clientName: displayName(r.client) }));
  });
}
