import { afterAll, beforeAll } from "vitest";
import { resetDb } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import { resetThrottle } from "@/server/accounts";

process.env.DATABASE_URL = "pglite:memory";

beforeAll(async () => {
  await resetDb();
  resetThrottle();
  await migrateDatabase();
});

afterAll(async () => {
  await resetDb();
});
