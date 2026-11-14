import { expect, test, type Page } from "@playwright/test";

const email = `e2e-digital-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Konten GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Nico Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a digital product hands the buyer its code once the order is paid", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  await page.goto("/app/settings");
  const company = page.locator("form").filter({ has: page.getByLabel("IBAN") });
  await company.getByLabel("Straße und Nr.").fill("Hauptstr. 1");
  await company.getByLabel("PLZ", { exact: true }).fill("10115");
  await company.getByLabel("Ort", { exact: true }).fill("Berlin");
  await company.getByLabel("E-Mail", { exact: true }).fill("konten@example.org");
  await company.getByLabel("IBAN").fill("DE89370400440532013000");
  await company.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  // A digital product with two accounts in its pool.
  await page.goto("/app/products/new");
  await page.getByLabel("Name", { exact: true }).fill("Spielkonto");
  await page.getByLabel("Preis netto", { exact: true }).fill("10,00");
  await page.getByRole("combobox", { name: "Versand", exact: true }).click();
  await page.getByRole("option", { name: /^Digital/ }).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL(/\/app\/products\/[0-9a-f-]{36}/);
  const productUrl = page.url();
  await page.getByRole("tab", { name: "Digital" }).click();
  await page.getByRole("textbox", { name: "Neue Einträge, einer je Zeile" }).fill("konto-eins:geheim-12345\nkonto-zwei:geheim-67890");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(page.getByText("Verfügbar: 2")).toBeVisible();
  await expect(page.getByText("geheim")).toHaveCount(0);

  // The shop: shipping, legal pages, prepayment, online.
  await page.goto("/app/store");
  await page.getByLabel("Name").fill("E2E Konten");
  await page.getByRole("button", { name: "Neuer Shop" }).click();
  await page.waitForURL(/\/app\/store\/[0-9a-f-]{36}/);
  const shopHref = await page.getByRole("link", { name: "Shop öffnen" }).getAttribute("href");
  await page.getByRole("tab", { name: "Versand" }).click();
  await page.getByRole("button", { name: "Versandart hinzufügen" }).click();
  await page.getByLabel("Versandart").fill("DHL Paket");
  await page.getByLabel("Preis (brutto)").fill("4,90");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();
  await page.getByRole("tab", { name: "Rechtliches" }).click();
  for (const [label, text] of [["Impressum", "E2E Konten GmbH"], ["Datenschutz", "Daten"], ["AGB", "Bedingungen"], ["Widerrufsbelehrung", "Widerruf"]]) {
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

  // A visitor buys one account by bank transfer: no shipping to pay, nothing shown before payment.
  const visitor = await page.context().browser()!.newPage({ baseURL: new URL(page.url()).origin, locale: "de-DE" });
  await visitor.goto(shopHref!);
  await visitor.getByRole("link", { name: "Alle Produkte" }).first().click();
  await visitor.waitForURL(/\/products$/);
  await visitor.getByRole("link", { name: /Spielkonto/ }).first().click();
  await visitor.waitForURL(/\/p\/[0-9a-f-]{36}$/);
  await visitor.getByRole("button", { name: "In den Warenkorb" }).click();
  await visitor.getByRole("link", { name: "Zum Warenkorb" }).click();
  await visitor.getByRole("link", { name: "Zur Kasse" }).click();
  await visitor.getByLabel("E-Mail", { exact: true }).fill("kundin@example.org");
  await visitor.getByLabel("Vorname").fill("Eva");
  await visitor.getByLabel("Nachname").fill("Muster");
  await visitor.getByLabel("Straße und Hausnummer").fill("Weg 1");
  await visitor.getByLabel("PLZ", { exact: true }).fill("20095");
  await visitor.getByLabel("Ort", { exact: true }).fill("Hamburg");
  await visitor.getByRole("checkbox").last().check();
  await visitor.getByRole("button", { name: "Zahlungspflichtig bestellen" }).click();
  await visitor.waitForURL(/\/order\/[A-Za-z0-9_-]+$/);
  const orderUrl = visitor.url();
  await expect(visitor.getByText(/11,90/).first()).toBeVisible();
  await expect(visitor.getByText("Ihre digitalen Artikel")).toHaveCount(0);

  // The company marks the transfer as paid: the order is done, the buyer has the account.
  await page.goto("/app/orders?flow=toShip");
  await page.getByRole("link", { name: /Muster/ }).first().click();
  await page.waitForURL(/\/app\/orders\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Als bezahlt markieren" }).click();
  await expect(page.getByText("Bezahlt", { exact: true }).first()).toBeVisible();

  await visitor.goto(orderUrl);
  await expect(visitor.getByText("Ihre digitalen Artikel")).toBeVisible();
  await expect(visitor.getByText(/konto-(eins|zwei):geheim-\d{5}/)).toHaveCount(1);

  await page.goto(productUrl);
  await page.getByRole("tab", { name: "Digital" }).click();
  await expect(page.getByText("Verfügbar: 1")).toBeVisible();
  await expect(page.getByText("Verkauft: 1")).toBeVisible();
  expect(problems).toEqual([]);
});
