import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Tests run outside Next.js: its server-only guard has nothing to guard.
      "server-only": path.resolve(__dirname, "tests/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // PGlite runs real PostgreSQL in-process; one database per test file.
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
