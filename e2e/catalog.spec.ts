import { expect, test, type Page } from "@playwright/test";

const email = `e2e-catalog-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Laden GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Ole Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a product with variants, its margin and its place in the list", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  await page.goto("/app/products/new");
  await page.getByLabel("Name", { exact: true }).fill("Shirt");
  await page.getByLabel("Artikelnr.", { exact: true }).fill("TS");
  await page.getByLabel("Preis netto", { exact: true }).fill("20,00");
  await page.getByLabel("Einkaufspreis", { exact: true }).fill("8,00");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL(/\/app\/products\/[0-9a-f-]{36}/);

  await page.getByRole("tab", { name: /Varianten/ }).click();
  await page.getByLabel("Option (z. B. Größe)").fill("Größe");
  await page.getByLabel("Werte").fill("S, M");
  await page.getByRole("button", { name: "Varianten erzeugen" }).click();
  await expect(page.getByRole("cell", { name: "TS-S" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "TS-M" })).toBeVisible();

  // 20 € net, 8 € purchase: 12 € gross margin, 60 %.
  await page.getByRole("tab", { name: "Preise & Marge" }).click();
  await expect(page.getByText("60 %").first()).toBeVisible();

  await page.goto("/app/products?q=ts-m");
  await expect(page.getByRole("link", { name: "Shirt" }).first()).toBeVisible();
  await expect(page.getByText("2 Varianten").first()).toBeVisible();
  expect(problems).toEqual([]);
});
