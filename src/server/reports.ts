/**
 * Reports: tables computed from the records, never estimated. Each report is
 * a title, columns and rows — the page shows it, the export writes it as CSV
 * or PDF. Money is in cents.
 */
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { getDb } from "@/db/client";
import { auditLog, clients, invoiceItems, invoices, memberships, orders, transactions, users } from "@/db/schema";
import { displayName } from "./clients";
import type { Context } from "./context";
import { today } from "./money";
import { assertModule } from "./modules";
import { requirePermission, type Permission } from "./permissions";

export type Column = { key: string; label: string; kind: "text" | "money" | "number" | "date" | "percent" };
export type Report = { columns: Column[]; rows: Record<string, string | number | null>[]; totals?: Record<string, number> };

export const REPORTS = ["revenue", "aging", "clients", "products", "acquisition", "orders", "activity"] as const;
export type ReportKind = (typeof REPORTS)[number];

export const REPORT_PERMISSION: Record<ReportKind, Permission> = {
  revenue: "finance.read",
  aging: "invoices.read",
  clients: "invoices.read",
  products: "invoices.read",
  acquisition: "clients.read",
  orders: "orders.read",
  activity: "employees.read",
};

type Rows<T> = { rows?: T[] } | T[];
const rowsOf = <T>(r: Rows<T>): T[] => (Array.isArray(r) ? r : (r.rows ?? []));

