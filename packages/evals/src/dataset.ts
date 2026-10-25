/**
 * Synthetic, deterministic invoice corpus.
 *
 * The corpus is generated, not scraped: no customer data, no licence issues,
 * and every case carries its ground truth next to the text. It covers the two
 * languages and two layouts the extractor claims to support, across four
 * currencies and both decimal conventions.
 *
 * This is an in-distribution benchmark. It measures whether the deterministic
 * path works on documents shaped like the ones we promise to handle; it is not
 * a claim about arbitrary scans. The degraded cases exist to measure the other
 * half of the contract: when the document is unreadable, the system must say so.
 */

export type Locale = "en" | "es";

export interface ExpectedInvoice {
  readonly invoiceNumber: string;
  readonly vendorName: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly lineDescriptions: readonly string[];
}

export interface SupportedCase {
  readonly id: string;
  readonly locale: Locale;
  readonly layout: "modern" | "classic" | "compact";
  readonly tags: readonly string[];
  readonly text: string;
  readonly expected: ExpectedInvoice;
}

export interface DegradedCase {
  readonly id: string;
  readonly locale: Locale;
  readonly reason: string;
  readonly text: string;
  /** Label shown in the report. */
  readonly expectation: string;
  /** Returns a failure message, or null when the expectation holds. */
  readonly check: (extraction: import("@ledgerpilot/agent").InvoiceExtraction) => string | null;
}

// ---------------------------------------------------------------- primitives

/** Small deterministic PRNG so the corpus is identical on every machine. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Format {
  /** 123456 minor units in USD becomes "1,234.56". */
  readonly money: (amountMinor: number) => string;
  readonly date: "long" | "iso" | "dayFirst";
}

const EN_FORMAT: Format = {
  money: (amountMinor) => (amountMinor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  date: "long",
};

const ES_FORMAT: Format = {
  // Latin American invoices commonly use 1.234,56 even for USD.
  money: (amountMinor) =>
    (amountMinor / 100)
      .toFixed(2)
      .replace(".", "\u0000")
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
      .replace("\u0000", ","),
  date: "dayFirst",
};

/**
 * Dates that depend on a day/month convention are kept out of the supported
 * corpus on purpose: the extractor cannot know whether 03/04 is March 4 or
 * April 3, so asking it to be right there would be a rigged test. Ambiguity is
 * measured in the degraded set instead, where the expectation is a confidence
 * drop and a warning, not a correct guess.
 */
function formatFor(locale: Locale, layout: SupportedCase["layout"]): Format {
  if (locale === "en") {
    return layout === "classic" ? { ...EN_FORMAT, date: "iso" } : EN_FORMAT;
  }
  return layout === "compact" ? { ...ES_FORMAT, date: "iso" } : { ...ES_FORMAT, date: "long" };
}

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function longDate(iso: string, locale: Locale): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return iso;
  return locale === "en"
    ? `${MONTHS_EN[month - 1]} ${day}, ${year}`
    : `${day} de ${MONTHS_ES[month - 1]} de ${year}`;
}

function dayFirstDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function renderDate(iso: string, locale: Locale, format: Format): string {
  if (format.date === "iso") return iso;
  if (format.date === "long") return longDate(iso, locale);
  return dayFirstDate(iso);
}

const VENDORS_EN = [
  "Apex Industrial Supply",
  "Northwind Paper Co.",
  "Harbor Point Logistics",
  "Summit Safety Equipment",
  "Redwood Office Group",
  "Cascade Components",
] as const;

const VENDORS_ES = [
  "Distribuidora Istmeña S.A.",
  "Papelería Central",
  "Logística del Pacífico",
  "Suministros Andinos",
  "Grupo Roble",
  "Comercial Bahía Azul",
] as const;

const ITEMS_EN = [
  "Steel brackets",
  "Pallet wrap",
  "Safety gloves",
  "Printer toner",
  "Freight service",
  "Office chairs",
  "Copper fittings",
  "Box labels",
] as const;

