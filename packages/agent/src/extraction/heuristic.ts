import { parseAmount } from "@ledgerpilot/core";
import { scanForInjection } from "./injection";
import type {
  ExtractedField,
  ExtractedLine,
  ExtractedMoney,
  InvoiceExtraction,
} from "./types";

const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "PAB",
  "MXN",
  "COP",
  "PEN",
  "CLP",
  "JPY",
  "CNY",
  "CAD",
  "CHF",
] as const;

const SYMBOL_TO_CURRENCY: Readonly<Record<string, string>> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};

const ISSUE_DATE_LABEL =
  /\b(invoice\s+date|issue\s+date|issued|fecha\s+de\s+emisi[oó]n|fecha\s+de\s+factura|fecha)\b/i;
const DUE_DATE_LABEL =
  /\b(due\s+date|payment\s+due|pay\s+by|fecha\s+de\s+vencimiento|vencimiento|vence)\b/i;
/**
 * Invoice numbers are labelled in many ways ("Invoice No: INV-1", "Factura
 * Nº F-42", "INVOICE #"). The label is loose on purpose, so each token after it
 * is validated: it must contain a digit, must not be a bare year, must not look
 * like a date, and must not be filler ("No.", "Number").
 */
const INVOICE_LABEL = /\b(?:invoice|factura|inv)\b/gi;
const BARE_YEAR = /^(?:19|20)\d{2}$/;
const DATE_SHAPED = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})$/;
const NUMBER_FILLER = new Set([
  "no",
  "no.",
  "nr",
  "nr.",
  "nro",
  "nro.",
  "num",
  "num.",
  "number",
  "numero",
  "número",
  "núm",
]);

function findInvoiceNumber(text: string): { value: string; snippet: string } | null {
  for (const label of text.matchAll(INVOICE_LABEL)) {
    const start = (label.index ?? 0) + label[0].length;
    const rest = text.slice(start, start + 64).split("\n")[0] ?? "";
    const tokens = rest.match(/[A-Za-z0-9][A-Za-z0-9._/-]{2,}/g) ?? [];

    for (const raw of tokens) {
      const candidate = raw.replace(/[.,;:]+$/, "");
      if (!/\d/.test(candidate)) continue;
      if (BARE_YEAR.test(candidate) || DATE_SHAPED.test(candidate)) continue;
      if (NUMBER_FILLER.has(candidate.toLowerCase())) continue;

      const lineStart = text.lastIndexOf("\n", label.index ?? 0) + 1;
      const lineEnd = text.indexOf("\n", label.index ?? 0);
      const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
      return { value: candidate, snippet: line.slice(0, 160) };
    }
  }
  return null;
}

const VENDOR_STOPWORDS = [
  "invoice",
  "factura",
  "bill to",
  "ship to",
  "date",
  "total",
  "subtotal",
  "purchase order",
  "page",
  "tax id",
  "ruc",
  // Metadata lines that look like names if the vendor block is missing.
  "currency",
  "moneda",
  "due",
  "issued",
  "vencimiento",
  "fecha",
  "importe",
  "payment",
  "amount",
  "número",
  "numero",
];

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Parses ISO, dd/mm/yyyy and "March 3, 2026" / "3 de marzo de 2026". */
export function parseDateToIso(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const monthName = /([A-Za-zÁÉÍÓÚáéíóúñ]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(text);
  if (monthName) {
    const month = MONTHS[monthName[1]?.toLowerCase() ?? ""];
    if (month) return toIso(Number(monthName[3]), month, Number(monthName[2]));
  }

  const dayFirst = /(\d{1,2})\s+(?:de\s+)?([A-Za-zÁÉÍÓÚáéíóúñ]+)\.?\s+(?:de\s+)?(\d{4})/.exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]?.toLowerCase() ?? ""];
    if (month) return toIso(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  const numeric = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    // Ambiguous by nature. Prefer month/day (US) unless it is impossible.
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return toIso(Number(numeric[3]), month, day);
  }

  return null;
}

