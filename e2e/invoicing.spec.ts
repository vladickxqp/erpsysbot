import { expect, test, type Page } from "@playwright/test";

const password = "Tq7-vexo-Lumen-92!";

async function mails(page: Page): Promise<string[]> {
  return (await page.request.get("http://127.0.0.1:3326/mails")).json();
}

/** A new company whose owner confirmed the address, with what an invoice needs. */
async function company(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("Rechnung Werkstatt GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Rita Rechnung");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "IT-Unternehmen" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
  await expect.poll(async () => (await mails(page)).filter((m) => m.includes(email)).length).toBeGreaterThan(0);
  const mail = (await mails(page)).filter((m) => m.includes(email)).pop()!;
  const link = /\/verify\/[\w-]+/.exec(mail.replace(/=\n/g, ""))![0];
  await page.goto(link);
  await page.goto("/app/settings");
  const form = page.locator("form").first();
  await form.getByLabel("Straße und Nr.").fill("Hauptstraße 1");
  await form.getByLabel("PLZ").fill("68159");
  await form.getByLabel("Ort").fill("Mannheim");
  await form.getByLabel("Steuernummer").fill("38/123/45678");
  await form.getByLabel("USt-IdNr.").fill("DE123456789");
  await form.getByLabel("E-Mail").fill("rechnung@werkstatt.example");
  await form.getByLabel("Telefon").fill("+49 621 123456");
  await form.getByLabel("IBAN").fill("DE89370400440532013000");
  await form.getByLabel("BIC").fill("COBADEFFXXX");
  await form.getByLabel("Bank", { exact: true }).fill("Commerzbank");
  await form.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert")).toBeVisible();
}

async function newCustomer(page: Page, name: string, mail: string) {
  await page.getByRole("button", { name: "Neuer Kunde" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Firmenname").fill(name);
  await dialog.getByLabel("Straße").fill("Weg 2");
  await dialog.getByLabel("PLZ").fill("10115");
  await dialog.getByLabel("Ort").fill("Berlin");
  await dialog.getByLabel("E-Mail").fill(mail);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();
}

test("from the first customer to the delivered invoice and its credit note", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await company(page, `rechnung-${Date.now()}@example.org`);

  // Writing it: the figures follow every key press.
  await page.goto("/app/invoices/new");
  await newCustomer(page, "Kunde AG", "einkauf@kunde.example");
  await page.getByLabel("Titel").fill("Wartung November");
  await page.getByLabel("1. Beschreibung").fill("Wartung Anlage");
  await page.getByLabel("Menge", { exact: true }).fill("2");
  await page.getByLabel("Einzelpreis (netto)").fill("100");
  const total = page.getByTestId("invoice-total").first();
  await expect(total).toContainText("238,00");
  await page.getByLabel("Rabatt %").fill("10");
  await expect(total).toContainText("214,20");
  await page.getByRole("button", { name: "Position hinzufügen" }).click();
  await page.getByLabel("2. Beschreibung").fill("Anfahrt");
  await page.getByLabel("Einzelpreis (netto)").nth(1).fill("50");
  await expect(total).toContainText("273,70");
  await expect(page.getByTestId("invoice-paper").first()).toContainText("Wartung November");

  await page.getByRole("button", { name: "Rechnung erstellen" }).click();
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /RE-\d{4}-0001/ })).toBeVisible();

  // The files.
  const id = page.url().split("/").pop();
  const pdf = await page.request.get(`/app/invoices/${id}/pdf`);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const xml = await page.request.get(`/app/invoices/${id}/xrechnung`);
  expect(await xml.text()).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
  const zugferd = await page.request.get(`/app/invoices/${id}/zugferd`);
  expect((await zugferd.body()).includes("factur-x.xml")).toBe(true);

  // A refused mail leaves it unsent, and the history says so.
  await page.getByRole("button", { name: "Rechnung senden" }).click();
  await page.getByRole("dialog").getByLabel("An", { exact: true }).fill("refuse@kunde.example");
  await page.getByRole("dialog").getByRole("button", { name: "Senden" }).click();
  await expect(page.getByText("Der Mailserver hat die Nachricht nicht angenommen")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByText("fehlgeschlagen").first()).toBeVisible();
  await expect(page.getByText("Versendet", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Rechnung senden" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Senden" }).click();
  await expect(page.getByText("Versendet", { exact: true })).toBeVisible();
  await expect(page.getByText("einkauf@kunde.example")).toBeVisible();
  const delivered = (await mails(page)).find((m) => m.includes("einkauf@kunde.example"));
  expect(delivered).toContain("RE-");
  expect(delivered).toContain("application/pdf");

  // The list.
  await page.goto("/app/invoices");
  await page.getByRole("button", { name: "Betrag" }).click();
  await page.waitForURL(/sort=total/);
  const actions = page.getByRole("button", { name: "Aktionen" }).first();
  await actions.click();
  await page.getByRole("menuitem", { name: "Vorschau" }).click();
  await expect(page.getByTestId("invoice-paper")).toContainText("Wartung November");
  await page.keyboard.press("Escape");
  await actions.click();
  await page.getByRole("menuitem", { name: "Duplizieren" }).click();
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Entwurf" })).toBeVisible();

  // A credit note for one line.
  await page.goto(`/app/invoices/${id}`);
  await page.getByRole("button", { name: "Gutschrift erstellen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Anfahrt" }).click();
  await dialog.getByLabel("Grund").fill("Anfahrt entfiel");
  await dialog.getByRole("button", { name: "Gutschrift erstellen" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith(id!));
  await expect(page.getByRole("heading", { name: /GS-\d{4}-0001/ })).toBeVisible();
  await page.goto(`/app/invoices/${id}`);
  await expect(page.getByText("Gutgeschrieben")).toBeVisible();
  expect(problems).toEqual([]);
});

test("on a phone the invoice fits the screen and shows its preview", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await company(page, `handy-${Date.now()}@example.org`);
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto("/app/invoices/new");
  await fits();
  await newCustomer(page, "Handy AG", "handy@kunde.example");
  await page.getByLabel("1. Beschreibung").fill("Beratung");
  await page.getByLabel("Einzelpreis (netto)").fill("100");
  await fits();
  await page.getByRole("button", { name: "Vorschau" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("invoice-paper")).toContainText("Beratung");
  await sheet.getByRole("button", { name: "Rechnung erstellen" }).click();
  await page.waitForURL(/\/app\/invoices\/[0-9a-f-]{36}$/);
  await fits();
  await page.goto("/app/invoices");
  await fits();
  await expect(page.getByRole("button", { name: "Aktionen" }).first()).toBeVisible();
});
