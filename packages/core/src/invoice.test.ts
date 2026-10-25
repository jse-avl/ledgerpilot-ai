import { describe, expect, it } from "vitest";
import { money } from "../src/money";
import {
  agingBucket,
  computeLine,
  computeTotals,
  daysPastDue,
  hasErrors,
  netFromInclusiveTotal,
  normalizeInvoiceNumber,
  summarizeAging,
  taxFromInclusiveTotal,
  validateInvoice,
} from "../src/invoice";

const line = {
  description: "Consulting hours",
  quantityMilli: 2000,
  unitPrice: money(2500, "USD"),
  taxRateBp: 1900,
};

describe("invoice totals", () => {
  it("computes line subtotal and tax", () => {
    const computed = computeLine(line);
    expect(computed.subtotal.amount).toBe(5000);
    expect(computed.tax.amount).toBe(950);
    expect(computed.total.amount).toBe(5950);
  });

  it("rounds half to even at the line level", () => {
    const computed = computeLine({
      description: "Fractional quantity",
      quantityMilli: 333,
      unitPrice: money(100, "USD"),
      taxRateBp: 0,
    });
    expect(computed.subtotal.amount).toBe(33);
  });

  it("sums multiple lines", () => {
    const totals = computeTotals(
      [
        line,
        {
          description: "Software license",
          quantityMilli: 1000,
          unitPrice: money(12_000, "USD"),
          taxRateBp: 0,
        },
      ],
      "USD",
    );
    expect(totals.subtotal.amount).toBe(17_000);
    expect(totals.tax.amount).toBe(950);
    expect(totals.total.amount).toBe(17_950);
  });

  it("computes tax from a tax-inclusive total", () => {
    expect(taxFromInclusiveTotal(money(11_900, "USD"), 1900).amount).toBe(1900);
    expect(netFromInclusiveTotal(money(11_900, "USD"), 1900).amount).toBe(10_000);
  });
});

describe("invoice validation", () => {
  const totals = computeTotals([line], "USD");

  const base = {
    number: "INV-2026-0042",
    currency: "USD",
    issueDate: "2026-02-01",
    dueDate: "2026-03-03",
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    lines: totals.lines,
  };

  it("accepts a clean invoice", () => {
    expect(validateInvoice(base, { today: "2026-02-15" })).toEqual([]);
  });

  it("flags a total that does not add up", () => {
    const issues = validateInvoice({ ...base, total: money(5951, "USD") }, { today: "2026-02-15" });
    expect(issues.map((issue) => issue.code)).toContain("TOTAL_MISMATCH");
    expect(hasErrors(issues)).toBe(true);
  });

  it("flags line totals that do not match the header", () => {
    const issues = validateInvoice(
      { ...base, subtotal: money(5001, "USD"), total: money(5951, "USD") },
      { today: "2026-02-15" },
    );
    expect(issues.map((issue) => issue.code)).toContain("LINE_SUBTOTAL_MISMATCH");
  });

  it("flags duplicate numbers", () => {
    const issues = validateInvoice(base, {
      today: "2026-02-15",
      knownNumbers: new Set([normalizeInvoiceNumber(base.number)]),
    });
    expect(issues.map((issue) => issue.code)).toContain("DUPLICATE_NUMBER");
  });

  it("flags a due date before the issue date", () => {
    const issues = validateInvoice({ ...base, dueDate: "2026-01-01" }, { today: "2026-02-15" });
    expect(issues.map((issue) => issue.code)).toContain("DUE_BEFORE_ISSUE");
  });

  it("warns when the due date is missing but does not fail the invoice", () => {
    const issues = validateInvoice({ ...base, dueDate: undefined }, { today: "2026-02-15" });
    expect(issues.map((issue) => issue.code)).toContain("MISSING_DUE_DATE");
    expect(hasErrors(issues)).toBe(false);
  });

  it("flags negative amounts", () => {
    const issues = validateInvoice(
      {
        ...base,
        subtotal: money(-5000, "USD"),
        tax: money(-950, "USD"),
        total: money(-5950, "USD"),
        lines: [],
      },
      { today: "2026-02-15" },
    );
    expect(issues.filter((issue) => issue.code === "NEGATIVE_AMOUNT")).toHaveLength(3);
  });
});

describe("aging", () => {
  it("normalizes invoice numbers for matching", () => {
    expect(normalizeInvoiceNumber("inv-2026/0042")).toBe("INV20260042");
  });

  it("computes days past due", () => {
    expect(daysPastDue("2026-03-01", "2026-03-01")).toBe(0);
    expect(daysPastDue("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysPastDue("2026-03-01", "2026-02-01")).toBe(-28);
  });

  it.each([
    [-10, "current"],
    [0, "current"],
    [1, "1-30"],
    [30, "1-30"],
    [31, "31-60"],
    [60, "31-60"],
    [61, "61-90"],
    [90, "61-90"],
    [91, "90+"],
  ])("buckets %i days as %s", (days, bucket) => {
    expect(agingBucket(days)).toBe(bucket);
  });

  it("summarizes outstanding balances", () => {
    const summary = summarizeAging(
      [
        { dueDate: "2026-03-20", openBalance: money(1000, "USD") },
        { dueDate: "2026-03-01", openBalance: money(2000, "USD") },
        { dueDate: "2025-10-01", openBalance: money(3000, "USD") },
      ],
      "2026-03-15",
      "USD",
    );
    expect(summary.buckets.current.amount).toBe(1000);
    expect(summary.buckets["1-30"].amount).toBe(2000);
    expect(summary.buckets["90+"].amount).toBe(3000);
    expect(summary.totalOutstanding.amount).toBe(6000);
  });
});