const ITEMS_ES = [
  "Soportes de acero",
  "Film para pallets",
  "Guantes de seguridad",
  "Tóner de impresora",
  "Servicio de flete",
  "Sillas de oficina",
  "Conexiones de cobre",
  "Etiquetas de caja",
] as const;

const CURRENCIES = ["USD", "EUR", "PAB", "MXN"] as const;

const TAX_RATES = [0, 0.07, 0.1, 0.16, 0.19] as const;

// ------------------------------------------------------------------ invoices

interface Line {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly totalMinor: number;
}

interface BuildInput {
  readonly id: string;
  readonly locale: Locale;
  readonly layout: SupportedCase["layout"];
  readonly variant: number;
  readonly vendor: string;
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly currency: string;
  readonly lines: readonly Line[];
  readonly taxRate: number;
}

/**
 * Label variants matter: real invoices do not use one template, and a fix for
 * one "Total" line should not break another. Each case rotates through them.
 */
const LABELS: Record<Locale, {
  readonly invoice: readonly string[];
  readonly subtotal: readonly string[];
  readonly tax: readonly string[];
  readonly total: readonly string[];
  readonly currency: readonly string[];
}> = {
  en: {
    invoice: ["Invoice No.", "Invoice #", "Invoice Number"],
    subtotal: ["Subtotal", "Net amount", "Sub-total"],
    tax: ["Sales Tax", "VAT", "Tax"],
    total: ["Total Due", "Amount Due", "Balance Due"],
    currency: ["Currency", "Billing currency"],
  },
  es: {
    invoice: ["Factura Nº", "Factura No.", "Factura #"],
    subtotal: ["Base imponible", "Importe neto", "Subtotal"],
    tax: ["IVA", "Impuesto", "IVA"],
    total: ["Total a pagar", "Importe total", "Total factura"],
    currency: ["Moneda", "Divisa"],
  },
};

function pick<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length];
  if (value === undefined) throw new Error("Empty label set");
  return value;
}

function buildInvoice(input: BuildInput): SupportedCase {
  const { locale, layout } = input;
  const labels = LABELS[locale];
  const format = formatFor(locale, layout);
  const money = format.money;
  const subtotalMinor = input.lines.reduce((total, line) => total + line.totalMinor, 0);
  const taxMinor = Math.round(subtotalMinor * input.taxRate);
  const totalMinor = subtotalMinor + taxMinor;

  const invoiceLabel = pick(labels.invoice, input.variant);
  const subtotalLabel = pick(labels.subtotal, input.variant);
  const taxLabel = pick(labels.tax, input.variant);
  const totalLabel = pick(labels.total, input.variant);
  const currencyLabel = pick(labels.currency, input.variant);

  const numberLine =
    locale === "en" ? `${invoiceLabel} ${input.invoiceNumber}` : `${invoiceLabel} ${input.invoiceNumber}`;
  const issueLine =
    locale === "en"
      ? `Invoice Date: ${renderDate(input.issueDate, locale, format)}`
      : `Fecha de emisión: ${renderDate(input.issueDate, locale, format)}`;
  const dueLine =
    locale === "en"
      ? `Due Date: ${renderDate(input.dueDate, locale, format)}`
      : `Fecha de vencimiento: ${renderDate(input.dueDate, locale, format)}`;

  const header =
    layout === "classic"
      ? [input.vendor, "1200 Commerce Street", "Springfield, IL 62704", "", "INVOICE", numberLine]
      : [input.vendor, "1200 Commerce Street, Suite 400", "", numberLine];

  const columns =
    locale === "en"
      ? "Description                Qty         Unit        Total"
      : "Descripción                Cant.       Precio      Total";

  const rows = input.lines.map((line) => {
    const quantity = String(line.quantity).padStart(5);
    return `${line.description.padEnd(26)}${quantity}  ${money(line.unitPriceMinor).padStart(12)}  ${money(line.totalMinor).padStart(12)}`;
  });

  const totals = [
    "",
    `${subtotalLabel}: ${money(subtotalMinor)}`,
    `${taxLabel}: ${money(taxMinor)}`,
    `${totalLabel}: ${money(totalMinor)}`,
  ];

  const footer = ["", "Payment terms: 30 days", "Thank you for your business."];

  const text = [
    ...header,
    issueLine,
    dueLine,
    `${currencyLabel}: ${input.currency}`,
    `PO Number: PO-${7100 + input.variant}`,
    "",
    columns,
    ...rows,
    ...totals,
    ...footer,
  ].join("\n");

  return {
    id: input.id,
    locale,
    layout,
    tags: [locale, layout, input.currency.toLowerCase()],
    text,
    expected: {
      invoiceNumber: input.invoiceNumber,
      vendorName: input.vendor,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      currency: input.currency,
      subtotalMinor,
      taxMinor,
      totalMinor,
      lineDescriptions: input.lines.map((line) => line.description),
    },
  };
}

