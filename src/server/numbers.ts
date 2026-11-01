/**
 * Running numbers per company: clients, orders, invoices.
 *
 * One row per company and key, raised inside the transaction that uses the
 * number — if that transaction fails, the number is not used either, so
 * invoice numbers have no gaps.
 */
import { sql } from "drizzle-orm";
import { counters } from "@/db/schema";
import type { Tx } from "@/db/tenant";

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
