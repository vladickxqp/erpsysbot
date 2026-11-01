/**
 * The business overview — every figure from a database query, none invented.
 *
 * Grows with the modules: today it knows clients; orders, invoices and
 * money join as those modules land, and a figure whose module does not exist
 * yet is not shown at all rather than shown as zero.
 */
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { clients } from "@/db/schema";
import type { Context } from "./context";
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
