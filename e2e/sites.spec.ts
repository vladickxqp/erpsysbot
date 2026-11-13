import { expect, test, type Page } from "@playwright/test";

const email = `e2e-sites-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";
/** A one-pixel PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Elektro GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Jan Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a company website is built, published, and a visitor's message becomes a lead", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  // The imprint needs the company's address.
  await page.goto("/app/settings");
  const company = page.locator("form").filter({ has: page.getByLabel("IBAN") });
  await company.getByLabel("Straße und Nr.").fill("Hafenweg 2");
  await company.getByLabel("PLZ", { exact: true }).fill("20457");
  await company.getByLabel("Ort", { exact: true }).fill("Hamburg");
  await company.getByLabel("E-Mail", { exact: true }).fill("elektro@example.org");
  await company.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  await page.goto("/app/sites");
  await page.getByRole("radio", { name: /Firmenwebsite/ }).click();
  await page.getByLabel("Name").fill("E2E Elektro");
  await page.getByRole("button", { name: "Website erstellen" }).click();
  await page.waitForURL(/\/app\/sites\/[0-9a-f-]{36}/);
  const siteHref = await page.getByRole("link", { name: "Website öffnen" }).getAttribute("href");
  expect(siteHref).toMatch(/^\/shop\/e2e-elektro/);

  // The placeholders of the first draft: a real sentence in the title area, the services hidden for now.
  await page.getByRole("tab", { name: "Startseite" }).click();
  await page.getByRole("button", { name: /Titelbereich/ }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Elektrik und Photovoltaik aus Hamburg");
  await page.locator('[data-slot="card"]').filter({ hasText: "Leistungen" }).getByRole("button", { name: "Ausblenden" }).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  await page.getByRole("tab", { name: "Rechtliches" }).click();
  await page.getByRole("textbox", { name: /^Impressum/ }).fill("E2E Elektro GmbH, Hafenweg 2, 20457 Hamburg");
  await page.getByRole("textbox", { name: /^Datenschutz/ }).fill("Wir speichern Anfragen, um sie zu beantworten.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  // A logo uploaded right where it is chosen.
  await page.getByRole("tab", { name: "Design" }).click();
  await page.locator('input[type="file"][accept^="image/png"]').first().setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await expect(page.getByRole("combobox", { name: "Logo" })).toContainText("logo.png");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  await page.getByRole("tab", { name: "Veröffentlichen" }).click();
  await page.getByRole("button", { name: "Veröffentlichen", exact: true }).click();
  await expect(page.getByText("Online", { exact: true }).first()).toBeVisible();

  // A visitor without an account: the page, no shop parts, the contact form.
  const visitor = await page.context().browser()!.newPage({ baseURL: new URL(page.url()).origin, locale: "de-DE" });
  await visitor.goto(siteHref!);
  await expect(visitor.getByRole("heading", { level: 1, name: "E2E Elektro" })).toBeVisible();
  await expect(visitor.getByRole("img", { name: "E2E Elektro" }).first()).toBeVisible();
  await expect(visitor.getByText("Elektrik und Photovoltaik aus Hamburg")).toBeVisible();
  await expect(visitor.getByText("[Leistung 1]")).toHaveCount(0);
  await expect(visitor.getByRole("link", { name: "Warenkorb" })).toHaveCount(0);
  await visitor.getByLabel("Name").fill("Eva Muster");
  await visitor.getByLabel("E-Mail").fill("eva.muster@example.org");
  await visitor.getByLabel("Nachricht").fill("Bitte um ein Angebot für eine Wallbox.");
  await visitor.getByRole("checkbox").check();
  await visitor.getByRole("button", { name: "Senden" }).click();
  await expect(visitor.getByText("Danke! Ihre Nachricht ist angekommen.")).toBeVisible();

  // The message is a lead in the CRM.
  await page.goto("/app/clients");
  await expect(page.getByText(/Muster/).first()).toBeVisible();
  expect(problems).toEqual([]);
});