/** Finds the first date inside a labelled line, or null. */
function dateNearLabel(
  lines: readonly string[],
  label: RegExp,
): { value: string; snippet: string; ambiguous: boolean } | null {
  for (const line of lines) {
    if (!label.test(line)) continue;
    const parsed = parseDateToIso(line);
    if (parsed) {
      // A bare numeric date is unknowable: 03/04 is March 4 in the US and
      // April 3 in most of Latin America. Keep the value, lower the confidence
      // so a human checks it. ISO dates are unambiguous by construction.
      const isNumeric = /\d{1,2}[/.]\d{1,2}[/.]\d{4}/.test(line);
      const isIso = /\d{4}-\d{2}-\d{2}/.test(line);
      return {
        value: parsed,
        snippet: line.trim().slice(0, 160),
        ambiguous: isNumeric && !isIso,
      };
    }
  }
  return null;
}

function detectCurrency(text: string): { value: string | null; confidenceBp: number; snippet: string | null } {
  for (const code of CURRENCY_CODES) {
    const pattern = new RegExp(`\\b${code}\\b`);
    if (pattern.test(text)) {
      return { value: code, confidenceBp: 9_500, snippet: code };
    }
  }
  for (const [symbol, code] of Object.entries(SYMBOL_TO_CURRENCY)) {
    if (text.includes(symbol)) {
      return { value: code, confidenceBp: 7_000, snippet: symbol };
    }
  }
  return { value: null, confidenceBp: 0, snippet: null };
}

function amountNear(
  lines: readonly string[],
  label: RegExp,
  currency: string,
): { value: ExtractedMoney; confidenceBp: number; snippet: string } | null {
  for (const line of lines) {
    const match = label.exec(line);
    if (!match) continue;
    const tail = line.slice(match.index + match[0].length);
    const amountMatch = /[-(]?\s*[$€£¥]?\s*\d[\d.,]*\s*\)?/.exec(tail);
    if (!amountMatch) continue;
    try {
      const parsed = parseAmount(amountMatch[0], currency);
      return {
        value: { amountMinor: parsed.amount, currency },
        confidenceBp: 9_000,
        snippet: line.trim().slice(0, 160),
      };
    } catch {
      continue;
    }
  }
  return null;
}

function detectVendor(lines: readonly string[]): { value: string; snippet: string } | null {
  for (const line of lines.slice(0, 8)) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 80) continue;
    const lower = trimmed.toLowerCase();
    if (VENDOR_STOPWORDS.some((word) => lower.includes(word))) continue;
    if (!/[A-Za-zÁÉÍÓÚáéíóúñ]{3,}/.test(trimmed)) continue;
    if (/^[\d\s.,$€£-]+$/.test(trimmed)) continue;
    // Noise from an unreadable scan is not a company name.
    if (/[?#~[\]{}<>]{2,}/.test(trimmed)) continue;
    return { value: trimmed, snippet: trimmed };
  }
  return null;
}

function parseLines(lines: readonly string[], currency: string): ExtractedLine[] {
  const parsed: ExtractedLine[] = [];
  const pattern = /^(.{3,60}?)\s{2,}(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)\s*$/;

  for (const line of lines) {
    const match = pattern.exec(line.trim());
    if (!match) continue;
    const [, description, quantity, unitPrice, total] = match;
    if (!description || !quantity || !unitPrice || !total) continue;
    let quantityMilli: number | null = null;
    let unitPriceMinor: number | null = null;
    let totalMinor: number | null = null;
    try {
      quantityMilli = Math.round(Number(quantity.replace(",", ".")) * 1000);
      unitPriceMinor = parseAmount(unitPrice, currency).amount;
      totalMinor = parseAmount(total, currency).amount;
    } catch {
      continue;
    }
    parsed.push({
      description: description.trim(),
      quantityMilli,
      unitPriceMinor,
      totalMinor,
      confidenceBp: 5_500,
    });
  }

  return parsed;
}

function field<T>(
  value: T | null,
  confidenceBp: number,
  snippet: string | null,
  page: number | null,
  method: "heuristic",
): ExtractedField<T> {
  return { value, confidenceBp: value === null ? 0 : confidenceBp, snippet, page, method };
}

export interface HeuristicOptions {
  readonly page?: number;
  readonly defaultCurrency?: string;
}

/**
 * Deterministic invoice extraction from a text layer. No model involved.
 * Confidence is honest: labelled matches score high, guesses stay below the
 * review threshold, and missing fields remain null instead of being invented.
 */
