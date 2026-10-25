#!/usr/bin/env node
/**
 * `pnpm eval` — runs the offline evaluation and writes docs/eval-report.md.
 *
 * Exit code is non-zero when a threshold is missed, so CI fails on regressions
 * even if nobody reads the report.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { renderReport, runEvals, THRESHOLDS } from "./report";

const root = path.resolve(import.meta.dirname, "../../..");
const reportPath = path.join(root, "docs", "eval-report.md");

const run = runEvals();
const generatedAt = new Date().toISOString().slice(0, 10);

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, renderReport(run, generatedAt), "utf8");

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log("LedgerPilot evals");
console.log(`  invoices          ${run.extraction.cases} supported, ${run.degraded.length} degraded`);
console.log(
  `  field F1          ${percent(run.rates.fieldF1)}  (threshold ${percent(THRESHOLDS.fieldF1)})  ${run.passed.fieldF1 ? "ok" : "FAIL"}`,
);
console.log(
  `  line-item F1      ${percent(run.rates.lineF1)}  (threshold ${percent(THRESHOLDS.lineF1)})  ${run.passed.lineF1 ? "ok" : "FAIL"}`,
);
console.log(
  `  degraded routing  ${percent(run.rates.degradedPassRate)}  ${run.passed.degraded ? "ok" : "FAIL"}`,
);
console.log(
  `  security          ${run.rates.securityPassRate === 1 ? "all passed" : percent(run.rates.securityPassRate)}  ${run.passed.security ? "ok" : "FAIL"}`,
);
console.log(`  report            ${path.relative(root, reportPath)}`);

if (!run.overall) {
  console.error("\nEval thresholds were not met.");
  process.exit(1);
}
