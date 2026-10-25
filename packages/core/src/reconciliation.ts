import { type Money, add, compare, isZero, money, subtract, zero } from "./money";
import { normalizeInvoiceNumber } from "./invoice";

export interface OpenInvoice {
  readonly id: string;
  readonly number: string;
  readonly vendorId: string;
  readonly currency: string;
  readonly openBalance: Money;
  readonly dueDate: string;
  readonly issueDate?: string;
}

export interface IncomingPayment {
  readonly id: string;
  readonly reference: string;
  readonly vendorId?: string;
  readonly currency: string;
  readonly amount: Money;
  readonly paidAt: string;
}

export type MatchStrategy = "reference_exact" | "reference_fuzzy" | "amount_unique" | "amount_fuzzy";

export interface Allocation {
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly amount: Money;
  readonly strategy: MatchStrategy;
  readonly confidence: number;
  readonly reasons: readonly string[];
}

export type DiscrepancyKind =
  | "unmatched_payment"
  | "partial_payment"
  | "overpayment"
  | "duplicate_invoice"
  | "duplicate_payment"
  | "no_candidates";

export type DiscrepancySeverity = "info" | "warning" | "error";

export interface Discrepancy {
  readonly kind: DiscrepancyKind;
  readonly severity: DiscrepancySeverity;
  readonly paymentId?: string;
  readonly invoiceId?: string;
  readonly amount?: Money;
  readonly detail: string;
}

export interface DuplicateGroup {
  readonly kind: "invoice" | "payment";
  readonly key: string;
  readonly ids: readonly string[];
}

export interface ReconciliationOptions {
  /** Tolerance in basis points when comparing amounts. Default 50 (0.5%). */
  readonly amountToleranceBp?: number;
  /** Maximum days between payment date and due date for a date bonus. Default 7. */
  readonly dateWindowDays?: number;
  /** Minimum score (0-100) to accept a match. Default 60. */
  readonly minimumScore?: number;
  /** Window in days to consider two identical payments duplicates. Default 2. */
  readonly duplicatePaymentWindowDays?: number;
}

export interface ReconciliationResult {
  readonly allocations: readonly Allocation[];
  readonly unmatchedPaymentIds: readonly string[];
  readonly remainingInvoices: readonly OpenInvoice[];
  readonly duplicates: readonly DuplicateGroup[];
  readonly discrepancies: readonly Discrepancy[];
}

export interface CandidateScore {
  readonly score: number;
  readonly strategy: MatchStrategy;
  readonly reasons: readonly string[];
}

const DEFAULTS = {
  amountToleranceBp: 50,
  dateWindowDays: 7,
  minimumScore: 60,
  duplicatePaymentWindowDays: 2,
} as const;

function normalizeReference(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function tokens(value: string): string[] {
  return value
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 2);
}

function daysBetween(a: string, b: string): number {
  const first = Date.parse(`${a}T00:00:00.000Z`);
  const second = Date.parse(`${b}T00:00:00.000Z`);
  if (Number.isNaN(first) || Number.isNaN(second)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((first - second) / 86_400_000));
}

function withinTolerance(a: number, b: number, toleranceBp: number): boolean {
  if (a === b) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return true;
  return Math.abs(a - b) * 10_000 <= base * toleranceBp;
}

export function scoreCandidate(
  payment: IncomingPayment,
  invoice: OpenInvoice,
  invoiceOpen: Money,
  options: ReconciliationOptions = {},
): CandidateScore {
  const toleranceBp = options.amountToleranceBp ?? DEFAULTS.amountToleranceBp;
  const dateWindow = options.dateWindowDays ?? DEFAULTS.dateWindowDays;

  let score = 0;
  let strategy: MatchStrategy = "amount_fuzzy";
  const reasons: string[] = [];

  const invoiceNumber = normalizeInvoiceNumber(invoice.number);
  const reference = normalizeReference(payment.reference);

  if (invoiceNumber.length >= 3 && reference.includes(invoiceNumber)) {
    score += 45;
    strategy = "reference_exact";
    reasons.push(`reference contains invoice number ${invoiceNumber}`);
  } else {
    const invoiceTokens = tokens(invoice.number);
    const referenceTokens = new Set(tokens(payment.reference));
    const shared = invoiceTokens.filter((token) => referenceTokens.has(token));
    if (shared.length > 0) {
      score += 25;
      strategy = "reference_fuzzy";
      reasons.push(`reference shares tokens: ${shared.join(", ")}`);
    }
  }

  const paymentAmount = payment.amount.amount;
  const open = invoiceOpen.amount;

  if (paymentAmount === open) {
    score += 25;
    reasons.push("amount matches exactly");
  } else if (withinTolerance(paymentAmount, open, toleranceBp)) {
    score += 18;
    reasons.push(`amount within ${toleranceBp}bp tolerance`);
  } else if (paymentAmount < open) {
    score += 8;
    reasons.push("partial payment");
  } else {
    score += 12;
    reasons.push("payment exceeds invoice balance");
  }

  if (payment.vendorId !== undefined && payment.vendorId === invoice.vendorId) {
    score += 15;
    reasons.push("same vendor");
  }

  const distance = daysBetween(payment.paidAt, invoice.dueDate);
  if (distance <= 3) {
    score += 8;
    reasons.push(`paid ${distance}d from due date`);
  } else if (distance <= dateWindow) {
    score += 4;
    reasons.push(`paid ${distance}d from due date (within window)`);
  }

  if (strategy === "amount_fuzzy" && paymentAmount === open) {
    strategy = "amount_unique";
  }

  return { score, strategy, reasons };
}

