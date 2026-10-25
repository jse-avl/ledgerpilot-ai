import { format, money, normalizeInvoiceNumber } from "@ledgerpilot/core";
import { intlLocale, type Locale } from "./i18n";

/**
 * Deterministic, data-backed answers.
 *
 * When no model is configured this is the whole "chat" experience: intent
 * detection, arithmetic over real rows, and citations. It never invents a
 * number, and it says so when it cannot answer.
 */

export type AnswerMode = "heuristic" | "local" | "cloud";

export type AnswerIntent =
  | "invoice_lookup"
  | "overdue_summary"
  | "discrepancy_summary"
  | "unsupported";

export interface InvoiceFact {
  readonly id: string;
  readonly number: string;
  readonly vendorName: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly openMinor: number;
  readonly dueDate: string;
  readonly status: string;
  readonly sourceDocumentId: string | null;
}

export interface DiscrepancyFact {
  readonly id: string;
  readonly kind: string;
  readonly severity: string;
  readonly detail: string;
}

export interface AnswerContext {
  readonly invoices: readonly InvoiceFact[];
  readonly discrepancies: readonly DiscrepancyFact[];
  readonly asOf: string;
}

export interface Citation {
  readonly label: string;
  /** Stable identifier (document id, invoice id, discrepancy id). */
  readonly ref: string;
}

export interface Answer {
  readonly intent: AnswerIntent;
  readonly locale: Locale;
  readonly mode: AnswerMode;
  readonly headline: string;
  readonly bullets: readonly string[];
  readonly citations: readonly Citation[];
  /** True when every statement is backed by rows in the context. */
  readonly grounded: boolean;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface AnswerOptions {
  readonly locale?: Locale;
  readonly mode?: AnswerMode;
}

function formatMoney(amountMinor: number, currency: string, locale: Locale): string {
  return format(money(amountMinor, currency), intlLocale(locale));
}

function isOverdue(invoice: InvoiceFact, asOf: string): boolean {
  return invoice.openMinor > 0 && invoice.dueDate < asOf;
}

function findInvoiceByQuestion(question: string, invoices: readonly InvoiceFact[]): InvoiceFact | null {
  const normalizedQuestion = normalizeInvoiceNumber(question);
  if (normalizedQuestion === "") return null;

  const matches = invoices.filter((invoice) => {
    const normalized = normalizeInvoiceNumber(invoice.number);
    return normalized.length >= 4 && normalizedQuestion.includes(normalized);
  });

  // A duplicated invoice number legitimately yields several rows; prefer the
  // one with the most money still open so the answer is the useful one.
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => b.openMinor - a.openMinor);
  return sorted[0] ?? null;
}

function isOverdueQuestion(question: string): boolean {
  return /overdue|past\s+due|late|aging|vencid|atrasad|por\s+pagar|pendiente/i.test(question);
}

function isDiscrepancyQuestion(question: string): boolean {
  return /discrepanc|duplicate|duplicad|mismatch|difference|diferencia|exception|excepci[oó]n/i.test(
    question,
  );
}

const COPY = {
  en: {
    invoiceHeadline: (number: string, vendor: string) => `Invoice ${number} from ${vendor}`,
    invoiceBullets: (args: {
      total: string;
      open: string;
      dueDate: string;
      status: string;
      document: string | null;
    }) => [
      `Total: ${args.total}`,
      `Open balance: ${args.open}`,
      `Due date: ${args.dueDate}`,
      `Status: ${args.status}`,
      ...(args.document ? [`Source document: ${args.document}`] : []),
    ],
    overdueHeadline: (count: number, total: string) =>
      `${count} overdue invoice${count === 1 ? "" : "s"} totalling ${total}`,
    overdueEmpty: "No invoice is overdue as of today.",
    overdueBullet: (number: string, vendor: string, open: string, dueDate: string) =>
      `${number} · ${vendor} · ${open} open · due ${dueDate}`,
    discrepancyHeadline: (count: number) =>
      `${count} open discrepanc${count === 1 ? "y" : "ies"} need attention`,
    discrepancyEmpty: "No discrepancies are open.",
    discrepancyBullet: (kind: string, severity: string, detail: string) =>
      `${kind} (${severity}): ${detail}`,
    unsupportedHeadline: "I can only answer from the data in this workspace",
    unsupportedBullets: [
      "Try: “Which invoices are overdue?”",
      "Try: “Show me invoice INV-2026-1003.”",
      "Try: “Any duplicate or mismatched payments?”",
    ],
    asOf: (date: string) => `As of ${date}`,
    citationInvoice: (number: string) => `Invoice ${number}`,
    citationDocument: (filename: string) => `Document ${filename}`,
    citationDiscrepancy: (kind: string) => `Discrepancy ${kind}`,
  },
  es: {
    invoiceHeadline: (number: string, vendor: string) => `Factura ${number} de ${vendor}`,
    invoiceBullets: (args: {
      total: string;
      open: string;
      dueDate: string;
      status: string;
      document: string | null;
    }) => [
      `Total: ${args.total}`,
      `Saldo pendiente: ${args.open}`,
      `Vencimiento: ${args.dueDate}`,
      `Estado: ${args.status}`,
      ...(args.document ? [`Documento de origen: ${args.document}`] : []),
    ],
    overdueHeadline: (count: number, total: string) =>
      `${count} factura${count === 1 ? "" : "s"} vencida${count === 1 ? "" : "s"} por ${total}`,
    overdueEmpty: "Ninguna factura está vencida a la fecha de hoy.",
    overdueBullet: (number: string, vendor: string, open: string, dueDate: string) =>
      `${number} · ${vendor} · ${open} pendiente · vence el ${dueDate}`,
    discrepancyHeadline: (count: number) =>
      `${count} discrepancia${count === 1 ? "" : "s"} abierta${count === 1 ? "" : "s"} requiere${count === 1 ? "" : "n"} atención`,
    discrepancyEmpty: "No hay discrepancias abiertas.",
    discrepancyBullet: (kind: string, severity: string, detail: string) =>
      `${kind} (${severity}): ${detail}`,
    unsupportedHeadline: "Solo puedo responder con los datos de este espacio de trabajo",
    unsupportedBullets: [
      "Prueba: «¿Qué facturas están vencidas?»",
      "Prueba: «Muéstrame la factura INV-2026-1003.»",
      "Prueba: «¿Hay pagos duplicados o con diferencias?»",
    ],
    asOf: (date: string) => `Al ${date}`,
    citationInvoice: (number: string) => `Factura ${number}`,
    citationDocument: (filename: string) => `Documento ${filename}`,
    citationDiscrepancy: (kind: string) => `Discrepancia ${kind}`,
  },
} as const;

