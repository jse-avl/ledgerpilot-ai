import { isIsoDate } from "./dates";
import {
  type Money,
  add,
  compare,
  divRoundHalfEven,
  isNegative,
  isZero,
  minorUnitDigits,
  money,
  normalizeCurrency,
  subtract,
  sum,
  zero,
} from "./money";

export interface InvoiceLineInput {
  readonly description: string;
  /** Quantity in thousandths of a unit: 1.5 units -> 1500. */
  readonly quantityMilli: number;
  readonly unitPrice: Money;
  /** Tax rate in basis points: 19% -> 1900. */
  readonly taxRateBp: number;
  readonly accountCode?: string;
}

export interface ComputedInvoiceLine extends InvoiceLineInput {
  readonly subtotal: Money;
  readonly tax: Money;
  readonly total: Money;
}

export interface InvoiceTotals {
  readonly lines: readonly ComputedInvoiceLine[];
  readonly subtotal: Money;
  readonly tax: Money;
  readonly total: Money;
}

export function computeLine(line: InvoiceLineInput): ComputedInvoiceLine {
  if (!Number.isInteger(line.quantityMilli)) {
    throw new Error(`quantityMilli must be an integer, received ${line.quantityMilli}`);
  }
  if (!Number.isInteger(line.taxRateBp) || line.taxRateBp < 0) {
    throw new Error(`taxRateBp must be a non-negative integer, received ${line.taxRateBp}`);
  }
  const subtotalAmount = divRoundHalfEven(
    BigInt(line.unitPrice.amount) * BigInt(line.quantityMilli),
    1000n,
  );
  const subtotal = money(Number(subtotalAmount), line.unitPrice.currency);
  const taxAmount = divRoundHalfEven(BigInt(subtotal.amount) * BigInt(line.taxRateBp), 10_000n);
  const tax = money(Number(taxAmount), line.unitPrice.currency);
  return {
    ...line,
    subtotal,
    tax,
    total: add(subtotal, tax),
  };
}

export function computeTotals(
  lines: readonly InvoiceLineInput[],
  currency: string,
): InvoiceTotals {
  const code = normalizeCurrency(currency);
  const computed = lines.map((line) => {
    if (line.unitPrice.currency !== code) {
      throw new Error(
        `Line "${line.description}" is ${line.unitPrice.currency} but the invoice is ${code}`,
      );
    }
    return computeLine(line);
  });
  return {
    lines: computed,
    subtotal: sum(
      computed.map((line) => line.subtotal),
      code,
    ),
    tax: sum(
      computed.map((line) => line.tax),
      code,
    ),
    total: sum(
      computed.map((line) => line.total),
      code,
    ),
  };
}

export type InvoiceIssueCode =
  | "INVALID_CURRENCY"
  | "MISSING_NUMBER"
  | "SHORT_NUMBER"
  | "INVALID_ISSUE_DATE"
  | "INVALID_DUE_DATE"
  | "DUE_BEFORE_ISSUE"
  | "MISSING_DUE_DATE"
  | "NEGATIVE_AMOUNT"
  | "TOTAL_MISMATCH"
  | "LINE_SUBTOTAL_MISMATCH"
  | "LINE_TAX_MISMATCH"
  | "LINE_TOTAL_MISMATCH"
  | "DUPLICATE_NUMBER"
  | "TAX_EXCEEDS_TOTAL"
  | "FUTURE_ISSUE_DATE";

export type InvoiceIssueSeverity = "error" | "warning";

export interface InvoiceIssue {
  readonly code: InvoiceIssueCode;
  readonly severity: InvoiceIssueSeverity;
  readonly message: string;
  readonly field?: string;
}

export interface InvoiceInput {
  readonly number: string;
  readonly currency: string;
  readonly issueDate: string;
  readonly dueDate?: string;
  readonly vendorName?: string;
  readonly subtotal: Money;
  readonly tax: Money;
  readonly total: Money;
  readonly lines?: readonly ComputedInvoiceLine[];
}

export interface InvoiceValidationOptions {
  /** Known invoice numbers for the same vendor, already normalized. */
  readonly knownNumbers?: ReadonlySet<string>;
  /** Relative tolerance in basis points when comparing money fields. Default 0. */
  readonly toleranceBp?: number;
  /** ISO date used to flag future issue dates. Defaults to today (UTC). */
  readonly today?: string;
}

