import { expect, test, type Page } from "@playwright/test";

const email = `e2e-orders-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Versand GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Mia Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("an order is reserved, shipped with its tracking number and has a packing slip", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  // A product kept in stock, five on the shelf.
  await page.goto("/app/products/new");
  await page.getByLabel("Name", { exact: true }).fill("Lampe");
  await page.getByLabel("Artikelnr.", { exact: true }).fill("L1");
  await page.getByLabel("Preis netto", { exact: true }).fill("50,00");
  await page.getByRole("checkbox", { name: "Lagerbestand führen" }).check();
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL(/\/app\/products\/[0-9a-f-]{36}/);
  const productUrl = page.url();
  await page.getByRole("tab", { name: "Lager" }).click();
  await page.getByRole("button", { name: "Bestand zählen" }).first().click();
  const counting = page.getByRole("dialog");
  await counting.getByLabel(/^Gezählt/).fill("5");
  await counting.getByRole("button", { name: "Speichern" }).click();
  await expect(counting).toBeHidden();

  // A customer.
  await page.goto("/app/clients?new=1");
  const client = page.getByRole("dialog");
  await client.getByLabel("Nachname").fill("Kundin");
  await client.getByRole("button", { name: "Speichern" }).click();
  await expect(client).toBeHidden();

  // The order: two lamps.
  await page.goto("/app/orders/new");
  await page.getByRole("combobox", { name: "Kunde" }).click();
  await page.getByRole("option", { name: /Kundin/ }).click();
  await page.getByRole("combobox", { name: "Produkt" }).click();
  await page.getByRole("option", { name: /Lampe/ }).click();
  await page.getByLabel("Menge").fill("2");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL(/\/app\/orders\/[0-9a-f-]{36}$/);
  const orderUrl = page.url();

  await expect(page.getByText("2 / 5 verfügbar")).toBeVisible();
  await page.getByRole("button", { name: "Bestätigen & reservieren" }).click();
  await expect(page.getByRole("button", { name: "Kommissionieren" })).toBeVisible();

  await page.getByRole("button", { name: "Versenden" }).click();
  const shipping = page.getByRole("dialog");
  await shipping.getByLabel("Versanddienst").fill("DHL");
  await shipping.getByLabel("Sendungsnummer").fill("00340434");
  await shipping.getByRole("button", { name: "Versenden" }).click();
  await expect(shipping).toBeHidden();
  await expect(page.getByRole("button", { name: "Zugestellt" })).toBeVisible();
  await expect(page.getByText("00340434").first()).toBeVisible();

  const slip = await page.request.get(`${orderUrl}/packing-slip`);
  expect(slip.status()).toBe(200);
  expect(slip.headers()["content-type"]).toContain("application/pdf");

  // Two left the shelf, and the order is listed as on its way.
  await page.goto(productUrl);
  await page.getByRole("tab", { name: "Lager" }).click();
  await expect(page.getByText(/^3\s+Stk/).first()).toBeVisible();
  await page.goto("/app/orders?flow=shipped");
  await expect(page.getByText("Versendet").first()).toBeVisible();
  expect(problems).toEqual([]);
});
