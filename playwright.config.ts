import { defineConfig } from "@playwright/test";

const port = 3322;

/**
 * The main ways through the app in a real browser, against the production
 * build with its own throw-away database. Locally a browser that is already
 * installed will do: PLAYWRIGHT_CHANNEL=msedge npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "line",
  use: { baseURL: `http://localhost:${port}`, channel: process.env.PLAYWRIGHT_CHANNEL, locale: "de-DE" },
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: "pglite:./.data/e2e", REGISTRATION: "open", APP_URL: `http://localhost:${port}`, ANTHROPIC_API_KEY: "" },
  },
});