function sumByCurrency(
  invoices: readonly InvoiceFact[],
): { currency: string; amountMinor: number }[] {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + invoice.openMinor);
  }
  return [...totals.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function answer(
  question: string,
  context: AnswerContext,
  options: AnswerOptions = {},
): Answer {
  const locale = options.locale ?? "en";
  const mode = options.mode ?? "heuristic";
  const copy = COPY[locale];
  const trimmed = question.trim();

  const invoice = findInvoiceByQuestion(trimmed, context.invoices);
  if (invoice) {
    const citations: Citation[] = [
      { label: copy.citationInvoice(invoice.number), ref: invoice.id },
    ];
    if (invoice.sourceDocumentId) {
      citations.push({
        label: copy.citationDocument(invoice.sourceDocumentId),
        ref: invoice.sourceDocumentId,
      });
    }
    return {
      intent: "invoice_lookup",
      locale,
      mode,
      headline: copy.invoiceHeadline(invoice.number, invoice.vendorName),
      bullets: copy.invoiceBullets({
        total: formatMoney(invoice.totalMinor, invoice.currency, locale),
        open: formatMoney(invoice.openMinor, invoice.currency, locale),
        dueDate: invoice.dueDate,
        status: invoice.status,
        document: invoice.sourceDocumentId,
      }),
      citations,
      grounded: true,
      data: {
        invoiceId: invoice.id,
        number: invoice.number,
        currency: invoice.currency,
        totalMinor: invoice.totalMinor,
        openMinor: invoice.openMinor,
        dueDate: invoice.dueDate,
        status: invoice.status,
      },
    };
  }

  if (isOverdueQuestion(trimmed)) {
    const overdue = context.invoices
      .filter((item) => isOverdue(item, context.asOf))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const totals = sumByCurrency(overdue);
    const totalLabel =
      totals.length === 0
        ? formatMoney(0, "USD", locale)
        : totals.map((total) => formatMoney(total.amountMinor, total.currency, locale)).join(" + ");

    return {
      intent: "overdue_summary",
      locale,
      mode,
      headline:
        overdue.length === 0
          ? copy.overdueEmpty
          : copy.overdueHeadline(overdue.length, totalLabel),
      bullets:
        overdue.length === 0
          ? [copy.asOf(context.asOf)]
          : [
              copy.asOf(context.asOf),
              ...overdue
                .slice(0, 5)
                .map((item) =>
                  copy.overdueBullet(
                    item.number,
                    item.vendorName,
                    formatMoney(item.openMinor, item.currency, locale),
                    item.dueDate,
                  ),
                ),
            ],
      citations: overdue.slice(0, 5).map((item) => ({
        label: copy.citationInvoice(item.number),
        ref: item.id,
      })),
      grounded: true,
      data: {
        asOf: context.asOf,
        count: overdue.length,
        totals,
        invoices: overdue.slice(0, 5).map((item) => item.id),
      },
    };
  }

  if (isDiscrepancyQuestion(trimmed)) {
    const open = [...context.discrepancies].sort((a, b) => a.kind.localeCompare(b.kind));
    return {
      intent: "discrepancy_summary",
      locale,
      mode,
      headline:
        open.length === 0 ? copy.discrepancyEmpty : copy.discrepancyHeadline(open.length),
      bullets: open
        .slice(0, 5)
        .map((item) => copy.discrepancyBullet(item.kind, item.severity, item.detail)),
      citations: open.slice(0, 5).map((item) => ({
        label: copy.citationDiscrepancy(item.kind),
        ref: item.id,
      })),
      grounded: true,
      data: {
        count: open.length,
        byKind: open.reduce<Record<string, number>>((acc, item) => {
          acc[item.kind] = (acc[item.kind] ?? 0) + 1;
          return acc;
        }, {}),
      },
    };
  }

  return {
    intent: "unsupported",
    locale,
    mode,
    headline: copy.unsupportedHeadline,
    bullets: copy.unsupportedBullets,
    citations: [],
    grounded: false,
    data: { question: trimmed },
  };
}
