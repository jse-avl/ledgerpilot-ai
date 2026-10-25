import type { InvoiceExtraction } from "@ledgerpilot/agent";
import type { ExpectedInvoice, SupportedCase } from "./dataset";

/**
 * Field-level evaluation.
 *
 * A field counts as a true positive only when it is exactly right. Extraction is
 * not a ranking problem: a wrong invoice number is worse than a missing one,
 * because it silently attaches a document to the wrong record. So precision is
 * measured literally, and an invented value is a false positive.
 */

export const FIELDS = [
  "invoiceNumber",
  "vendorName",
  "issueDate",
  "dueDate",
  "currency",
  "subtotal",
  "tax",
  "total",
] as const;

export type FieldName = (typeof FIELDS)[number];

export interface FieldScore {
  readonly field: FieldName;
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface FieldFailure {
  readonly caseId: string;
  readonly field: FieldName;
  readonly expected: string;
  readonly actual: string;
}

export interface ExtractionReport {
  readonly cases: number;
  readonly fields: readonly FieldScore[];
  readonly micro: Omit<FieldScore, "field">;
  readonly lines: { readonly precision: number; readonly recall: number; readonly f1: number };
  readonly failures: readonly FieldFailure[];
  readonly perfectCases: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function f1Of(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

interface Comparison {
  readonly expected: string | null;
  readonly actual: string | null;
}

export function expectedValue(expected: ExpectedInvoice, field: FieldName): string | null {
  switch (field) {
    case "invoiceNumber":
      return expected.invoiceNumber === "" ? null : expected.invoiceNumber;
    case "vendorName":
      return expected.vendorName === "" ? null : expected.vendorName;
    case "issueDate":
      return expected.issueDate;
    case "dueDate":
      return expected.dueDate;
    case "currency":
      return expected.currency;
    case "subtotal":
      return String(expected.subtotalMinor);
    case "tax":
      return String(expected.taxMinor);
    case "total":
      return String(expected.totalMinor);
  }
}

function actualValue(extraction: InvoiceExtraction, field: FieldName): string | null {
  const fields = extraction.fields;
  switch (field) {
    case "invoiceNumber":
      return fields.invoiceNumber.value;
    case "vendorName":
      return fields.vendorName.value;
    case "issueDate":
      return fields.issueDate.value;
    case "dueDate":
      return fields.dueDate.value;
    case "currency":
      return fields.currency.value;
    case "subtotal":
      return fields.subtotal.value === null ? null : String(fields.subtotal.value.amountMinor);
    case "tax":
      return fields.tax.value === null ? null : String(fields.tax.value.amountMinor);
    case "total":
      return fields.total.value === null ? null : String(fields.total.value.amountMinor);
  }
}

function compare(expected: ExpectedInvoice, extraction: InvoiceExtraction, field: FieldName): Comparison {
  return { expected: expectedValue(expected, field), actual: actualValue(extraction, field) };
}

function same(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  // Identifiers and dates are compared exactly; names get whitespace and case
  // normalisation because a trailing legal suffix is not a different vendor.
  return normalize(expected) === normalize(actual);
}

export function scoreExtraction(
  cases: readonly SupportedCase[],
  extract: (text: string) => InvoiceExtraction,
): ExtractionReport {
  const counters = new Map<FieldName, { tp: number; fp: number; fn: number }>(
    FIELDS.map((field) => [field, { tp: 0, fp: 0, fn: 0 }]),
  );
  const failures: FieldFailure[] = [];
  let perfectCases = 0;
  let lineTp = 0;
  let lineFp = 0;
  let lineFn = 0;

  for (const testCase of cases) {
    const extraction = extract(testCase.text);
    let caseFailures = 0;

    for (const field of FIELDS) {
      const { expected, actual } = compare(testCase.expected, extraction, field);
      const counter = counters.get(field);
      if (!counter) continue;

      if (expected !== null && actual !== null && same(expected, actual)) {
        counter.tp += 1;
        continue;
      }
      if (expected === null && actual === null) {
        // Nothing to find, nothing invented: neither a hit nor a miss.
        continue;
      }
      if (expected !== null && actual === null) {
        counter.fn += 1;
      } else {
        counter.fp += 1;
        if (expected !== null) counter.fn += 1;
      }
      caseFailures += 1;
      failures.push({
        caseId: testCase.id,
        field,
        expected: expected ?? "(absent)",
        actual: actual ?? "(absent)",
      });
    }

    const expectedDescriptions = new Set(testCase.expected.lineDescriptions.map(normalize));
    const actualDescriptions = new Set(extraction.lines.map((line) => normalize(line.description)));
    for (const description of expectedDescriptions) {
      if (actualDescriptions.has(description)) lineTp += 1;
      else lineFn += 1;
    }
    for (const description of actualDescriptions) {
      if (!expectedDescriptions.has(description)) lineFp += 1;
    }

    if (caseFailures === 0) perfectCases += 1;
  }

  const fields: FieldScore[] = FIELDS.map((field) => {
    const counter = counters.get(field) ?? { tp: 0, fp: 0, fn: 0 };
    const precision = ratio(counter.tp, counter.tp + counter.fp);
    const recall = ratio(counter.tp, counter.tp + counter.fn);
    return { field, ...counter, precision, recall, f1: f1Of(precision, recall) };
  });

  const totals = fields.reduce(
    (accumulator, field) => ({
      tp: accumulator.tp + field.tp,
      fp: accumulator.fp + field.fp,
      fn: accumulator.fn + field.fn,
    }),
    { tp: 0, fp: 0, fn: 0 },
  );
  const precision = ratio(totals.tp, totals.tp + totals.fp);
  const recall = ratio(totals.tp, totals.tp + totals.fn);
  const linePrecision = ratio(lineTp, lineTp + lineFp);
  const lineRecall = ratio(lineTp, lineTp + lineFn);

  return {
    cases: cases.length,
    fields,
    micro: { ...totals, precision, recall, f1: f1Of(precision, recall) },
    lines: {
      precision: linePrecision,
      recall: lineRecall,
      f1: f1Of(linePrecision, lineRecall),
    },
    failures,
    perfectCases,
  };
}
