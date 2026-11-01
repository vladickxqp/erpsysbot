/**
 * Work on one company's data — the only way to reach a tenant table.
 *
 * Inside the transaction the connection becomes the `app_tenant` role and
 * names the company; the policies in db/rls.sql then hide every other
 * company's rows from SELECT, UPDATE and DELETE and refuse INSERTs for them.
 * The company id passed here must come from a verified membership
 * (src/server/context.ts), never from the browser.
 */
import { sql } from "drizzle-orm";
import { getDb, type Database } from "./client";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(organizationId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(organizationId)) throw new Error("withTenant: not a company id");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
    await tx.execute(sql`set local role app_tenant`);
    return work(tx);
  });
}