export function detectDuplicateInvoices(invoices: readonly OpenInvoice[]): DuplicateGroup[] {
  const groups = new Map<string, string[]>();
  for (const invoice of invoices) {
    const number = normalizeInvoiceNumber(invoice.number);
    if (number.length < 3) continue;
    const key = `${invoice.vendorId}|${number}`;
    const list = groups.get(key) ?? [];
    list.push(invoice.id);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ kind: "invoice" as const, key, ids: [...ids].sort() }));
}

export function detectDuplicatePayments(
  payments: readonly IncomingPayment[],
  windowDays: number = DEFAULTS.duplicatePaymentWindowDays,
): DuplicateGroup[] {
  const groups = new Map<string, { id: string; paidAt: string }[]>();
  for (const payment of payments) {
    const key = `${payment.vendorId ?? "?"}|${payment.currency}|${payment.amount.amount}`;
    const list = groups.get(key) ?? [];
    list.push({ id: payment.id, paidAt: payment.paidAt });
    groups.set(key, list);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((a, b) => (a.paidAt < b.paidAt ? -1 : a.paidAt > b.paidAt ? 1 : 0));
    let cluster: string[] = [];
    const flush = () => {
      if (cluster.length > 1) {
        duplicates.push({ kind: "payment", key, ids: [...cluster].sort() });
      }
    };
    for (const entry of sorted) {
      const previous = cluster.at(-1);
      const anchor = sorted.find((candidate) => candidate.id === cluster[0]);
      if (previous === undefined || anchor === undefined) {
        cluster = [entry.id];
        continue;
      }
      if (daysBetween(entry.paidAt, anchor.paidAt) <= windowDays) {
        cluster.push(entry.id);
      } else {
        flush();
        cluster = [entry.id];
      }
    }
    flush();
  }
  return duplicates;
}

/**
 * Deterministic reconciliation:
 *   1. score every payment/invoice pair in the same currency
 *   2. greedily accept the best candidate above the threshold
 *   3. allocate the smaller of payment remainder and invoice open balance
 *   4. report duplicates and discrepancies
 *
 * There is no LLM here on purpose: this is the part that must be auditable.
 * The agent's job is to explain the result, never to decide it.
 */