export async function buildReport(ctx: Context, kind: ReportKind, from: string, to: string): Promise<Report> {
  assertModule(ctx, "reports");
  requirePermission(ctx.permissions, REPORT_PERMISSION[kind]);
  const org = ctx.organization.id;
  switch (kind) {
    case "revenue":
      return withTenant(org, async (tx) => {
        const result = await tx.execute<{ month: string; income: number; refund: number; expense: number; adjustment: number }>(sql`
          select to_char(date_trunc('month', booked_on), 'YYYY-MM') as month,
                 coalesce(sum(amount_cents) filter (where type = 'INCOME'), 0)::bigint as income,
                 coalesce(sum(amount_cents) filter (where type = 'REFUND'), 0)::bigint as refund,
                 coalesce(sum(amount_cents) filter (where type = 'EXPENSE'), 0)::bigint as expense,
                 coalesce(sum(amount_cents) filter (where type = 'ADJUSTMENT'), 0)::bigint as adjustment
            from ${transactions}
           where booked_on between ${from} and ${to}
           group by 1 order by 1`);
        const rows = rowsOf(result as unknown as Rows<{ month: string; income: number; refund: number; expense: number; adjustment: number }>).map((r) => {
          const income = Number(r.income) - Number(r.refund);
          const expense = Number(r.expense);
          return { month: r.month, income, expense, result: income - expense + Number(r.adjustment) };
        });
        return {
          columns: [
            { key: "month", label: "reports.month", kind: "text" },
            { key: "income", label: "finance.income", kind: "money" },
            { key: "expense", label: "finance.expenses", kind: "money" },
            { key: "result", label: "finance.result", kind: "money" },
          ],
          rows,
          totals: { income: sum(rows, "income"), expense: sum(rows, "expense"), result: sum(rows, "result") },
        };
      });

    case "aging": {
      const now = today(ctx.organization.timezone);
      return withTenant(org, async (tx) => {
        const open = await tx
          .select({ invoice: invoices, client: { companyName: clients.companyName, firstName: clients.firstName, lastName: clients.lastName } })
          .from(invoices)
          .innerJoin(clients, eq(clients.id, invoices.clientId))
          .where(and(eq(invoices.kind, "INVOICE"), inArray(invoices.status, ["ISSUED", "PARTIALLY_PAID"])))
          .orderBy(invoices.dueDate);
        const rows = open.map(({ invoice, client }) => {
          const late = invoice.dueDate ? Math.floor((Date.parse(now) - Date.parse(invoice.dueDate)) / 86_400_000) : 0;
          const bucket = late <= 0 ? "current" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "d90plus";
          return {
            number: invoice.number,
            client: displayName(client),
            due: invoice.dueDate,
            days: Math.max(0, late),
            bucket: `reports.${bucket}`,
            open: Math.round((invoice.grossCents - invoice.paidCents) * (invoice.exchangeRate ?? 1)),
          };
        });
        const totals: Record<string, number> = { open: sum(rows, "open") };
        for (const b of ["current", "d30", "d60", "d90", "d90plus"]) totals[b] = rows.filter((r) => r.bucket === `reports.${b}`).reduce((s, r) => s + r.open, 0);
        return {
          columns: [
            { key: "number", label: "invoices.number", kind: "text" },
            { key: "client", label: "orders.client", kind: "text" },
            { key: "due", label: "invoices.dueDate", kind: "date" },
            { key: "days", label: "reports.daysLate", kind: "number" },
            { key: "bucket", label: "reports.bucket", kind: "text" },
            { key: "open", label: "invoices.open", kind: "money" },
          ],
          rows,
          totals,
        };
      });
    }

    case "clients":
      return withTenant(org, async (tx) => {
        const rows = await tx
          .select({
            clientId: invoices.clientId,
            companyName: clients.companyName,
            firstName: clients.firstName,
            lastName: clients.lastName,
            count: sql<number>`count(*) filter (where ${invoices.kind} = 'INVOICE')::int`,
            net: sql<number>`coalesce(round(sum(${invoices.netCents} * coalesce(${invoices.exchangeRate}, 1))), 0)::bigint`,
            gross: sql<number>`coalesce(round(sum(${invoices.grossCents} * coalesce(${invoices.exchangeRate}, 1))), 0)::bigint`,
          })
          .from(invoices)
          .innerJoin(clients, eq(clients.id, invoices.clientId))
          .where(and(ne(invoices.status, "DRAFT"), gte(invoices.issueDate, from), lte(invoices.issueDate, to)))
          .groupBy(invoices.clientId, clients.companyName, clients.firstName, clients.lastName)
          .orderBy(desc(sql`sum(${invoices.netCents})`))
          .limit(100);
        const mapped = rows.map((r) => ({ client: displayName(r), invoices: Number(r.count), net: Number(r.net), gross: Number(r.gross) }));
        const total = sum(mapped, "net");
        return {
          columns: [
            { key: "client", label: "orders.client", kind: "text" },
            { key: "invoices", label: "invoices.title", kind: "number" },
            { key: "net", label: "lines.net", kind: "money" },
            { key: "share", label: "reports.share", kind: "percent" },
          ],
          rows: mapped.map((r) => ({ ...r, share: total ? r.net / total : 0 })),
          totals: { net: total, invoices: sum(mapped, "invoices") },
        };
      });

    case "products":
      return withTenant(org, async (tx) => {
        const rows = await tx
          .select({
            description: sql<string>`min(${invoiceItems.description})`,
            quantity: sql<number>`sum(${invoiceItems.quantity})`,
            net: sql<number>`sum(${invoiceItems.netCents})::bigint`,
          })
          .from(invoiceItems)
          .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
          .where(and(ne(invoices.status, "DRAFT"), gte(invoices.issueDate, from), lte(invoices.issueDate, to)))
          .groupBy(sql`coalesce(${invoiceItems.productId}::text, lower(${invoiceItems.description}))`)
          .orderBy(desc(sql`sum(${invoiceItems.netCents})`))
          .limit(100);
        const mapped = rows.map((r) => ({ item: r.description, quantity: Number(r.quantity), net: Number(r.net) }));
        return {
          columns: [
            { key: "item", label: "lines.description", kind: "text" },
            { key: "quantity", label: "lines.quantity", kind: "number" },
            { key: "net", label: "lines.net", kind: "money" },
          ],
          rows: mapped,
          totals: { net: sum(mapped, "net") },
        };
      });

    case "acquisition":
      return withTenant(org, async (tx) => {
        const rows = await tx
          .select({
            month: sql<string>`to_char(date_trunc('month', ${clients.createdAt} at time zone ${ctx.organization.timezone}), 'YYYY-MM')`,
            source: sql<string>`coalesce(nullif(${clients.source}, ''), '—')`,
            count: sql<number>`count(*)::int`,
          })
          .from(clients)
          .where(sql`(${clients.createdAt} at time zone ${ctx.organization.timezone})::date between ${from}::date and ${to}::date`)
          .groupBy(sql`1`, sql`2`)
          .orderBy(sql`1`, desc(sql`3`));
        const mapped = rows.map((r) => ({ month: r.month, source: r.source, count: Number(r.count) }));
        return {
          columns: [
            { key: "month", label: "reports.month", kind: "text" },
            { key: "source", label: "reports.source", kind: "text" },
            { key: "count", label: "reports.newClients", kind: "number" },
          ],
          rows: mapped,
          totals: { count: sum(mapped, "count") },
        };
      });

    case "orders":
      return withTenant(org, async (tx) => {
        const rows = await tx
          .select({ status: orders.status, count: sql<number>`count(*)::int`, net: sql<number>`coalesce(sum(${orders.netCents}), 0)::bigint` })
          .from(orders)
          .where(sql`(${orders.createdAt} at time zone ${ctx.organization.timezone})::date between ${from}::date and ${to}::date`)
          .groupBy(orders.status);
        const mapped = rows.map((r) => ({ status: `orders.${r.status}`, count: Number(r.count), net: Number(r.net) }));
        return {
          columns: [
            { key: "status", label: "orders.status", kind: "text" },
            { key: "count", label: "orders.title", kind: "number" },
            { key: "net", label: "lines.net", kind: "money" },
          ],
          rows: mapped,
          totals: { count: sum(mapped, "count"), net: sum(mapped, "net") },
        };
      });

    case "activity": {
      // Names come from the platform tables, read before (never inside) the tenant
      // transaction: a second query while it is open would wait on the same connection.
      const names = new Map(
        (
          await getDb()
            .select({ id: users.id, name: users.name })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.organizationId, org))
        ).map((u) => [u.id, u.name]),
      );
      return withTenant(org, async (tx) => {
        const rows = await tx
          .select({
            userId: auditLog.userId,
            area: sql<string>`split_part(${auditLog.action}, '.', 1)`,
            count: sql<number>`count(*)::int`,
          })
          .from(auditLog)
          .where(sql`(${auditLog.createdAt} at time zone ${ctx.organization.timezone})::date between ${from}::date and ${to}::date`)
          .groupBy(auditLog.userId, sql`2`)
          .orderBy(desc(sql`3`));
        const mapped = rows.map((r) => ({ person: (r.userId && names.get(r.userId)) || "—", area: r.area, count: Number(r.count) }));
        return {
          columns: [
            { key: "person", label: "team.name", kind: "text" },
            { key: "area", label: "reports.area", kind: "text" },
            { key: "count", label: "reports.actions", kind: "number" },
          ],
          rows: mapped,
          totals: { count: sum(mapped, "count") },
        };
      });
    }
  }
}

