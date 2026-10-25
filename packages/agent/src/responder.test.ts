import { describe, expect, it } from "vitest";
import { answer, type AnswerContext } from "./responder";

const context: AnswerContext = {
  asOf: "2026-06-15",
  invoices: [
    {
      id: "inv-1",
      number: "INV-2026-1003",
      vendorName: "Acme Industrial Supply",
      currency: "USD",
      totalMinor: 119_819,
      openMinor: 119_819,
      dueDate: "2026-04-13",
      status: "open",
      sourceDocumentId: "doc-1",
    },
    {
      id: "inv-2",
      number: "INV-2026-1004",
      vendorName: "Bluewater Logistics",
      currency: "USD",
      totalMinor: 50_000,
      openMinor: 0,
      dueDate: "2026-02-01",
      status: "paid",
      sourceDocumentId: "doc-2",
    },
    {
      id: "inv-3",
      number: "FX-2026-77",
      vendorName: "Balboa Freight",
      currency: "EUR",
      totalMinor: 20_000,
      openMinor: 20_000,
      dueDate: "2026-03-01",
      status: "open",
      sourceDocumentId: "doc-3",
    },
  ],
  discrepancies: [
    {
      id: "d-1",
      kind: "duplicate_invoice",
      severity: "high",
      detail: "INV-2026-1003 appears twice with the same amount",
    },
    {
      id: "d-2",
      kind: "amount_mismatch",
      severity: "medium",
      detail: "Payment does not match the invoice total",
    },
  ],
};

describe("answer: invoice lookup", () => {
  it("answers from the matching row and cites the source document", () => {
    const result = answer("What is the status of invoice INV-2026-1003?", context, {
      locale: "en",
    });
    expect(result.intent).toBe("invoice_lookup");
    expect(result.grounded).toBe(true);
    expect(result.headline).toBe("Invoice INV-2026-1003 from Acme Industrial Supply");
    expect(result.bullets.join(" ")).toContain("Open balance");
    expect(result.citations.map((citation) => citation.ref)).toEqual(["inv-1", "doc-1"]);
    expect(result.data.totalMinor).toBe(119_819);
  });

  it("answers in Spanish with the same data", () => {
    const result = answer("Muéstrame la factura INV-2026-1003.", context, { locale: "es" });
    expect(result.headline).toBe("Factura INV-2026-1003 de Acme Industrial Supply");
    expect(result.bullets.join(" ")).toContain("Saldo pendiente");
    expect(result.citations[0]?.ref).toBe("inv-1");
  });

  it("reports a paid invoice as paid instead of guessing", () => {
    const result = answer("invoice INV-2026-1004", context);
    expect(result.data.status).toBe("paid");
    expect(result.data.openMinor).toBe(0);
  });

  it("never invents an invoice that is not in the data", () => {
    const result = answer("Where is invoice INV-5555?", context);
    expect(result.intent).toBe("unsupported");
    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
  });
});

describe("answer: overdue summary", () => {
  it("counts only open invoices past their due date", () => {
    const result = answer("Which invoices are overdue?", context, { locale: "en" });
    expect(result.intent).toBe("overdue_summary");
    expect(result.headline).toContain("2 overdue invoices");
    expect(result.data.count).toBe(2);
    expect(result.citations.map((citation) => citation.ref)).toEqual(["inv-3", "inv-1"]);
  });

  it("understands Spanish", () => {
    const result = answer("¿Qué facturas están vencidas?", context, { locale: "es" });
    expect(result.intent).toBe("overdue_summary");
    expect(result.headline).toContain("2 facturas vencidas");
  });

  it("says so plainly when nothing is overdue", () => {
    const clean: AnswerContext = { ...context, invoices: context.invoices.slice(1, 2) };
    const result = answer("anything overdue?", clean);
    expect(result.headline).toBe("No invoice is overdue as of today.");
    expect(result.citations).toEqual([]);
  });
});

describe("answer: discrepancies", () => {
  it("summarises open discrepancies with citations", () => {
    const result = answer("Are there any duplicate payments?", context, { locale: "en" });
    expect(result.intent).toBe("discrepancy_summary");
    expect(result.headline).toBe("2 open discrepancies need attention");
    expect(result.bullets.join(" ")).toContain("duplicate_invoice");
    expect(result.citations).toHaveLength(2);
  });

  it("summarises in Spanish", () => {
    const result = answer("¿Hay diferencias o duplicados?", context, { locale: "es" });
    expect(result.headline).toBe("2 discrepancias abiertas requieren atención");
  });

  it("reports an empty inbox honestly", () => {
    const result = answer("any discrepancies?", { ...context, discrepancies: [] });
    expect(result.headline).toBe("No discrepancies are open.");
    expect(result.grounded).toBe(true);
  });
});

describe("answer: fallback", () => {
  it("refuses questions it cannot ground in the workspace", () => {
    const result = answer("What is the weather in Panama?", context);
    expect(result.intent).toBe("unsupported");
    expect(result.grounded).toBe(false);
    expect(result.bullets.length).toBeGreaterThan(0);
  });

  it("passes the answer mode through for UI labelling", () => {
    expect(answer("anything overdue?", context, { mode: "cloud" }).mode).toBe("cloud");
    expect(answer("anything overdue?", context).mode).toBe("heuristic");
  });
});