export function reconcile(
  invoices: readonly OpenInvoice[],
  payments: readonly IncomingPayment[],
  options: ReconciliationOptions = {},
): ReconciliationResult {
  const minimumScore = options.minimumScore ?? DEFAULTS.minimumScore;

  const openByInvoice = new Map<string, number>();
  for (const invoice of invoices) openByInvoice.set(invoice.id, invoice.openBalance.amount);

  const sortedPayments = [...payments].sort((a, b) =>
    a.paidAt === b.paidAt ? (a.id < b.id ? -1 : 1) : a.paidAt < b.paidAt ? -1 : 1,
  );

  const allocations: Allocation[] = [];
  const discrepancies: Discrepancy[] = [];
  const unmatchedPaymentIds: string[] = [];

  for (const payment of sortedPayments) {
    let remaining = payment.amount.amount;

    while (remaining > 0) {
      const effectivePayment: IncomingPayment = {
        ...payment,
        amount: money(remaining, payment.currency),
      };
      const candidates = invoices
        .filter((invoice) => invoice.currency === payment.currency)
        .map((invoice) => {
          const open = openByInvoice.get(invoice.id) ?? 0;
          if (open <= 0) return null;
          const invoiceOpen = money(open, invoice.currency);
          const scored = scoreCandidate(effectivePayment, invoice, invoiceOpen, options);
          return { invoice, invoiceOpen, ...scored };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .filter((candidate) => candidate.score >= minimumScore)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.invoice.dueDate !== b.invoice.dueDate) {
            return a.invoice.dueDate < b.invoice.dueDate ? -1 : 1;
          }
          return a.invoice.id < b.invoice.id ? -1 : 1;
        });

      const best = candidates[0];
      if (!best) {
        if (remaining === payment.amount.amount) {
          unmatchedPaymentIds.push(payment.id);
          discrepancies.push({
            kind: "unmatched_payment",
            severity: "warning",
            paymentId: payment.id,
            amount: money(remaining, payment.currency),
            detail: "No invoice reached the matching threshold",
          });
        }
        break;
      }

      const allocated = Math.min(remaining, best.invoiceOpen.amount);
      allocations.push({
        paymentId: payment.id,
        invoiceId: best.invoice.id,
        amount: money(allocated, payment.currency),
        strategy: best.strategy,
        confidence: Math.min(1, best.score / 100),
        reasons: best.reasons,
      });

      remaining -= allocated;
      openByInvoice.set(best.invoice.id, best.invoiceOpen.amount - allocated);

      if (allocated < best.invoiceOpen.amount) {
        discrepancies.push({
          kind: "partial_payment",
          severity: "info",
          paymentId: payment.id,
          invoiceId: best.invoice.id,
          amount: money(best.invoiceOpen.amount - allocated, payment.currency),
          detail: `Invoice ${best.invoice.number} remains partially open`,
        });
      }
    }

    if (remaining > 0 && !unmatchedPaymentIds.includes(payment.id)) {
      discrepancies.push({
        kind: "overpayment",
        severity: "warning",
        paymentId: payment.id,
        amount: money(remaining, payment.currency),
        detail: "Payment has an unapplied remainder",
      });
    }
  }

  const duplicates = [...detectDuplicateInvoices(invoices), ...detectDuplicatePayments(payments, options.duplicatePaymentWindowDays)];
  for (const group of duplicates) {
    discrepancies.push({
      kind: group.kind === "invoice" ? "duplicate_invoice" : "duplicate_payment",
      severity: "error",
      detail: `${group.kind} duplicate group ${group.key}: ${group.ids.join(", ")}`,
      ...(group.kind === "invoice" ? { invoiceId: group.ids[0] } : { paymentId: group.ids[0] }),
    });
  }

  const remainingInvoices = invoices.map((invoice) => ({
    ...invoice,
    openBalance: money(openByInvoice.get(invoice.id) ?? 0, invoice.currency),
  }));

  return {
    allocations,
    unmatchedPaymentIds,
    remainingInvoices,
    duplicates,
    discrepancies,
  };
}

export function totalAllocated(result: ReconciliationResult, currency: string): Money {
  const matching = result.allocations.filter((allocation) => allocation.amount.currency === currency);
  if (matching.length === 0) return zero(currency);
  return matching.reduce((acc, allocation) => add(acc, allocation.amount), zero(currency));
}

export function totalOpen(result: ReconciliationResult, currency: string): Money {
  const matching = result.remainingInvoices.filter((invoice) => invoice.currency === currency);
  if (matching.length === 0) return zero(currency);
  return matching.reduce((acc, invoice) => add(acc, invoice.openBalance), zero(currency));
}

export function isFullyMatched(result: ReconciliationResult): boolean {
  return (
    result.unmatchedPaymentIds.length === 0 &&
    result.remainingInvoices.every((invoice) => isZero(invoice.openBalance))
  );
}

export function summarizeDiscrepancies(result: ReconciliationResult): Record<DiscrepancyKind, number> {
  const summary: Record<DiscrepancyKind, number> = {
    unmatched_payment: 0,
    partial_payment: 0,
    overpayment: 0,
    duplicate_invoice: 0,
    duplicate_payment: 0,
    no_candidates: 0,
  };
  for (const discrepancy of result.discrepancies) summary[discrepancy.kind] += 1;
  return summary;
}

export function paymentFingerprint(payment: IncomingPayment): string {
  return [
    payment.vendorId ?? "unknown",
    payment.currency,
    payment.amount.amount,
    payment.paidAt,
    normalizeReference(payment.reference),
  ].join("|");
}

export function compareAllocationAmounts(a: Allocation, b: Allocation): number {
  return compare(a.amount, b.amount);
}

export function netApplied(payment: IncomingPayment, allocations: readonly Allocation[]): Money {
  const total = allocations
    .filter((allocation) => allocation.paymentId === payment.id)
    .reduce((acc, allocation) => add(acc, allocation.amount), zero(payment.currency));
  return subtract(payment.amount, total);
}
