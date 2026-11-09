import { expect, test, type Page } from "@playwright/test";

const email = `e2e-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Werkstatt GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Eva Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "IT-Unternehmen" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("from signing up to a task with what it waits for", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  // The palette opens from the keyboard and finds its way without a mouse.
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("combobox");
  await expect(palette).toBeVisible();
  await palette.fill("Kalender");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/app/calendar**");

  // A sentence becomes a task with a date.
  await page.getByRole("button", { name: "Neue Aufgabe" }).first().click();
  await page.getByRole("textbox", { name: "Neue Aufgabe" }).fill("Angebot schreiben morgen !");
  await expect(page.getByText("Angebot schreiben", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("Aufgabe angelegt")).toBeVisible();

  await page.getByRole("button", { name: "Neue Aufgabe" }).first().click();
  await page.getByRole("textbox", { name: "Neue Aufgabe" }).fill("Angebot versenden");
  await page.getByRole("button", { name: "Anlegen" }).click();

  // What waits for another task cannot be finished first.
  await page.goto("/app/tasks?view=list");
  await page.getByText("Angebot versenden").first().click();
  await page.getByRole("link", { name: "Aufgabe öffnen" }).click();
  await page.waitForURL(/\/app\/tasks\/[0-9a-f-]{36}/);
  await page.getByRole("combobox", { name: "Aufgabe hinzufügen" }).click();
  await page.getByRole("option", { name: "Angebot schreiben" }).click();
  await expect(page.getByText("Wartet auf andere Aufgaben")).toBeVisible();

  // The day knows the task, and nothing was blocked by the content policy.
  await page.goto("/app/today");
  await expect(page.getByText("Angebot schreiben")).toBeVisible();
  expect(problems).toEqual([]);
});

test("the landing page shows prices and the way in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Business" })).toBeVisible();
  await page.getByRole("link", { name: "Anmelden" }).first().click();
  await page.waitForURL("**/login");
});