export function normalizeInvoiceNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function withinTolerance(a: Money, b: Money, toleranceBp: number): boolean {
  const diff = Math.abs(a.amount - b.amount);
  if (diff === 0) return true;
  const base = Math.max(Math.abs(a.amount), Math.abs(b.amount));
  if (base === 0) return true;
  return diff * 10_000 <= base * toleranceBp;
}

export function validateInvoice(
  invoice: InvoiceInput,
  options: InvoiceValidationOptions = {},
): InvoiceIssue[] {
  const issues: InvoiceIssue[] = [];
  const toleranceBp = options.toleranceBp ?? 0;
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  let currencyOk = true;
  try {
    normalizeCurrency(invoice.currency);
  } catch {
    currencyOk = false;
    issues.push({
      code: "INVALID_CURRENCY",
      severity: "error",
      message: `Currency "${invoice.currency}" is not a valid ISO-4217 code`,
      field: "currency",
    });
  }

  const normalizedNumber = normalizeInvoiceNumber(invoice.number);
  if (normalizedNumber.length === 0) {
    issues.push({
      code: "MISSING_NUMBER",
      severity: "error",
      message: "Invoice number is required",
      field: "number",
    });
  } else if (normalizedNumber.length < 3) {
    issues.push({
      code: "SHORT_NUMBER",
      severity: "warning",
      message: `Invoice number "${invoice.number}" is too short to match reliably`,
      field: "number",
    });
  }

  if (!isIsoDate(invoice.issueDate)) {
    issues.push({
      code: "INVALID_ISSUE_DATE",
      severity: "error",
      message: `Invalid issue date "${invoice.issueDate}"`,
      field: "issueDate",
    });
  } else if (invoice.issueDate > today) {
    issues.push({
      code: "FUTURE_ISSUE_DATE",
      severity: "warning",
      message: `Issue date ${invoice.issueDate} is in the future`,
      field: "issueDate",
    });
  }

  if (invoice.dueDate === undefined) {
    issues.push({
      code: "MISSING_DUE_DATE",
      severity: "warning",
      message: "Invoice has no due date; aging cannot be computed",
      field: "dueDate",
    });
  } else if (!isIsoDate(invoice.dueDate)) {
    issues.push({
      code: "INVALID_DUE_DATE",
      severity: "error",
      message: `Invalid due date "${invoice.dueDate}"`,
      field: "dueDate",
    });
  } else if (isIsoDate(invoice.issueDate) && invoice.dueDate < invoice.issueDate) {
    issues.push({
      code: "DUE_BEFORE_ISSUE",
      severity: "error",
      message: `Due date ${invoice.dueDate} is before issue date ${invoice.issueDate}`,
      field: "dueDate",
    });
  }

  if (currencyOk) {
    for (const [field, value] of [
      ["subtotal", invoice.subtotal],
      ["tax", invoice.tax],
      ["total", invoice.total],
    ] as const) {
      if (value.currency !== invoice.currency) {
        issues.push({
          code: "INVALID_CURRENCY",
          severity: "error",
          message: `${field} is ${value.currency} but the invoice is ${invoice.currency}`,
          field,
        });
      }
      if (isNegative(value)) {
        issues.push({
          code: "NEGATIVE_AMOUNT",
          severity: "error",
          message: `${field} is negative (${value.amount} minor units)`,
          field,
        });
      }
    }

    const expectedTotal = add(invoice.subtotal, invoice.tax);
    if (!withinTolerance(expectedTotal, invoice.total, toleranceBp)) {
      issues.push({
        code: "TOTAL_MISMATCH",
        severity: "error",
        message: `total ${invoice.total.amount} != subtotal ${invoice.subtotal.amount} + tax ${invoice.tax.amount}`,
        field: "total",
      });
    }

    if (compare(invoice.tax, invoice.total) === 1) {
      issues.push({
        code: "TAX_EXCEEDS_TOTAL",
        severity: "error",
        message: "Tax is greater than the invoice total",
        field: "tax",
      });
    }

    if (invoice.lines && invoice.lines.length > 0) {
      const lineSubtotal = sum(
        invoice.lines.map((line) => line.subtotal),
        invoice.currency,
      );
      const lineTax = sum(
        invoice.lines.map((line) => line.tax),
        invoice.currency,
      );
      const lineTotal = sum(
        invoice.lines.map((line) => line.total),
        invoice.currency,
      );

      if (!withinTolerance(lineSubtotal, invoice.subtotal, toleranceBp)) {
        issues.push({
          code: "LINE_SUBTOTAL_MISMATCH",
          severity: "error",
          message: `Lines sum to ${lineSubtotal.amount} but subtotal is ${invoice.subtotal.amount}`,
          field: "lines",
        });
      }
      if (!withinTolerance(lineTax, invoice.tax, toleranceBp)) {
        issues.push({
          code: "LINE_TAX_MISMATCH",
          severity: "error",
          message: `Line taxes sum to ${lineTax.amount} but tax is ${invoice.tax.amount}`,
          field: "lines",
        });
      }
      if (!withinTolerance(lineTotal, invoice.total, toleranceBp)) {
        issues.push({
          code: "LINE_TOTAL_MISMATCH",
          severity: "error",
          message: `Lines total ${lineTotal.amount} but invoice total is ${invoice.total.amount}`,
          field: "lines",
        });
      }
    }
  }

  if (options.knownNumbers?.has(normalizedNumber)) {
    issues.push({
      code: "DUPLICATE_NUMBER",
      severity: "error",
      message: `Invoice number ${normalizedNumber} already exists for this vendor`,
      field: "number",
    });
  }

  return issues;
}

