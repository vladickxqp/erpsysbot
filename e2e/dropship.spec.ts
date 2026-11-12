import { expect, test, type Page } from "@playwright/test";

const email = `e2e-dropship-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Direkt GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Noah Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Dropshipping" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a supplier ships an order straight to the customer", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  // A supplier that ships directly; orders go to it by hand, before the customer paid.
  await page.goto("/app/purchasing?tab=suppliers");
  await page.getByRole("button", { name: "Neuer Lieferant" }).click();
  const newSupplier = page.getByRole("dialog");
  await newSupplier.getByLabel("Lieferant", { exact: true }).fill("Taschen AG");
  await newSupplier.getByRole("button", { name: "Speichern" }).click();
  await expect(newSupplier).toBeHidden();
  await page.getByRole("link", { name: /Taschen AG/ }).click();
  await page.waitForURL(/\/app\/purchasing\/suppliers\/[0-9a-f-]{36}/);
  const direct = page.locator("form").filter({ has: page.getByRole("checkbox", { name: "Liefert direkt an Kunden" }) });
  await direct.getByRole("checkbox", { name: "Liefert direkt an Kunden" }).check();
  await direct.getByRole("checkbox", { name: "Erst nach Zahlung des Kunden" }).uncheck();
  await direct.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Eingerichtet", { exact: true })).toBeVisible();

  // A bag the supplier ships, five reported at the supplier.
  await page.goto("/app/products/new");
  await page.getByLabel("Name", { exact: true }).fill("Tasche");
  await page.getByLabel("Preis netto", { exact: true }).fill("50,00");
  await page.getByRole("combobox", { name: "Versand", exact: true }).click();
  await page.getByRole("option", { name: "Direkt vom Lieferanten" }).click();
  await expect(page.getByRole("checkbox", { name: "Lagerbestand führen" })).toBeHidden();
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL(/\/app\/products\/[0-9a-f-]{36}/);
  await page.getByRole("tab", { name: "Lieferanten" }).click();
  await page.getByRole("button", { name: "Lieferant hinzufügen" }).click();
  const offer = page.getByRole("dialog");
  await offer.getByLabel("Einkaufspreis", { exact: true }).fill("20,00");
  await offer.getByLabel("Bestand beim Lieferanten").fill("5");
  await offer.getByRole("button", { name: "Speichern" }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByText("Gemeldet", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Taschen AG Stand .* 5 0 0 5/ })).toBeVisible();

  // A customer orders two.
  await page.goto("/app/clients?new=1");
  const client = page.getByRole("dialog");
  await client.getByLabel("Nachname").fill("Kundin");
  await client.getByRole("button", { name: "Speichern" }).click();
  await expect(client).toBeHidden();
  await page.goto("/app/orders/new");
  await page.getByRole("combobox", { name: "Kunde" }).click();
  await page.getByRole("option", { name: /Kundin/ }).click();
  await page.getByRole("combobox", { name: "Produkt" }).click();
  await page.getByRole("option", { name: /Tasche/ }).click();
  await page.getByLabel("Menge").fill("2");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.waitForURL(/\/app\/orders\/[0-9a-f-]{36}$/);

  // Confirmed: the supplier order waits for a yes (a new supplier, always by approval).
  await page.getByRole("button", { name: "Bestätigen & reservieren" }).click();
  await expect(page.getByText("Lieferantenbestellungen")).toBeVisible();
  await expect(page.getByText("Freigabe nötig").first()).toBeVisible();
  await expect(page.getByText("Neuer Lieferant").first()).toBeVisible();
  await page.getByRole("button", { name: "Freigeben" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Freigeben" }).click();
  await expect(page.getByText("Bereit zum Bestellen").first()).toBeVisible();

  // Ordered at the supplier by hand, then shipped by it.
  await page.getByRole("button", { name: "Als bestellt markieren" }).click();
  const ordered = page.getByRole("dialog");
  await ordered.getByLabel("Bestellnr. beim Lieferanten").fill("TA-77");
  await ordered.getByRole("button", { name: "Als bestellt markieren" }).click();
  await expect(ordered).toBeHidden();
  await expect(page.getByText("TA-77").first()).toBeVisible();
  await page.getByRole("button", { name: "Versendet", exact: true }).click();
  const shipped = page.getByRole("dialog");
  await shipped.getByLabel("Versanddienst").fill("DHL");
  await shipped.getByLabel("Sendungsnummer").fill("00340434");
  await shipped.getByRole("button", { name: "Versendet", exact: true }).click();
  await expect(shipped).toBeHidden();
  await expect(page.getByText("Vom Lieferanten versendet").first()).toBeVisible();
  await expect(page.getByText("00340434").first()).toBeVisible();

  // The supplier orders' list knows it.
  await page.goto("/app/purchasing?tab=dropship&filter=all");
  await expect(page.getByText("Lieferantenbestellungen")).toBeVisible();
  await expect(page.getByText("Taschen AG").first()).toBeVisible();
  await expect(page.getByText("Versendet").first()).toBeVisible();
  expect(problems).toEqual([]);
});