export function extractInvoice(
  text: string,
  options: HeuristicOptions = {},
): InvoiceExtraction {
  const page = options.page ?? 1;
  const fallbackCurrency = options.defaultCurrency ?? "USD";
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");

  const injection = scanForInjection(text);

  const numberMatch = findInvoiceNumber(text);
  const invoiceNumber = field(
    numberMatch?.value ?? null,
    numberMatch ? 9_000 : 0,
    numberMatch?.snippet ?? null,
    page,
    "heuristic",
  );

  const vendor = detectVendor(lines);
  if (!vendor) warnings.push("VENDOR_NOT_FOUND");

  const currency = detectCurrency(text);
  const effectiveCurrency = currency.value ?? fallbackCurrency;
  if (currency.value === null) {
    warnings.push(`CURRENCY_NOT_FOUND: assumed ${fallbackCurrency}`);
  }

  const issue = dateNearLabel(lines, ISSUE_DATE_LABEL);
  const due = dateNearLabel(lines, DUE_DATE_LABEL);
  if (!issue) warnings.push("ISSUE_DATE_NOT_FOUND");
  if (!due) warnings.push("DUE_DATE_NOT_FOUND");
  if (issue?.ambiguous) warnings.push("ISSUE_DATE_AMBIGUOUS: day/month order assumed");
  if (due?.ambiguous) warnings.push("DUE_DATE_AMBIGUOUS: day/month order assumed");

  const subtotal = amountNear(lines, /\b(sub-?total|base\s+imponible|net\s+amount|importe\s+neto)\b/i, effectiveCurrency);
  const tax = amountNear(lines, /\b(sales\s+tax|vat|iva|impuesto|tax)\b/i, effectiveCurrency);
  const total = amountNear(
    lines,
    /\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+a\s+pagar|importe\s+total|(?<!(?:sub[\s-]?))total)\b/i,
    effectiveCurrency,
  );

  if (!total) {
    warnings.push("TOTAL_NOT_FOUND");
  } else if (subtotal && tax) {
    const expected = subtotal.value.amountMinor + tax.value.amountMinor;
    if (Math.abs(expected - total.value.amountMinor) > 1) {
      warnings.push("TOTAL_MISMATCH: subtotal + tax does not equal total");
    }
  }

  const extractedLines = parseLines(lines, effectiveCurrency);
  if (extractedLines.length === 0) warnings.push("LINES_NOT_PARSED");

  return {
    method: "heuristic",
    fields: {
      invoiceNumber,
      vendorName: field(vendor?.value ?? null, 6_500, vendor?.snippet ?? null, page, "heuristic"),
      issueDate: field(issue?.value ?? null, issue ? (issue.ambiguous ? 6_500 : 8_500) : 0, issue?.snippet ?? null, page, "heuristic"),
      dueDate: field(due?.value ?? null, due ? (due.ambiguous ? 6_500 : 8_500) : 0, due?.snippet ?? null, page, "heuristic"),
      currency: field(currency.value, currency.confidenceBp, currency.snippet, page, "heuristic"),
      subtotal: field(subtotal?.value ?? null, subtotal?.confidenceBp ?? 0, subtotal?.snippet ?? null, page, "heuristic"),
      tax: field(tax?.value ?? null, tax?.confidenceBp ?? 0, tax?.snippet ?? null, page, "heuristic"),
      total: field(total?.value ?? null, total?.confidenceBp ?? 0, total?.snippet ?? null, page, "heuristic"),
    },
    lines: extractedLines,
    warnings,
    riskFlags: injection.riskFlags,
    injectionMatches: injection.matches,
  };
}

/** Any field below this threshold must be reviewed by a human. */
export const REVIEW_THRESHOLD_BP = 8_000;

export function fieldsNeedingReview(extraction: InvoiceExtraction): string[] {
  const flags: string[] = [];
  for (const [name, value] of Object.entries(extraction.fields)) {
    const fieldValue = value as ExtractedField<unknown>;
    if (fieldValue.value === null || fieldValue.confidenceBp < REVIEW_THRESHOLD_BP) {
      flags.push(name);
    }
  }
  if (extraction.riskFlags.length > 0) flags.push("security");
  return flags;
}

export function overallConfidenceBp(extraction: InvoiceExtraction): number {
  const values = Object.values(extraction.fields) as ExtractedField<unknown>[];
  const present = values.filter((value) => value.value !== null);
  if (present.length === 0) return 0;
  return Math.round(present.reduce((acc, value) => acc + value.confidenceBp, 0) / values.length);
}
