import { expect, test } from "@playwright/test";

const email = `e2e-map-${Date.now()}@example.org`;

test("the shipment map opens from the menu without errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration|leaflet/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Karten GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Nico Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill("Tq7-vexo-Lumen-92!");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");

  await page.goto("/app/shipments");
  await expect(page.getByRole("heading", { name: "Sendungen" })).toBeVisible();
  await expect(page.getByText("Keine Sendungen")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
  await page.getByRole("link", { name: "Letzte 14 Tage" }).click();
  await page.waitForURL(/filter=recent/);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  expect(problems).toEqual([]);
});
