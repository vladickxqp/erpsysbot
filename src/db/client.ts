/**
 * One database connection for the whole server.
 *
 * Production (Docker): PostgreSQL through postgres-js, DATABASE_URL =
 * postgres://… . Development and tests: PGlite, real PostgreSQL compiled to
 * WebAssembly, so nothing has to be installed — DATABASE_URL = pglite:memory
 * (gone on restart) or pglite:./.data/pglite (kept on disk).
 *
 * Both speak the same SQL, Row Level Security included.
 */
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: Database; close?: () => Promise<void> };
// Next.js reloads modules while developing; one connection must survive that.
const holder = globalThis as unknown as { __erpDb?: Holder };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "pglite:memory";
}

export function getDb(): Database {
  holder.__erpDb ??= {};
  const h = holder.__erpDb;
  if (h.db) return h.db;
  const url = databaseUrl();
  if (url.startsWith("pglite:")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    const where = url.slice("pglite:".length);
    const client = where === "memory" || where === "" ? new PGlite() : new PGlite(where);
    h.db = drizzleLite(client, { schema }) as unknown as Database;
    h.close = () => client.close();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require("postgres") as typeof import("postgres");
    const client = postgres(url, { max: 10, prepare: false });
    h.db = drizzlePg(client, { schema }) as unknown as Database;
    h.close = () => client.end();
  }
  return h.db;
}

/** For tests: drop the connection so the next getDb() starts fresh. */
export async function resetDb(): Promise<void> {
  const h = holder.__erpDb;
  if (h?.close) await h.close();
  holder.__erpDb = {};
}
