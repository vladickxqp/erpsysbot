/**
 * Money in and out.
 *
 * Income from invoice payments is booked by recordPayment; everything else
 * (expenses, cash income, refunds, corrections) is entered here. The
 * "result" is income minus refunds and expenses — an operating figure for
 * the owner, explicitly not accounting profit.
 */
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { transactions } from "@/db/schema";
import { audit, type Via } from "./audit";
import { NotFoundError } from "./clients";
import type { Context } from "./context";
import { requirePermission } from "./permissions";

export type Transaction = typeof transactions.$inferSelect;
export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "REFUND", "ADJUSTMENT"] as const;

export const EXPENSE_CATEGORIES = [
  "material",
  "rent",
  "salaries",
  "vehicle",
  "marketing",
  "software",
  "insurance",
  "taxes",
  "travel",
  "other",
] as const;

export const transactionInput = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    amountCents: z.coerce.number().int().refine((v) => v !== 0, "amount"),
    bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((v) => v || null),
    description: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => v || null),
    method: z
      .string()
      .trim()
      .max(30)
      .nullish()
      .transform((v) => v || null),
  })
  // Only a correction may go either way; the rest are amounts, the type says the direction.
  .refine((t) => t.type === "ADJUSTMENT" || t.amountCents > 0, { message: "amount", path: ["amountCents"] });
export type TransactionInput = z.input<typeof transactionInput>;

export async function createTransaction(ctx: Context, raw: TransactionInput, via: Via = "web"): Promise<Transaction> {
  requirePermission(ctx.permissions, "finance.create");
  const input = transactionInput.parse(raw);
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({ ...input, organizationId: ctx.organization.id })
      .returning();
    await audit(tx, ctx, "transaction.create", "transaction", row.id, { type: row.type, amount: row.amountCents }, via);
    return row;
  });
}

/** Only entries made by hand: a payment's income goes with its invoice. */
export async function deleteTransaction(ctx: Context, id: string): Promise<void> {
  requirePermission(ctx.permissions, "finance.create");
  await withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .delete(transactions)
      .where(and(eq(transactions.id, id), isNull(transactions.paymentId)))
      .returning({ id: transactions.id });
    if (!row) throw new NotFoundError();
    await audit(tx, ctx, "transaction.delete", "transaction", id);
  });
}

export async function listTransactions(
  ctx: Context,
  query: { from?: string; to?: string; type?: (typeof TRANSACTION_TYPES)[number]; page?: number; pageSize?: number } = {},
) {
  requirePermission(ctx.permissions, "finance.read");
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const filters: SQL[] = [];
  if (query.from) filters.push(gte(transactions.bookedOn, query.from));
  if (query.to) filters.push(lte(transactions.bookedOn, query.to));
  if (query.type) filters.push(eq(transactions.type, query.type));
  const where = filters.length ? and(...filters) : undefined;
  return withTenant(ctx.organization.id, async (tx) => {
    const rows = await tx
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.bookedOn), desc(transactions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(transactions).where(where);
    return { rows, total, page, pageSize };
  });
}

export type Summary = { incomeCents: number; expenseCents: number; refundCents: number; adjustmentCents: number; resultCents: number };

export async function financeSummary(ctx: Context, from: string, to: string): Promise<Summary> {
  requirePermission(ctx.permissions, "finance.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .select({
        income: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.type} = 'INCOME'), 0)::int`,
        expense: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.type} = 'EXPENSE'), 0)::int`,
        refund: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.type} = 'REFUND'), 0)::int`,
        adjustment: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.type} = 'ADJUSTMENT'), 0)::int`,
      })
      .from(transactions)
      .where(and(gte(transactions.bookedOn, from), lte(transactions.bookedOn, to)));
    const income = Number(row.income);
    const expense = Number(row.expense);
    const refund = Number(row.refund);
    const adjustment = Number(row.adjustment);
    return {
      incomeCents: income,
      expenseCents: expense,
      refundCents: refund,
      adjustmentCents: adjustment,
      resultCents: income - refund - expense + adjustment,
    };
  });
}

/** Income and expenses per month, oldest first: { month: "2026-06", income, expense }. */
export async function monthlyFlow(ctx: Context, months = 6) {
  requirePermission(ctx.permissions, "finance.read");
  const tz = ctx.organization.timezone;
  return withTenant(ctx.organization.id, async (tx) => {
    const result = (await tx.execute(sql`
      select to_char(m, 'YYYY-MM') as month,
        coalesce((select sum(amount_cents) from transactions t
                   where t.type = 'INCOME' and date_trunc('month', t.booked_on) = m), 0)::int
        - coalesce((select sum(amount_cents) from transactions t
                   where t.type = 'REFUND' and date_trunc('month', t.booked_on) = m), 0)::int as income,
        coalesce((select sum(amount_cents) from transactions t
                   where t.type = 'EXPENSE' and date_trunc('month', t.booked_on) = m), 0)::int as expense
      from generate_series(
        date_trunc('month', now() at time zone ${tz}) - make_interval(months => ${months - 1}),
        date_trunc('month', now() at time zone ${tz}),
        interval '1 month') as m
      order by m`)) as unknown as { rows?: { month: string; income: number; expense: number }[] } | { month: string; income: number; expense: number }[];
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    return rows.map((r) => ({ month: r.month, income: Number(r.income), expense: Number(r.expense) }));
  });
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function exportTransactionsCsv(ctx: Context, from?: string, to?: string): Promise<string> {
  requirePermission(ctx.permissions, "finance.export");
  const filters: SQL[] = [];
  if (from) filters.push(gte(transactions.bookedOn, from));
  if (to) filters.push(lte(transactions.bookedOn, to));
  const rows = await withTenant(ctx.organization.id, (tx) =>
    tx
      .select()
      .from(transactions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(transactions.bookedOn)),
  );
  const head = ["date", "type", "amount_eur", "category", "description", "method"].join(";");
  const body = rows.map((r) =>
    [r.bookedOn, r.type, (r.amountCents / 100).toFixed(2).replace(".", ","), r.category, r.description, r.method]
      .map(csvCell)
      .join(";"),
  );
  return "﻿" + [head, ...body].join("\r\n");
}
