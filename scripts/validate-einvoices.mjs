// Hands e-invoices to the official validators and fails when one refuses a file:
//
//   node scripts/validate-einvoices.mjs <folder>
//
// *.ubl.xml, *.cii.xml: the KoSIT validator with the XRechnung configuration
// (Koordinierungsstelle für IT-Standards: the rules of the German standard).
// *.zugferd.pdf: Mustang (ZUGFeRD project), which checks the XML inside and,
// through veraPDF, that the file really is PDF/A-3.
//
// Files named control-* are broken on purpose: they must be refused, or the
// whole check proves nothing.
//
// Needs Java 21 and unzip; the tools are fetched into a temporary folder.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VALIDATOR = "https://github.com/itplr-kosit/validator/releases/download/v1.6.3/validator-1.6.3-standalone.jar";
const CONFIG = "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip";
const MUSTANG = "https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar";

const folder = path.resolve(process.argv[2] ?? "");
const files = readdirSync(folder);
const tools = mkdtempSync(path.join(tmpdir(), "einvoice-"));

async function fetchTo(url, name) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const target = path.join(tools, name);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

const refusals = [];
const accepted = [];
const controls = [];
const refuse = (file, reasons) => {
  if (file.startsWith("control-")) {
    console.log(`refused as it should be: ${file}: ${reasons[0]}`);
    controls.push(file);
  } else refusals.push(`${file}\n${reasons.map((r) => `  ${r}`).join("\n")}`);
};
const accept = (file) => {
  if (file.startsWith("control-")) refusals.push(`${file}\n  accepted although it is broken`);
  else {
    console.log(`ok    ${file}`);
    accepted.push(file);
  }
};
const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function kosit(jar, config) {
  const reports = path.join(tools, "reports");
  mkdirSync(reports);
  const xml = files.filter((f) => f.endsWith(".xml")).map((f) => path.join(folder, f));
  const run = spawnSync("java", ["-jar", jar, "-s", path.join(config, "scenarios.xml"), "-r", config, "-o", reports, ...xml], { encoding: "utf8", maxBuffer: 1 << 26 });
  for (const file of xml) {
    const name = path.basename(file, ".xml");
    let report;
    try {
      report = readFileSync(path.join(reports, `${name}-report.xml`), "utf8");
    } catch {
      refuse(name, [`no report: ${(run.stdout + run.stderr).slice(-400)}`]);
      continue;
    }
    const messages = [...report.matchAll(/<rep:message\b([^>]*)>([\s\S]*?)<\/rep:message>/g)].map(([, attributes, text]) => ({
      level: /level="(\w+)"/.exec(attributes)?.[1],
      code: /code="([^"]*)"/.exec(attributes)?.[1],
      text: decode(text).slice(0, 220),
    }));
    const errors = messages.filter((m) => m.level === "error" || m.level === "fatal");
    const fine = /<rep:accept\s*\/?>/.test(report) || /<rep:assessment>\s*<rep:accept/.test(report);
    if (fine && !errors.length) {
      accept(name);
      for (const m of messages.filter((x) => x.level === "warning").slice(0, 4)) console.log(`      warning ${m.code}: ${m.text}`);
    } else {
      refuse(name, errors.length ? [...new Set(errors.map((m) => `${m.code}: ${m.text}`))] : ["rejected without a message"]);
    }
  }
}

function mustang(jar) {
  for (const name of files.filter((f) => f.endsWith(".zugferd.pdf"))) {
    const run = spawnSync("java", ["-jar", jar, "--no-notices", "--action", "validate", "--source", path.join(folder, name)], { encoding: "utf8", maxBuffer: 1 << 26 });
    const report = run.stdout;
    const summaries = [...report.matchAll(/<summary status="(\w+)"/g)].map((m) => m[1]);
    if (summaries.length && summaries.every((s) => s === "valid")) {
      accept(name);
      continue;
    }
    const lines = report
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /<(error|exception)\b|status="invalid"/i.test(line))
      .map((line) => decode(line.replace(/<[^>]+>/g, " ").trim() || line).slice(0, 260));
    refuse(name, [...new Set(lines)].slice(0, 12).concat(lines.length ? [] : [`${report.slice(-300)}${run.stderr.slice(-300)}`]));
  }
}

const validator = await fetchTo(VALIDATOR, "validator.jar");
const zip = await fetchTo(CONFIG, "config.zip");
const mustangJar = await fetchTo(MUSTANG, "mustang.jar");
const config = path.join(tools, "config");
spawnSync("unzip", ["-q", zip, "-d", config], { stdio: "inherit" });
kosit(validator, config);
mustang(mustangJar);
rmSync(tools, { recursive: true, force: true });

const expected = files.filter((f) => f.startsWith("control-")).length;
if (!expected || controls.length !== expected) refusals.push(`control files: ${controls.length} of ${expected} refused`);

if (refusals.length) {
  const text = refusals.join("\n");
  console.log(text);
  // One annotation: a run keeps only ten, and a message may be long.
  console.log(`::error title=${refusals.length} e-invoices refused::${text.slice(0, 30000).replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
  process.exit(1);
}
// Readable on the run's page without logging in.
console.log(`::notice title=E-invoices accepted::${accepted.length} files accepted, ${controls.length} broken ones refused: ${accepted.join(", ")}`);
