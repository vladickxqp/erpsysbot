/**
 * Bring the database up to date: the generated migrations, then the Row
 * Level Security rules. Runs once when the server starts (instrumentation.ts)
 * and before every test file.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { databaseUrl, getDb } from "./client";

const root = () => process.env.ERP_ROOT ?? process.cwd();

const NOT_YET = new Set(["57P03", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "CONNECT_TIMEOUT"]);

/** Postgres is still starting or not reachable yet (also when wrapped by the ORM). */
export function notReadyYet(e: unknown): boolean {
  const err = e as { code?: string; cause?: unknown } | null;
  if (!err) return false;
  return NOT_YET.has(String(err.code ?? "")) || (err.cause !== undefined && err.cause !== e && notReadyYet(err.cause));
}

/** After a reboot the app can come up before the database takes connections: try again for a while. */
export async function waitForDatabase(probe: () => Promise<unknown>, tries = 30, pauseMs = 2000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await probe();
      return;
    } catch (e) {
      if (attempt >= tries || !notReadyYet(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
}

export async function migrateDatabase(): Promise<void> {
  const db = getDb();
  // Several statements at once: only the drivers' own simple-query calls
  // take that (a prepared statement holds exactly one).
  const client = (db as unknown as { $client: { exec?: (q: string) => Promise<unknown>; unsafe?: (q: string) => Promise<unknown> } }).$client;
  const migrationsFolder = path.join(root(), "db", "migrations");
  if (databaseUrl().startsWith("pglite:")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    if (client.unsafe) await waitForDatabase(() => client.unsafe!("select 1"));
    await migrate(db as never, { migrationsFolder });
  }
  const rls = await readFile(path.join(root(), "db", "rls.sql"), "utf8");
  if (client.exec) await client.exec(rls);
  else if (client.unsafe) await client.unsafe(rls);
  else throw new Error("migrate: driver cannot run a script");
}