function makeCase(
  index: number,
  locale: Locale,
  layout: SupportedCase["layout"],
  random: () => number,
): SupportedCase {
  const vendors = locale === "en" ? VENDORS_EN : VENDORS_ES;
  const items = locale === "en" ? ITEMS_EN : ITEMS_ES;
  const currency = CURRENCIES[index % CURRENCIES.length] ?? "USD";
  const taxRate = TAX_RATES[index % TAX_RATES.length] ?? 0;

  const vendor = vendors[index % vendors.length] ?? vendors[0] ?? "Vendor";
  const lineCount = 2 + (index % 2);
  const lines: Line[] = [];
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const description = items[(index + lineIndex * 3) % items.length] ?? items[0] ?? "Item";
    const quantity = 1 + Math.floor(random() * 9);
    const unitPriceMinor = 500 + Math.floor(random() * 45_000);
    lines.push({
      description,
      quantity,
      unitPriceMinor,
      totalMinor: quantity * unitPriceMinor,
    });
  }

  // Spread the issue dates through Q1 2026 so aging and overdue math differ.
  const month = 1 + (index % 3);
  const day = 1 + ((index * 3) % 26);
  const issueDate = isoDate(2026, month, day);
  const dueDate = isoDate(2026, month + 1, Math.min(28, day + 2));

  return buildInvoice({
    id: `${locale}-${layout}-${String(index + 1).padStart(2, "0")}`,
    locale,
    layout,
    variant: index,
    vendor,
    invoiceNumber: `${locale === "en" ? "INV" : "F"}-2026-${String(1000 + index).padStart(4, "0")}`,
    issueDate,
    dueDate,
    currency,
    lines,
    taxRate,
  });
}

export function buildSupportedCases(): SupportedCase[] {
  const random = mulberry32(20260615);
  const cases: SupportedCase[] = [];
  for (let index = 0; index < 12; index += 1) {
    cases.push(makeCase(index, "en", index % 2 === 0 ? "modern" : "classic", random));
    cases.push(makeCase(index, "es", index % 2 === 0 ? "modern" : "compact", random));
  }
  return cases;
}

// -------------------------------------------------------------- degraded docs

