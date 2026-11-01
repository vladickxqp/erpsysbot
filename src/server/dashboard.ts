/**
 * The business overview — every figure from a database query, none invented.
 *
 * Each figure is only computed (and shown) for people allowed to see the
 * module behind it.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { clients, invoices, orders } from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/domain";
import type { Context } from "./context";
import { today } from "./money";
import { requirePermission } from "./permissions";

export type ClientStats = {
  total: number;
  active: number;
  leads: number;
  newThisMonth: number;
  newLastMonth: number;
  /** New clients per month, oldest first: { month: "2026-06", count }. */
  growth: { month: string; count: number }[];
};

export async function clientStats(ctx: Context, months = 6): Promise<ClientStats> {
  requirePermission(ctx.permissions, "clients.read");
  const tz = ctx.organization.timezone;
  return withTenant(ctx.organization.id, async (tx) => {
    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${clients.status} = 'ACTIVE')::int`,
        leads: sql<number>`count(*) filter (where ${clients.status} = 'LEAD')::int`,
        newThisMonth: sql<number>`count(*) filter (where date_trunc('month', ${clients.createdAt} at time zone ${tz}) = date_trunc('month', now() at time zone ${tz}))::int`,
        newLastMonth: sql<number>`count(*) filter (where date_trunc('month', ${clients.createdAt} at time zone ${tz}) = date_trunc('month', now() at time zone ${tz}) - interval '1 month')::int`,
      })
      .from(clients);
    const rows = await tx.execute<{ month: string; count: number }>(sql`
      select to_char(m, 'YYYY-MM') as month,
             (select count(*)::int from ${clients}
               where date_trunc('month', ${clients.createdAt} at time zone ${tz}) = m) as count
        from generate_series(
               date_trunc('month', now() at time zone ${tz}) - make_interval(months => ${months - 1}),
               date_trunc('month', now() at time zone ${tz}),
               interval '1 month') as m
       order by m`);
    const result = rows as unknown as { rows?: { month: string; count: number }[] } | { month: string; count: number }[];
    const growth = Array.isArray(result) ? result : (result.rows ?? []);
    return { ...counts, growth: growth.map((g) => ({ month: g.month, count: Number(g.count) })) };
  });
}

export type InvoiceStats = { outstandingCents: number; outstanding: number; overdue: number; overdueCents: number };

/** What clients still owe: issued, not fully paid invoices (credit notes excluded). */
export async function invoiceStats(ctx: Context): Promise<InvoiceStats> {
  requirePermission(ctx.permissions, "invoices.read");
  const now = today(ctx.organization.timezone);
  return withTenant(ctx.organization.id, async (tx) => {
    const open = sql`${invoices.grossCents} - ${invoices.paidCents}`;
    const late = sql`${invoices.dueDate} < ${now}`;
    const [row] = await tx
      .select({
        outstandingCents: sql<number>`coalesce(sum(${open}), 0)::bigint`,
        outstanding: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) filter (where ${late})::int`,
        overdueCents: sql<number>`coalesce(sum(${open}) filter (where ${late}), 0)::bigint`,
      })
      .from(invoices)
      .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"])));
    return {
      outstandingCents: Number(row.outstandingCents),
      outstanding: Number(row.outstanding),
      overdue: Number(row.overdue),
      overdueCents: Number(row.overdueCents),
    };
  });
}

export async function openOrderStats(ctx: Context): Promise<{ count: number; netCents: number }> {
  requirePermission(ctx.permissions, "orders.read");
  return withTenant(ctx.organization.id, async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int`, netCents: sql<number>`coalesce(sum(${orders.netCents}), 0)::bigint` })
      .from(orders)
      .where(inArray(orders.status, OPEN_STATUSES));
    return { count: Number(row.count), netCents: Number(row.netCents) };
  });
}
