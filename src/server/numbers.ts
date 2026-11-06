/**
 * Running numbers per company: clients, orders, invoices.
 *
 * One row per company and key, raised inside the transaction that uses the
 * number — if that transaction fails, the number is not used either, so
 * invoice numbers have no gaps.
 */
import { and, eq, sql } from "drizzle-orm";
import { counters, invoices } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { formatNumber, numberPeriod } from "./money";

export async function nextNumber(tx: Tx, organizationId: string, key: string): Promise<number> {
  const [row] = await tx
    .insert(counters)
    .values({ organizationId, key, value: 1 })
    .onConflictDoUpdate({
      target: [counters.organizationId, counters.key],
      set: { value: sql`${counters.value} + 1` },
    })
    .returning({ value: counters.value });
  return row.value;
}

/**
 * The next free number of an invoice or credit note for a date. The counter's
 * row stays locked until the transaction ends, so two documents never take the
 * same number; the unique index on invoices is the last line of defence. A
 * number already in use (a changed pattern can lead back to old ones) is
 * passed over.
 */
export async function nextDocumentNumber(tx: Tx, organizationId: string, kind: "invoice" | "credit", pattern: string, isoDate: string): Promise<string> {
  const key = `${kind}-${numberPeriod(pattern, isoDate)}`;
  const [year, month] = isoDate.split("-").map(Number);
  for (;;) {
    const number = formatNumber(pattern, year, await nextNumber(tx, organizationId, key), month);
    const [taken] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.organizationId, organizationId), eq(invoices.number, number)))
      .limit(1);
    if (!taken) return number;
  }
}
