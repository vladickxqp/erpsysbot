// Failed tests of a vitest JSON report as one annotation of the CI run.
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const failed = report.testResults.flatMap((file) => {
  const name = file.name.replace(/^.*\/tests\//, "tests/");
  const tests = file.assertionResults.filter((t) => t.status === "failed").map((t) => `${name} > ${t.fullName}\n  ${String(t.failureMessages[0]).split("\n").slice(0, 3).join(" | ").slice(0, 400)}`);
  return tests.length || file.status === "passed" ? tests : [`${name}: ${String(file.message).slice(0, 400)}`];
});
const text = `${report.numFailedTests} failed of ${report.numTotalTests}\n${failed.slice(0, 40).join("\n")}`;
console.log(`::error title=Tests::${text.replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