function sum<T extends Record<string, unknown>>(rows: T[], key: keyof T): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

/** CSV for spreadsheets: semicolon, BOM, formulas neutralised, money as 1234,56. */
export function reportCsv(report: Report, t: (key: string) => string): string {
  const cell = (value: unknown) => {
    const text = value == null ? "" : String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const format = (c: Column, v: string | number | null) => {
    if (v == null) return "";
    if (c.kind === "money") return (Number(v) / 100).toFixed(2).replace(".", ",");
    if (c.kind === "percent") return `${(Number(v) * 100).toFixed(1).replace(".", ",")} %`;
    if (c.kind === "text" && typeof v === "string" && /^[a-z]+\.[A-Za-z0-9_]+$/.test(v)) return t(v);
    return String(v);
  };
  const lines = [report.columns.map((c) => cell(t(c.label))).join(";"), ...report.rows.map((r) => report.columns.map((c) => cell(format(c, r[c.key] ?? null))).join(";"))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export const PERIODS = ["thisMonth", "lastMonth", "thisQuarter", "thisYear", "lastYear", "last12"] as const;
export type Period = (typeof PERIODS)[number];

/** A named period, or explicit from/to, as ISO dates in the company's time zone. */
export function resolvePeriod(ctx: Context, period?: string, from?: string, to?: string): { from: string; to: string; period: Period | "custom" } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (from && to && iso.test(from) && iso.test(to)) return from <= to ? { from, to, period: "custom" } : { from: to, to: from, period: "custom" };
  const now = today(ctx.organization.timezone);
  const [y, m] = now.split("-").map(Number);
  const d = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  switch (period) {
    case "lastMonth":
      return { from: d(y, m - 1, 1), to: d(y, m, 0), period };
    case "thisQuarter":
      return { from: d(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: now, period };
    case "thisYear":
      return { from: d(y, 1, 1), to: now, period };
    case "lastYear":
      return { from: d(y - 1, 1, 1), to: d(y - 1, 12, 31), period };
    case "last12":
      return { from: d(y, m - 11, 1), to: now, period };
    default:
      return { from: d(y, m, 1), to: now, period: "thisMonth" };
  }
}
