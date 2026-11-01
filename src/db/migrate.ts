/**
 * Bring the database up to date: the generated migrations, then the Row
 * Level Security rules. Runs once when the server starts (instrumentation.ts)
 * and before every test file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { databaseUrl, getDb } from "./client";

const root = () => process.env.ERP_ROOT ?? process.cwd();

export async function migrateDatabase(): Promise<void> {
  const db = getDb();
  const migrationsFolder = path.join(root(), "db", "migrations");
  if (databaseUrl().startsWith("pglite:")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db as never, { migrationsFolder });
  }
  const rls = await readFile(path.join(root(), "db", "rls.sql"), "utf8");
  // Several statements at once: only the drivers' own simple-query calls
  // take that (a prepared statement holds exactly one).
  const client = (db as unknown as { $client: { exec?: (q: string) => Promise<unknown>; unsafe?: (q: string) => Promise<unknown> } }).$client;
  if (client.exec) await client.exec(rls);
  else if (client.unsafe) await client.unsafe(rls);
  else throw new Error("migrate: driver cannot run a script");
}
