// Draws the first moment of the landscape as the pictures that show before the
// live scene starts, and instead of it where it cannot run.
//
//   node scripts/render-landing-poster.mjs <output-folder>
//
// Set PLAYWRIGHT_CHANNEL to use an installed browser (chrome, msedge).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import ts from "typescript";

const [out] = process.argv.slice(2);
if (!out) throw new Error("usage: render-landing-poster.mjs <output-folder>");

const source = await readFile("src/components/landing/backdrop-gl.ts", "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, args: ["--use-angle=default", "--ignore-gpu-blocklist"] });

for (const [name, width, height, quality] of [
  ["poster-wide.webp", 1920, 1080, 0.82],
  ["poster-tall.webp", 720, 1280, 0.8],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<canvas id="c" style="position:fixed;inset:0;width:${width}px;height:${height}px"></canvas>`);
  const picture = await page.evaluate(
    async ({ moduleUrl, quality }) => {
      const { createScene } = await import(moduleUrl);
      const canvas = document.getElementById("c");
      const scene = createScene(canvas, { small: false });
      if (!scene) throw new Error("no WebGL 2 in this browser");
      scene.draw(0);
      return canvas.toDataURL("image/webp", quality);
    },
    { moduleUrl, quality },
  );
  const bytes = Buffer.from(picture.split(",")[1], "base64");
  await writeFile(join(out, name), bytes);
  console.log(`${name}: ${Math.round(bytes.length / 1024)} KB`);
  await page.close();
}

await browser.close();
