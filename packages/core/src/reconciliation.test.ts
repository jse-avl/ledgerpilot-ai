import { describe, expect, it } from "vitest";
import { money } from "../src/money";
import {
  type IncomingPayment,
  type OpenInvoice,
  detectDuplicateInvoices,
  detectDuplicatePayments,
  isFullyMatched,
  reconcile,
  scoreCandidate,
} from "../src/reconciliation";

function invoice(overrides: Partial<OpenInvoice> = {}): OpenInvoice {
  return {
    id: "inv-1",
    number: "INV-1001",
    vendorId: "v-1",
    currency: "USD",
    openBalance: money(50_000, "USD"),
    dueDate: "2026-03-01",
    ...overrides,
  };
}

function payment(overrides: Partial<IncomingPayment> = {}): IncomingPayment {
  return {
    id: "pay-1",
    reference: "INV-1001",
    vendorId: "v-1",
    currency: "USD",
    amount: money(50_000, "USD"),
    paidAt: "2026-03-01",
    ...overrides,
  };
}

describe("reconciliation", () => {
  it("matches an exact reference and amount", () => {
    const result = reconcile([invoice()], [payment()]);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]).toMatchObject({
      paymentId: "pay-1",
      invoiceId: "inv-1",
      strategy: "reference_exact",
    });
    expect(result.allocations[0]?.amount.amount).toBe(50_000);
    expect(result.remainingInvoices[0]?.openBalance.amount).toBe(0);
    expect(isFullyMatched(result)).toBe(true);
  });

  it("applies partial payments and reports the remainder", () => {
    const result = reconcile([invoice()], [payment({ amount: money(20_000, "USD") })]);
    expect(result.allocations[0]?.amount.amount).toBe(20_000);
    expect(result.remainingInvoices[0]?.openBalance.amount).toBe(30_000);
    expect(result.discrepancies.map((item) => item.kind)).toContain("partial_payment");
    expect(result.unmatchedPaymentIds).toEqual([]);
    expect(isFullyMatched(result)).toBe(false);
  });

  it("detects overpayments", () => {
    const result = reconcile(
      [invoice({ openBalance: money(10_000, "USD") })],
      [payment({ amount: money(15_000, "USD") })],
    );
    expect(result.allocations[0]?.amount.amount).toBe(10_000);
    expect(result.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "overpayment", amount: money(5_000, "USD") }),
      ]),
    );
  });

  it("splits one payment across several invoices", () => {
    const invoices = [
      invoice({ id: "inv-a", number: "INVA", openBalance: money(10_000, "USD"), dueDate: "2026-03-01" }),
      invoice({ id: "inv-b", number: "INVB", openBalance: money(20_000, "USD"), dueDate: "2026-03-05" }),
    ];
    const result = reconcile(invoices, [
      payment({ reference: "INVA INVB", amount: money(30_000, "USD") }),
    ]);

    expect(result.allocations).toHaveLength(2);
    expect(result.allocations.map((allocation) => allocation.invoiceId).sort()).toEqual([
      "inv-a",
      "inv-b",
    ]);
    expect(result.remainingInvoices.every((item) => item.openBalance.amount === 0)).toBe(true);
    expect(result.unmatchedPaymentIds).toEqual([]);
  });

  it("matches a fuzzy reference when amount and vendor agree", () => {
    const result = reconcile(
      [invoice({ number: "ACME-2026-77" })],
      [payment({ reference: "ACME 77", amount: money(50_000, "USD") })],
    );
    expect(result.allocations[0]?.strategy).toBe("reference_fuzzy");
    expect(result.allocations[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("refuses weak matches instead of guessing", () => {
    const result = reconcile(
      [invoice({ number: "ZZZ-9999", dueDate: "2026-01-01" })],
      [payment({ reference: "ACME 77", amount: money(1, "USD"), paidAt: "2026-06-01" })],
    );
    expect(result.allocations).toEqual([]);
    expect(result.unmatchedPaymentIds).toEqual(["pay-1"]);
    expect(result.remainingInvoices[0]?.openBalance.amount).toBe(50_000);
  });

  it("never mixes currencies", () => {
    const result = reconcile([invoice()], [payment({ currency: "EUR", amount: money(50_000, "EUR") })]);
    expect(result.allocations).toEqual([]);
    expect(result.unmatchedPaymentIds).toEqual(["pay-1"]);
  });

  it("detects duplicate invoices", () => {
    const duplicates = detectDuplicateInvoices([
      invoice({ id: "a" }),
      invoice({ id: "b" }),
      invoice({ id: "c", number: "INV-2002" }),
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.ids).toEqual(["a", "b"]);
  });

  it("detects duplicate payments inside the window", () => {
    const duplicates = detectDuplicatePayments([
      payment({ id: "p1", paidAt: "2026-03-01" }),
      payment({ id: "p2", paidAt: "2026-03-02" }),
      payment({ id: "p3", paidAt: "2026-04-15" }),
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.ids).toEqual(["p1", "p2"]);
  });

  it("is deterministic regardless of input order", () => {
    const invoices = [invoice({ id: "a" }), invoice({ id: "b", number: "INV-2002" })];
    const payments = [
      payment({ id: "p1" }),
      payment({ id: "p2", reference: "INV-2002", amount: money(50_000, "USD") }),
    ];
    const first = reconcile(invoices, payments);
    const second = reconcile([...invoices].reverse(), [...payments].reverse());
    expect(second.allocations).toEqual(first.allocations);
  });
});

describe("scoreCandidate", () => {
  it("gives the strongest score to an exact match", () => {
    const scored = scoreCandidate(payment(), invoice(), money(50_000, "USD"));
    expect(scored.strategy).toBe("reference_exact");
    expect(scored.score).toBeGreaterThanOrEqual(90);
  });

  it("does not match on amount alone", () => {
    const scored = scoreCandidate(
      payment({ reference: "", vendorId: undefined }),
      invoice(),
      money(50_000, "USD"),
    );
    expect(scored.score).toBeLessThan(60);
  });
});
