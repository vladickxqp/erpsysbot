import { expect, test, type Page } from "@playwright/test";

const email = `e2e-store-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Laden GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Lea Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a store is set up, published, and a visitor orders from it", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  // The company's address and bank account: the store needs both.
  await page.goto("/app/settings");
  const company = page.locator("form").filter({ has: page.getByLabel("IBAN") });
  await company.getByLabel("Straße und Nr.").fill("Hauptstr. 1");
  await company.getByLabel("PLZ", { exact: true }).fill("10115");
  await company.getByLabel("Ort", { exact: true }).fill("Berlin");
  await company.getByLabel("E-Mail", { exact: true }).fill("laden@example.org");
  await company.getByLabel("IBAN").fill("DE89370400440532013000");
  await company.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  // A lamp, three on the shelf.
  await page.goto("/app/products/new");
  await page.getByLabel("Name", { exact: true }).fill("Lampe");
  await page.getByLabel("Preis netto", { exact: true }).fill("10,00");
  await page.getByRole("checkbox", { name: "Lagerbestand führen" }).check();
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL(/\/app\/products\/[0-9a-f-]{36}/);
  await page.getByRole("tab", { name: "Lager" }).click();
  await page.getByRole("button", { name: "Bestand zählen" }).first().click();
  const counting = page.getByRole("dialog");
  await counting.getByLabel(/^Gezählt/).fill("3");
  await counting.getByRole("button", { name: "Speichern" }).click();
  await expect(counting).toBeHidden();

  // The store: shipping, the legal pages, prepayment, then online.
  await page.goto("/app/store");
  await page.getByLabel("Name").fill("E2E Laden");
  await page.getByRole("button", { name: "Neuer Shop" }).click();
  await page.waitForURL(/\/app\/store\/[0-9a-f-]{36}/);
  const shopHref = await page.getByRole("link", { name: "Shop öffnen" }).getAttribute("href");
  expect(shopHref).toMatch(/^\/shop\/e2e-laden/);

  await page.getByRole("tab", { name: "Versand" }).click();
  await page.getByRole("button", { name: "Versandart hinzufügen" }).click();
  await page.getByLabel("Versandart").fill("DHL Paket");
  await page.getByLabel("Preis (brutto)").fill("4,90");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  await page.getByRole("tab", { name: "Rechtliches" }).click();
  for (const [label, text] of [["Impressum", "E2E Laden GmbH"], ["Datenschutz", "Daten"], ["AGB", "Bedingungen"], ["Widerrufsbelehrung", "Widerruf"]]) {
    await page.getByLabel(new RegExp(`^${label}`)).fill(text);
  }
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  await page.getByRole("tab", { name: "Zahlung" }).click();
  await page.getByRole("checkbox", { name: "Anbieten" }).first().check();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  await page.getByRole("tab", { name: "Veröffentlichen" }).click();
  await page.getByRole("button", { name: "Veröffentlichen", exact: true }).click();
  await expect(page.getByText("Online", { exact: true }).first()).toBeVisible();

  // A visitor without an account: product, cart, checkout.
  const visitor = await page.context().browser()!.newPage({ baseURL: new URL(page.url()).origin, locale: "de-DE" });
  await visitor.goto(shopHref!);
  // Each click waits for its page: the home page lists the lamp too, and two navigations in a row could cross.
  await visitor.getByRole("link", { name: "Alle Produkte" }).first().click();
  await visitor.waitForURL(/\/products$/);
  await visitor.getByRole("link", { name: /Lampe/ }).first().click();
  await visitor.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  await expect(visitor.getByText(/11,90/).first()).toBeVisible();
  await visitor.getByRole("button", { name: "In den Warenkorb" }).click();
  await visitor.getByRole("link", { name: "Zum Warenkorb" }).click();
  await expect(visitor.getByText(/16,80/).first()).toBeVisible();
  await visitor.getByRole("link", { name: "Zur Kasse" }).click();
  await visitor.getByLabel("E-Mail", { exact: true }).fill("kundin@example.org");
  await visitor.getByLabel("Vorname").fill("Eva");
  await visitor.getByLabel("Nachname").fill("Muster");
  await visitor.getByLabel("Straße und Hausnummer").fill("Weg 1");
  await visitor.getByLabel("PLZ", { exact: true }).fill("20095");
  await visitor.getByLabel("Ort", { exact: true }).fill("Hamburg");
  await visitor.getByRole("checkbox").last().check();
  await visitor.getByRole("button", { name: "Zahlungspflichtig bestellen" }).click();
  await visitor.waitForURL(/\/shop\/e2e-laden[^/]*\/order\/[A-Za-z0-9_-]+$/);
  await expect(visitor.getByText("DE89370400440532013000")).toBeVisible();
  await expect(visitor.getByText("Bestätigt").first()).toBeVisible();

  // The order is in the app, from the store, its lamp reserved.
  await page.goto("/app/orders?flow=toShip");
  await expect(page.getByText(/Muster/).first()).toBeVisible();
  expect(problems).toEqual([]);
});
