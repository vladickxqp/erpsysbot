import { expect, test, type Page } from "@playwright/test";

const email = `e2e-areas-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Bereiche GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Ida Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a store adds Creator and switches between its two areas", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);
  const menu = page.getByRole("navigation", { name: "Main" });

  // One area: no switcher, the store's entries under its name.
  await expect(page.getByRole("tablist", { name: "Bereiche" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Onlineshop" })).toBeVisible();

  await page.goto("/app/settings");
  const areas = page.getByRole("region", { name: "Bereiche" });
  await areas.getByRole("button", { name: /^Creator/ }).click();
  await areas.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  const switcher = page.getByRole("tablist", { name: "Bereiche" });
  await expect(switcher).toBeVisible();
  await switcher.getByRole("tab", { name: "Creator" }).click();
  await page.waitForURL("**/app");
  await expect(switcher.getByRole("tab", { name: "Creator" })).toHaveAttribute("aria-selected", "true");
  await expect(menu.getByRole("link", { name: "Creator Studio" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Onlineshop" })).toHaveCount(0);

  await switcher.getByRole("tab", { name: "Commerce" }).click();
  await expect(switcher.getByRole("tab", { name: "Commerce" })).toHaveAttribute("aria-selected", "true");
  await expect(menu.getByRole("link", { name: "Onlineshop" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Creator Studio" })).toHaveCount(0);
  expect(problems).toEqual([]);
});
