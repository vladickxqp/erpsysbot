import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
import { resetDb } from "@/db/client";
import { migrateDatabase } from "@/db/migrate";
import { resetThrottle } from "@/server/accounts";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "pglite:memory";
// Most tests create many companies; tests/team.test.ts covers the closed case.
process.env.REGISTRATION = "open";

// Issued invoices keep their files: not in the working copy, and gone afterwards.
const files = mkdtempSync(path.join(tmpdir(), "erp-test-"));
process.env.UPLOAD_DIR = files;

beforeAll(async () => {
  await resetDb();
  resetThrottle();
  await migrateDatabase();
});

afterAll(async () => {
  await resetDb();
  rmSync(files, { recursive: true, force: true });
});
