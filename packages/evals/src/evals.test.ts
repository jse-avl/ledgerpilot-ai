import { describe, expect, it } from "vitest";
import { extractInvoice } from "@ledgerpilot/agent";
import { buildDegradedCases, buildSupportedCases } from "./dataset";
import type { FieldName } from "./extraction";
import { renderReport, runEvals, THRESHOLDS } from "./report";

/**
 * The thresholds live in code, not in a dashboard. If extraction regresses, CI
 * fails here even when the report has not been regenerated.
 */
describe("extraction benchmark", () => {
  const run = runEvals();

  it("extracts header and amount fields above the F1 threshold", () => {
    expect(run.extraction.cases).toBe(24);
    expect(run.rates.fieldF1).toBeGreaterThanOrEqual(THRESHOLDS.fieldF1);
    expect(run.passed.fieldF1).toBe(true);
  });

  it("parses line items above the F1 threshold", () => {
    expect(run.rates.lineF1).toBeGreaterThanOrEqual(THRESHOLDS.lineF1);
  });

  it("gets every field right on most invoices", () => {
    expect(run.extraction.perfectCases / run.extraction.cases).toBeGreaterThanOrEqual(0.75);
  });

  it("scores both languages and both decimal conventions", () => {
    const fields = new Map(run.extraction.fields.map((field) => [field.field, field]));
    for (const name of ["invoiceNumber", "total", "currency", "vendorName"]) {
      expect(fields.get(name as FieldName)?.f1 ?? 0).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe("degraded documents", () => {
  it("always fails honestly rather than confidently", () => {
    const results = buildDegradedCases().map((testCase) => ({
      id: testCase.id,
      detail: testCase.check(extractInvoice(testCase.text)),
    }));
    expect(results.filter((result) => result.detail !== null)).toEqual([]);
  });
});

describe("security", () => {
  const run = runEvals();

  it("passes every case", () => {
    expect(run.security.filter((result) => !result.passed)).toEqual([]);
    expect(run.rates.securityPassRate).toBe(1);
  });

  it("covers injection, approval and execution", () => {
    const areas = new Set(run.security.map((result) => result.area));
    expect([...areas].sort()).toEqual(["approval", "execution", "prompt_injection"]);
  });
});

describe("report", () => {
  it("renders every section the docs promise", () => {
    const markdown = renderReport(runEvals(), "2026-06-15");
    for (const heading of ["## Summary", "## Extraction, per field", "## Degraded documents", "## Security"]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("in-distribution");
  });

  it("produces the same result twice, so a failure is reproducible", () => {
    const first = runEvals();
    const second = runEvals();
    expect(second.rates).toEqual(first.rates);
  });
});

describe("corpus", () => {
  it("is deterministic", () => {
    const first = buildSupportedCases();
    const second = buildSupportedCases();
    expect(second.map((testCase) => testCase.text)).toEqual(first.map((testCase) => testCase.text));
  });

  it("covers the advertised languages and layouts", () => {
    const supported = buildSupportedCases();
    expect(supported.filter((testCase) => testCase.locale === "en")).toHaveLength(12);
    expect(supported.filter((testCase) => testCase.locale === "es")).toHaveLength(12);
    expect(new Set(supported.map((testCase) => testCase.layout))).toEqual(
      new Set(["modern", "classic", "compact"]),
    );
  });

  it("keeps subtotal plus tax equal to the stated total", () => {
    for (const testCase of buildSupportedCases()) {
      const { subtotalMinor, taxMinor, totalMinor } = testCase.expected;
      expect(subtotalMinor + taxMinor).toBe(totalMinor);
    }
  });
});
