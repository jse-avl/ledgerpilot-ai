import { createHash } from "node:crypto";
import { computeTotals } from "@ledgerpilot/core";
import { money } from "@ledgerpilot/core";

/**
 * Deterministic demo dataset. Same seed -> same ids, same amounts, same
 * discrepancies, so screenshots, evals and tests stay reproducible.
 */

export interface DemoLine {
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  taxRateBp: number;
  taxMinor: number;
  totalMinor: number;
  accountCode: string;
}

export interface DemoInvoice {
  id: string;
  vendorId: string;
  vendorName: string;
  number: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  openMinor: number;
  status: "open" | "paid" | "partial";
  sourceDocumentId: string;
  lines: DemoLine[];
}

export interface DemoPayment {
  id: string;
  reference: string;
  vendorId: string | null;
  currency: string;
  amountMinor: number;
  paidAt: string;
  method: string;
}

export interface DemoDocument {
  id: string;
  kind: "invoice" | "payment_advice" | "policy" | "statement";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  pageCount: number;
  searchText: string;
  uploadedBy: string;
}

export interface DemoTenant {
  id: string;
  slug: string;
  name: string;
  currency: string;
  vendors: { id: string; name: string }[];
  invoices: DemoInvoice[];
  payments: DemoPayment[];
  documents: DemoDocument[];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function demoId(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = "8";
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function demoHash(seed: string): string {
  return createHash("sha256").update(`hash:${seed}`).digest("hex");
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error("pick() received an empty list");
  return value;
}

function intBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function addDays(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

const TENANT_BLUEPRINTS = [
  {
    slug: "northwind",
    name: "Northwind Trading Co.",
    currency: "USD",
    seed: 11,
    vendors: [
      "Apex Industrial Supply",
      "Bluewater Logistics",
      "Cascade Office Co.",
      "Delta Components",
    ],
  },
  {
    slug: "cafe-americana",
    name: "Café Americana",
    currency: "USD",
    seed: 23,
    vendors: [
      "Hacienda Los Robles",
      "Distribuidora Istmeña",
      "Panama Coffee Roasters",
      "Servicios Delta",
    ],
  },
  {
    slug: "pacific-logistics",
    name: "Pacific Logistics S.A.",
    currency: "USD",
    seed: 37,
    vendors: [
      "Balboa Freight",
      "Colón Customs Brokers",
      "Isthmus Warehousing",
      "Pacific Marine Parts",
    ],
  },
] as const;

const LINE_ITEMS = [
  ["Monthly retainer", 120_000, "6100"],
  ["Freight forwarding", 87_500, "6200"],
  ["Warehouse supplies", 34_900, "6300"],
  ["Customs clearance", 45_000, "6210"],
  ["Equipment maintenance", 76_400, "6400"],
  ["Consulting hours", 95_000, "6500"],
  ["Packaging materials", 18_750, "6310"],
  ["Software subscription", 24_000, "6600"],
] as const;

export function generateDemoData(): DemoTenant[] {
  return TENANT_BLUEPRINTS.map((blueprint) => {
    const tenantId = demoId(`tenant:${blueprint.slug}`);
    const random = mulberry32(blueprint.seed);
    const vendors = blueprint.vendors.map((name, index) => ({
      id: demoId(`vendor:${blueprint.slug}:${index}`),
      name,
    }));

    const invoices: DemoInvoice[] = [];
    const documents: DemoDocument[] = [];

    for (let index = 0; index < 12; index += 1) {
      const vendor = vendors[index % vendors.length];
      if (!vendor) throw new Error("missing vendor");
      const currency = blueprint.slug === "pacific-logistics" && index % 6 === 5 ? "EUR" : blueprint.currency;
      const lineCount = intBetween(random, 1, 3);
      const rawLines = Array.from({ length: lineCount }, () => {
        const [description, basePrice, accountCode] = pick(random, LINE_ITEMS);
        return {
          description,
          quantityMilli: intBetween(random, 1000, 4000),
          unitPrice: money(
            basePrice + intBetween(random, -5_000, 12_000),
            currency,
          ),
          taxRateBp: index % 3 === 0 ? 700 : 0,
          accountCode,
        };
      });

      const totals = computeTotals(rawLines, currency);
      const issueDate = addDays("2026-01-08", index * 9);
      const dueDate = addDays(issueDate, 30);
      const number = `INV-2026-${1000 + index}`;
      const invoiceId = demoId(`invoice:${blueprint.slug}:${index}`);

      invoices.push({
        id: invoiceId,
        vendorId: vendor.id,
        vendorName: vendor.name,
        number,
        currency,
        issueDate,
        dueDate,
        subtotalMinor: totals.subtotal.amount,
        taxMinor: totals.tax.amount,
        totalMinor: totals.total.amount,
        openMinor: totals.total.amount,
        status: "open",
        sourceDocumentId: demoId(`document:${blueprint.slug}:invoice:${index}`),
        lines: totals.lines.map((line) => ({
          description: line.description,
          quantityMilli: line.quantityMilli,
          unitPriceMinor: line.unitPrice.amount,
          taxRateBp: line.taxRateBp,
          taxMinor: line.tax.amount,
          totalMinor: line.total.amount,
          accountCode: line.accountCode ?? "6000",
        })),
      });

      documents.push({
        id: demoId(`document:${blueprint.slug}:invoice:${index}`),
        kind: "invoice",
        filename: `${number}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 48_000 + intBetween(random, 0, 90_000),
        sha256: demoHash(`${blueprint.slug}:invoice:${index}`),
        storageKey: `demo/${blueprint.slug}/invoices/${number}.pdf`,
        pageCount: 1,
        searchText: `${vendor.name} invoice ${number} ${totals.lines
          .map((line) => line.description)
          .join(" ")} ${currency} total ${(totals.total.amount / 100).toFixed(2)}`,
        uploadedBy: "demo-seed",
      });
    }

    // A true duplicate: same vendor, same number, same amount, two documents.
    const original = invoices[4];
    if (original) {
      invoices.push({
        ...original,
        id: demoId(`invoice:${blueprint.slug}:duplicate`),
        status: "open",
        sourceDocumentId: demoId(`document:${blueprint.slug}:duplicate`),
      });
      documents.push({
        id: demoId(`document:${blueprint.slug}:duplicate`),
        kind: "invoice",
        filename: `${original.number}-copy.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 51_200,
        sha256: demoHash(`${blueprint.slug}:duplicate`),
        storageKey: `demo/${blueprint.slug}/invoices/${original.number}-copy.pdf`,
        pageCount: 1,
        searchText: `${original.vendorName} invoice ${original.number} duplicate copy`,
        uploadedBy: "demo-seed",
      });
    }

    const payments: DemoPayment[] = [];
    const first = invoices[0];
    const second = invoices[1];
    const third = invoices[2];
    const fourth = invoices[3];

    if (first) {
      payments.push({
        id: demoId(`payment:${blueprint.slug}:exact`),
        reference: first.number,
        vendorId: first.vendorId,
        currency: first.currency,
        amountMinor: first.totalMinor,
        paidAt: addDays(first.dueDate, -2),
        method: "transfer",
      });
    }
    if (second) {
      payments.push({
        id: demoId(`payment:${blueprint.slug}:partial`),
        reference: second.number,
        vendorId: second.vendorId,
        currency: second.currency,
        amountMinor: Math.round(second.totalMinor * 0.4),
        paidAt: addDays(second.dueDate, 3),
        method: "transfer",
      });
    }
    if (third) {
      payments.push({
        id: demoId(`payment:${blueprint.slug}:over`),
        reference: third.number,
        vendorId: third.vendorId,
        currency: third.currency,
        amountMinor: third.totalMinor + Math.round(third.totalMinor * 0.1),
        paidAt: addDays(third.dueDate, 1),
        method: "transfer",
      });
    }
    if (fourth) {
      payments.push({
        id: demoId(`payment:${blueprint.slug}:duplicate-a`),
        reference: fourth.number,
        vendorId: fourth.vendorId,
        currency: fourth.currency,
        amountMinor: fourth.totalMinor,
        paidAt: addDays(fourth.dueDate, 4),
        method: "transfer",
      });
      payments.push({
        id: demoId(`payment:${blueprint.slug}:duplicate-b`),
        reference: fourth.number,
        vendorId: fourth.vendorId,
        currency: fourth.currency,
        amountMinor: fourth.totalMinor,
        paidAt: addDays(fourth.dueDate, 5),
        method: "transfer",
      });
    }

    payments.push({
      id: demoId(`payment:${blueprint.slug}:unmatched`),
      reference: `WIRE-${intBetween(random, 10_000, 99_999)}`,
      vendorId: vendors[3]?.id ?? null,
      currency: blueprint.currency,
      amountMinor: 13_337,
      paidAt: "2026-06-02",
      method: "wire",
    });

    for (const payment of payments) {
      documents.push({
        id: demoId(`document:${blueprint.slug}:payment:${payment.id}`),
        kind: "payment_advice",
        filename: `${payment.reference}.txt`,
        mimeType: "text/plain",
        sizeBytes: 1_024,
        sha256: demoHash(`${blueprint.slug}:${payment.id}`),
        storageKey: `demo/${blueprint.slug}/payments/${payment.reference}.txt`,
        pageCount: 1,
        searchText: `payment advice ${payment.reference} ${payment.currency} ${(payment.amountMinor / 100).toFixed(2)}`,
        uploadedBy: "demo-seed",
      });
    }

    documents.push({
      id: demoId(`document:${blueprint.slug}:policy`),
      kind: "policy",
      filename: "ap-approval-policy.md",
      mimeType: "text/markdown",
      sizeBytes: 4_096,
      sha256: demoHash(`${blueprint.slug}:policy`),
      storageKey: `demo/${blueprint.slug}/policies/ap-approval-policy.md`,
      pageCount: 2,
      searchText:
        "accounts payable approval policy: invoices above 500 USD require finance manager approval; above 10000 USD require two approvers; the proposer can never approve their own proposal; payments must match an invoice reference and amount",
      uploadedBy: "demo-seed",
    });

    return {
      id: tenantId,
      slug: blueprint.slug,
      name: blueprint.name,
      currency: blueprint.currency,
      vendors,
      invoices,
      payments,
      documents,
    };
  });
}
