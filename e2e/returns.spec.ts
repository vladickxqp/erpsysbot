import { expect, test, type Page } from "@playwright/test";

const email = `e2e-returns-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Retouren GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Rita Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a parcel is tracked, the buyer returns a lamp and gets the money back", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await signUp(page);

  await page.goto("/app/settings");
  const company = page.locator("form").filter({ has: page.getByLabel("IBAN") });
  await company.getByLabel("Straße und Nr.").fill("Hauptstr. 1");
  await company.getByLabel("PLZ", { exact: true }).fill("10115");
  await company.getByLabel("Ort", { exact: true }).fill("Berlin");
  await company.getByLabel("E-Mail", { exact: true }).fill("retouren@example.org");
  await company.getByLabel("IBAN").fill("DE89370400440532013000");
  await company.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

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

  await page.goto("/app/store");
  await page.getByLabel("Name").fill("E2E Retourenladen");
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
  for (const [label, text] of [["Impressum", "E2E Retouren GmbH"], ["Datenschutz", "Daten"], ["AGB", "Bedingungen"], ["Widerrufsbelehrung", "Widerruf"]]) {
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

  // A visitor orders the lamp and keeps the link to the order.
  const visitor = await page.context().browser()!.newPage({ baseURL: new URL(page.url()).origin, locale: "de-DE" });
  await visitor.goto(shopHref!);
  // Each click waits for its page: the home page lists the lamp too, and two navigations in a row could cross.
  await visitor.getByRole("link", { name: "Alle Produkte" }).first().click();
  await visitor.waitForURL(/\/products$/);
  await visitor.getByRole("link", { name: /Lampe/ }).first().click();
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

  // The company ships it with DHL and marks the transfer as paid.
  await page.goto("/app/orders?flow=toShip");
  await page.getByRole("link", { name: /Muster/ }).first().click();
  await page.waitForURL(/\/app\/orders\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Versenden" }).click();
  const shipping = page.getByRole("dialog");
  await shipping.getByLabel("Versanddienst").fill("DHL");
  await shipping.getByLabel("Sendungsnummer").fill("00340434161234567890");
  await shipping.getByRole("button", { name: "Versenden" }).click();
  await expect(shipping).toBeHidden();
  await expect(page.getByRole("link", { name: /Verfolgen/ })).toHaveAttribute("href", /piececode=00340434161234567890/);
  await expect(page.getByText("Unterwegs", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Als bezahlt markieren" }).click();
  await expect(page.getByText("Bezahlt", { exact: true }).first()).toBeVisible();

  // The buyer follows the parcel and asks for a return of the lamp.
  await visitor.goto(orderUrl);
  await expect(visitor.getByRole("heading", { name: "Sendungen" })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Verfolgen" })).toHaveAttribute("href", /piececode=00340434161234567890/);
  await visitor.getByRole("button", { name: "Rücksendung anfragen" }).click();
  await visitor.getByRole("combobox", { name: "Lampe" }).selectOption("1");
  await visitor.getByRole("textbox", { name: "Beschreibung" }).fill("Passt nicht zum Raum.");
  await visitor.getByRole("button", { name: "Rücksendung anfragen" }).click();
  await expect(visitor.getByText("Danke! Ihre Rücksendung R-1 ist angefragt.")).toBeVisible();

  // The company takes it back and pays the lamp back.
  await page.goto("/app/returns");
  await page.getByRole("link", { name: /Retoure R-1/ }).click();
  await page.waitForURL(/\/app\/returns\/[0-9a-f-]{36}/);
  await expect(page.getByText("Passt nicht zum Raum.")).toBeVisible();
  for (const step of ["Genehmigen", "Ware eingegangen", "Zur Erstattung"]) {
    await page.getByRole("button", { name: step, exact: true }).click();
    await expect(page.getByRole("button", { name: step, exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Erstatten" }).click();
  const refund = page.getByRole("dialog");
  await expect(refund.getByLabel("Betrag")).toHaveValue("11,90");
  await refund.getByRole("combobox", { name: "Art der Erstattung" }).click();
  await page.getByRole("option", { name: "Bereits erstattet" }).click();
  await refund.getByLabel("Referenz").fill("Bar im Laden");
  await refund.getByRole("button", { name: "Erstatten" }).click();
  await expect(refund).toBeHidden();
  await expect(page.getByText("Erstattet", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Bar im Laden")).toBeVisible();
  expect(problems).toEqual([]);
});