export function buildDegradedCases(): DegradedCase[] {
  return [
    {
      id: "degraded-no-total",
      locale: "en",
      reason: "missing total",
      expectation: "total is null and flagged, nothing is invented",
      text: [
        "Apex Industrial Supply",
        "Invoice No. INV-2026-2000",
        "Invoice Date: March 3, 2026",
        "Currency: USD",
        "Subtotal: 640.00",
        "Thank you for your business.",
      ].join("\n"),
      check: (extraction) => {
        if (extraction.fields.total.value !== null) return "invented a total";
        if (!extraction.warnings.includes("TOTAL_NOT_FOUND")) return "missing TOTAL_NOT_FOUND warning";
        return null;
      },
    },
    {
      id: "degraded-no-currency",
      locale: "en",
      reason: "missing currency",
      expectation: "currency is null and the assumption is reported",
      text: [
        "Apex Industrial Supply",
        "Invoice No. INV-2026-2001",
        "Invoice Date: March 3, 2026",
        "Total Due: 716.64",
      ].join("\n"),
      check: (extraction) => {
        if (extraction.fields.currency.value !== null) return "claimed a currency";
        if (!extraction.warnings.some((warning) => warning.startsWith("CURRENCY_NOT_FOUND"))) {
          return "missing CURRENCY_NOT_FOUND warning";
        }
        return null;
      },
    },
    {
      id: "degraded-no-due-date",
      locale: "es",
      reason: "missing due date",
      expectation: "due date is null and flagged",
      text: [
        "Papelería Central",
        "Factura Nº F-2026-2002",
        "Fecha de emisión: 3 de marzo de 2026",
        "Moneda: USD",
        "Total a pagar: 535,00",
      ].join("\n"),
      check: (extraction) => {
        if (extraction.fields.dueDate.value !== null) return "invented a due date";
        if (!extraction.warnings.includes("DUE_DATE_NOT_FOUND")) return "missing DUE_DATE_NOT_FOUND";
        return null;
      },
    },
    {
      id: "degraded-ambiguous-date",
      locale: "es",
      reason: "numeric day/month ambiguity",
      expectation: "date is read but confidence drops below the review threshold",
      text: [
        "Grupo Roble",
        "Factura Nº F-2026-2003",
        "Fecha de emisión: 03/04/2026",
        "Fecha de vencimiento: 02/05/2026",
        "Moneda: USD",
        "Total a pagar: 535,00",
      ].join("\n"),
      check: (extraction) => {
        if (extraction.fields.issueDate.value === null) return "dropped the issue date";
        if (extraction.fields.issueDate.confidenceBp >= 8_000) {
          return "kept full confidence on an ambiguous date";
        }
        if (!extraction.warnings.some((warning) => warning.startsWith("ISSUE_DATE_AMBIGUOUS"))) {
          return "missing ISSUE_DATE_AMBIGUOUS warning";
        }
        return null;
      },
    },
    {
      id: "degraded-no-text-layer",
      locale: "en",
      reason: "scanned page with no text layer",
      expectation: "nothing is extracted and review is required",
      text: "??? ### ~~~ [illegible]",
      check: (extraction) => {
        const present = Object.values(extraction.fields).filter((value) => value.value !== null);
        if (present.length !== 0) return `extracted ${present.length} field(s) from noise`;
        if (!extraction.warnings.includes("TOTAL_NOT_FOUND")) return "did not report the missing total";
        return null;
      },
    },
    {
      id: "degraded-inconsistent-total",
      locale: "en",
      reason: "subtotal plus tax does not equal total",
      expectation: "the mismatch is reported, not silently accepted",
      text: [
        "Cascade Components",
        "Invoice No. INV-2026-2004",
        "Invoice Date: 2026-03-05",
        "Currency: USD",
        "Subtotal: 100.00",
        "Sales Tax: 7.00",
        "Total Due: 200.00",
      ].join("\n"),
      check: (extraction) =>
        extraction.warnings.some((warning) => warning.startsWith("TOTAL_MISMATCH"))
          ? null
          : "missing TOTAL_MISMATCH warning",
    },
    {
      id: "degraded-no-vendor",
      locale: "en",
      reason: "vendor block missing",
      expectation: "vendor is null and flagged",
      text: [
        "Invoice No. INV-2026-2005",
        "Invoice Date: 2026-03-06",
        "Due Date: 2026-04-05",
        "Currency: USD",
        "Total Due: 120.00",
      ].join("\n"),
      check: (extraction) => {
        if (!extraction.warnings.includes("VENDOR_NOT_FOUND")) return "missing VENDOR_NOT_FOUND warning";
        return null;
      },
    },
    {
      id: "degraded-not-an-invoice",
      locale: "es",
      reason: "unrelated document",
      expectation: "key fields stay null; no numbers are invented",
      text: [
        "Estimado cliente:",
        "Le recordamos que su cuenta está al día.",
        "Gracias por su preferencia.",
      ].join("\n"),
      check: (extraction) => {
        const critical = [
          extraction.fields.invoiceNumber,
          extraction.fields.subtotal,
          extraction.fields.tax,
          extraction.fields.total,
        ];
        const invented = critical.filter((value) => value.value !== null);
        if (invented.length > 0) return "extracted financial fields from a letter";
        return null;
      },
    },
  ];
}
