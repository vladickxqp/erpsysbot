import { expect, test, type Page } from "@playwright/test";

const email = `e2e-docs-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Akten GmbH");
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

test("a template becomes a PDF and a Word file, and the Word file turns into a PDF", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  // A text template with placeholders, seen in the preview.
  await page.goto("/app/documents");
  await page.getByRole("link", { name: "Word & PDF" }).click();
  await page.waitForURL("**/app/documents/tools");
  await page.getByLabel("Name", { exact: true }).fill("Begrüßung");
  await page.getByRole("textbox", { name: "Text der Vorlage" }).fill("# Willkommen\n\nHallo von **{{company.name}}** am {{date}}.");
  await expect(page.getByRole("heading", { name: "Willkommen" })).toBeVisible();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Begrüßung/ })).toBeVisible();

  // The document, as PDF and as Word.
  await page.getByRole("tab", { name: "Erstellen" }).click();
  await page.getByRole("button", { name: "Dokument erstellen" }).click();
  await expect(page.getByText("Begrüßung.pdf").first()).toBeVisible();
  await page.getByRole("radio", { name: "Word" }).click();
  await page.getByRole("button", { name: "Dokument erstellen" }).click();
  await expect(page.getByText("Begrüßung.docx").first()).toBeVisible();

  // The Word file becomes a PDF from its row in the list, and opens as one.
  await page.goto("/app/documents");
  await page.getByRole("row", { name: /Begrüßung\.docx/ }).getByRole("button", { name: "Umwandeln" }).click();
  await page.getByRole("menuitem", { name: "In PDF umwandeln" }).click();
  await expect(page.getByText(/Fertig: Begrüßung\.pdf/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Begrüßung.pdf" })).toHaveCount(2);
  const href = await page.getByRole("link", { name: "Begrüßung.pdf" }).first().getAttribute("href");
  const file = await page.request.get(href!);
  expect(file.headers()["content-type"]).toContain("application/pdf");
  expect((await file.body()).subarray(0, 4).toString()).toBe("%PDF");
  expect(problems).toEqual([]);
});