export function hasErrors(issues: readonly InvoiceIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

/** Positive means overdue. Negative means not yet due. */
export function daysPastDue(dueDate: string, asOf: string): number {
  if (!isIsoDate(dueDate) || !isIsoDate(asOf)) {
    throw new Error(`Invalid date: dueDate=${dueDate} asOf=${asOf}`);
  }
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  const at = Date.parse(`${asOf}T00:00:00.000Z`);
  return Math.round((at - due) / 86_400_000);
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface AgingSummary {
  readonly buckets: Readonly<Record<AgingBucket, Money>>;
  readonly totalOutstanding: Money;
}

export function summarizeAging(
  invoices: readonly { dueDate: string; openBalance: Money }[],
  asOf: string,
  currency: string,
): AgingSummary {
  const buckets: Record<AgingBucket, Money[]> = {
    current: [],
    "1-30": [],
    "31-60": [],
    "61-90": [],
    "90+": [],
  };
  for (const invoice of invoices) {
    if (isZero(invoice.openBalance)) continue;
    if (invoice.openBalance.currency !== currency) {
      throw new Error(`Cannot age ${invoice.openBalance.currency} together with ${currency}`);
    }
    const bucket = agingBucket(daysPastDue(invoice.dueDate, asOf));
    buckets[bucket].push(invoice.openBalance);
  }
  return {
    buckets: {
      current: sum(buckets.current, currency),
      "1-30": sum(buckets["1-30"], currency),
      "31-60": sum(buckets["31-60"], currency),
      "61-90": sum(buckets["61-90"], currency),
      "90+": sum(buckets["90+"], currency),
    },
    totalOutstanding: sum(
      Object.values(buckets).flat().map((value) => value),
      currency,
    ),
  };
}

export function invoiceKey(vendorId: string, number: string): string {
  return `${vendorId}:${normalizeInvoiceNumber(number)}`;
}

export function taxFromInclusiveTotal(total: Money, taxRateBp: number): Money {
  const divisor = 10_000n + BigInt(taxRateBp);
  const taxAmount = divRoundHalfEven(BigInt(total.amount) * BigInt(taxRateBp), divisor);
  return money(Number(taxAmount), total.currency);
}

export function netFromInclusiveTotal(total: Money, taxRateBp: number): Money {
  return subtract(total, taxFromInclusiveTotal(total, taxRateBp));
}

export function currencyDigits(currency: string): number {
  return minorUnitDigits(currency);
}

export function emptyTotals(currency: string): InvoiceTotals {
  return {
    lines: [],
    subtotal: zero(currency),
    tax: zero(currency),
    total: zero(currency),
  };
}
