import { expect, test, type Page } from "@playwright/test";

const email = `e2e-video-${Date.now()}@example.org`;
const password = "Tq7-vexo-Lumen-92!";

async function signUp(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Firma").fill("E2E Film GmbH");
  await page.locator("#country").selectOption("DE");
  await page.getByLabel("Dein Name").fill("Kim Test");
  await page.getByLabel("E-Mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/app/welcome");
  await page.getByRole("button", { name: "Onlineshop" }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await page.waitForURL("**/app");
}

test("a video is made of scenes in the studio and kept", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy|Hydration/i.test(message.text())) problems.push(message.text());
  });
  await signUp(page);

  // The studio belongs to Creator.
  await page.goto("/app/settings");
  const areas = page.getByRole("region", { name: "Bereiche" });
  await areas.getByRole("button", { name: /^Creator/ }).click();
  await areas.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  await page.goto("/app/video");
  await page.getByRole("radio", { name: /Querformat/ }).click();
  await page.getByLabel("Titel oder Thema").fill("E2E Clip");
  await page.getByRole("button", { name: "Video erstellen", exact: true }).click();
  await page.waitForURL(/\/app\/video\/[0-9a-f-]{36}$/);

  // The first card carries the title; a second scene follows it.
  const scenes = page.locator("[data-scene]");
  await expect(scenes).toHaveCount(1);
  await expect(scenes.first().getByRole("textbox", { name: "Text", exact: true })).toHaveValue("E2E Clip");
  await scenes.first().getByRole("textbox", { name: "Text", exact: true }).fill("Hallo Welt");
  await page.getByRole("button", { name: "Szene hinzufügen" }).click();
  await expect(scenes).toHaveCount(2);
  await scenes.nth(1).getByRole("textbox", { name: "Text", exact: true }).fill("Bis bald");
  await expect(page.getByText("0:06 / 3:00")).toBeVisible();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert").first()).toBeVisible();

  // With ffmpeg on the machine the video is put together; without, the studio says so.
  if (await page.getByText("Auf diesem Server nicht eingerichtet").count()) {
    await expect(page.getByRole("button", { name: "Rendern" })).toBeDisabled();
  } else {
    await page.getByRole("button", { name: "Rendern" }).click();
    await expect(page.getByText("Video ist fertig").first()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("video[controls]")).toBeVisible();
  }

  await page.goto("/app/video");
  await expect(page.getByRole("link", { name: "E2E Clip" }).first()).toBeVisible();
  expect(problems).toEqual([]);
});
