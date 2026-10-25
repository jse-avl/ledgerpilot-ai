import { randomUUID } from "node:crypto";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runAsTenant, schema, type DatabaseHandle, createDatabase } from "@ledgerpilot/db";
import { generateDemoData } from "@ledgerpilot/db/demo-data";
import { seed } from "@ledgerpilot/db/seed";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLedgerPilotServer } from "./server";
import { resolveWorkspace, type Workspace } from "./tenant";

let handle: DatabaseHandle;
let client: Client;
let server: ReturnType<typeof createLedgerPilotServer>;
let workspace: Workspace;

const paymentId = randomUUID();
const invoiceId = randomUUID();

async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

function dataOf(result: Awaited<ReturnType<typeof call>>): Record<string, any> {
  // The SDK validates structuredContent against the tool's output schema, so
  // reaching this cast already proves the contract holds.
  return result.structuredContent as Record<string, any>;
}

function textOf(result: Awaited<ReturnType<typeof call>>): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/**
 * Inserts a clean invoice/payment pair. Write tests each need their own pair:
 * a pending proposal is intentionally single-use per pair, so sharing one would
 * make the tests depend on execution order.
 */
async function seedPair(options: { openMinor?: number; paymentMinor?: number } = {}) {
  const ids = { invoiceId: randomUUID(), paymentId: randomUUID() };
  const openMinor = options.openMinor ?? 100_000;
  const paymentMinor = options.paymentMinor ?? 100_000;
  const suffix = ids.invoiceId.slice(0, 8).toUpperCase();

  await runAsTenant(handle, workspace.id, async (db) => {
    await db.insert(schema.invoices).values({
      id: ids.invoiceId,
      tenantId: workspace.id,
      vendorId: "vendor-test",
      vendorName: "Test Vendor",
      number: `TEST-${suffix}`,
      normalizedNumber: `TEST${suffix}`,
      currency: "USD",
      issueDate: "2026-05-01",
      dueDate: "2026-05-31",
      subtotalMinor: openMinor,
      taxMinor: 0,
      totalMinor: openMinor,
      openMinor,
      status: "open",
    });
    await db.insert(schema.payments).values({
      id: ids.paymentId,
      tenantId: workspace.id,
      reference: `WIRE-${suffix}`,
      vendorId: "vendor-test",
      currency: "USD",
      amountMinor: paymentMinor,
      paidAt: "2026-05-20",
      method: "transfer",
      fingerprint: `test-${suffix}`,
    });
  });

  return ids;
}

beforeAll(async () => {
  handle = await createDatabase({ dataDir: "memory://" });
  await seed(handle, { silent: true });
  workspace = resolveWorkspace("northwind");

  // A clean invoice + payment pair so the proposal tests do not depend on what
  // the reconciliation seed already allocated.
  await runAsTenant(handle, workspace.id, async (db) => {
    await db.insert(schema.invoices).values({
      id: invoiceId,
      tenantId: workspace.id,
      vendorId: "vendor-test",
      vendorName: "Test Vendor",
      number: "TEST-9001",
      normalizedNumber: "TEST9001",
      currency: "USD",
      issueDate: "2026-05-01",
      dueDate: "2026-05-31",
      subtotalMinor: 100_000,
      taxMinor: 0,
      totalMinor: 100_000,
      openMinor: 100_000,
      status: "open",
    });
    await db.insert(schema.payments).values({
      id: paymentId,
      tenantId: workspace.id,
      reference: "WIRE-TEST-1",
      vendorId: "vendor-test",
      currency: "USD",
      amountMinor: 300_000,
      paidAt: "2026-05-20",
      method: "transfer",
      fingerprint: "test-fingerprint",
    });
  });

  server = createLedgerPilotServer({ handle, workspace });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "ledgerpilot-tests", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await handle.close();
});

describe("tool contract", () => {
  it("exposes read tools plus a single proposal tool", async () => {
    const listing = await client.listTools();
    const names = listing.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "get_invoice",
      "health_check",
      "list_discrepancies",
      "propose_action",
      "search_documents",
    ]);
    for (const tool of listing.tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("marks the write tool as destructive and the read tools as read-only", async () => {
    const listing = await client.listTools();
    const byName = new Map(listing.tools.map((tool) => [tool.name, tool]));
    expect(byName.get("search_documents")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("propose_action")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("propose_action")?.annotations?.destructiveHint).toBe(true);
  });
});

describe("health_check", () => {
  it("reports real counts and the capability state", async () => {
    const result = await call("health_check");
    expect(result.isError).not.toBe(true);
    const data = dataOf(result);
    expect(data.status).toBe("ok");
    expect(data.driver).toBe("pglite");
    expect(data.workspace.slug).toBe("northwind");
    expect(data.counts.invoices).toBe(14);
    expect(data.counts.documents).toBeGreaterThan(10);
    expect(data.counts.ledgerEntries).toBeGreaterThan(0);
    expect(data.capabilities.capabilities).toHaveLength(5);
    expect(["cloud", "local", "heuristic"]).toContain(data.capabilities.resolvedMode);
  });
});

describe("search_documents", () => {
  it("finds seeded documents with a citable snippet", async () => {
    const result = await call("search_documents", { query: "duplicate" });
    const data = dataOf(result);
    expect(data.count).toBeGreaterThan(0);
    expect(data.strategy).toBe("full_text");
    expect(data.results[0].snippet.length).toBeGreaterThan(0);
  });

  it("falls back to substring matching for partial words", async () => {
    const result = await call("search_documents", { query: "invoi" });
    const data = dataOf(result);
    expect(data.strategy).toBe("substring");
    expect(data.count).toBeGreaterThan(0);
    expect(data.results[0].rank).toBe(0);
  });

  it("returns an empty result instead of guessing", async () => {
    const result = await call("search_documents", { query: "zeppelin" });
    const data = dataOf(result);
    expect(data.count).toBe(0);
    expect(data.results).toEqual([]);
  });
});

describe("get_invoice", () => {
  it("returns an invoice with lines and its source document", async () => {
    const result = await call("get_invoice", { reference: "INV-2026-1000" });
    const data = dataOf(result);
    expect(data.invoice.number).toBe("INV-2026-1000");
    expect(data.invoice.currency).toBe("USD");
    expect(data.lines.length).toBeGreaterThan(0);
    expect(data.sourceDocument.filename).toContain("INV-2026-1000");
  });

  it("returns a typed error for an unknown number", async () => {
    const result = await call("get_invoice", { reference: "INV-0000-0000" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("INVOICE_NOT_FOUND");
  });

  it("cannot read another workspace's invoice", async () => {
    const other = generateDemoData()[1];
    if (!other) throw new Error("expected a second demo tenant");
    const result = await call("get_invoice", { reference: other.invoices[0]?.id ?? "" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("INVOICE_NOT_FOUND");
  });
});

describe("list_discrepancies", () => {
  it("lists open exceptions with severity", async () => {
    const result = await call("list_discrepancies", { status: "open" });
    const data = dataOf(result);
    expect(data.count).toBeGreaterThan(0);
    const kinds = new Set(data.discrepancies.map((row: { kind: string }) => row.kind));
    expect(kinds.size).toBeGreaterThan(0);
    for (const row of data.discrepancies) {
      expect(["error", "warning", "info"]).toContain(row.severity);
      expect(row.status).toBe("open");
    }
  });
});

describe("propose_action", () => {
  it("creates a pending proposal without moving money", async () => {
    const result = await call("propose_action", {
      type: "allocate_payment",
      paymentId,
      invoiceId,
      amountMinor: 40_000,
      note: "matcher: exact reference, partial amount",
    });
    expect(result.isError).not.toBe(true);
    const data = dataOf(result);
    expect(data.status).toBe("pending_approval");
    expect(data.executed).toBe(false);
    expect(data.kind).toBe("allocate_payment");
    expect(data.payload.amountMinor).toBe(40_000);
    expect(data.nonce.length).toBeGreaterThan(10);
    expect(data.approval.decision).toBe("requires_approval");
    expect(data.approval.requiredRoles.length).toBeGreaterThan(0);
    expect(data.approval.excludedApproverIds).toEqual(["mcp:agent"]);

    await runAsTenant(handle, workspace.id, async (db) => {
      const [proposal] = await db
        .select()
        .from(schema.proposals)
        .where(eq(schema.proposals.id, data.proposalId));
      expect(proposal?.status).toBe("pending_approval");

      const [invoice] = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoiceId));
      expect(invoice?.openMinor).toBe(100_000);

      const allocations = await db
        .select()
        .from(schema.paymentAllocations)
        .where(eq(schema.paymentAllocations.invoiceId, invoiceId));
      expect(allocations).toHaveLength(0);
    });
  });

  it("rejects an amount above the invoice's open balance", async () => {
    const result = await call("propose_action", {
      type: "allocate_payment",
      paymentId,
      invoiceId,
      amountMinor: 200_000,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("AMOUNT_EXCEEDS_INVOICE");
  });

  it("refuses a second pending proposal for the same pair", async () => {
    const pair = await seedPair({ openMinor: 100_000, paymentMinor: 100_000 });
    const first = await call("propose_action", {
      type: "allocate_payment",
      paymentId: pair.paymentId,
      invoiceId: pair.invoiceId,
      amountMinor: 1_000,
    });
    expect(first.isError).not.toBe(true);
    const second = await call("propose_action", {
      type: "allocate_payment",
      paymentId: pair.paymentId,
      invoiceId: pair.invoiceId,
      amountMinor: 1_000,
    });
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain("PROPOSAL_EXISTS");
  });

  it("flags an open discrepancy for review", async () => {
    const list = dataOf(await call("list_discrepancies", { status: "open" }));
    const target = list.discrepancies[0] as { id: string };
    const result = await call("propose_action", {
      type: "flag_discrepancy",
      discrepancyId: target.id,
      note: "controller should review before closing",
    });
    expect(result.isError).not.toBe(true);
    expect(dataOf(result).kind).toBe("flag_discrepancy");
  });

  it("writes a verifiable audit entry for each proposal", async () => {
    const rows = await runAsTenant(handle, workspace.id, async (db) =>
      db.select().from(schema.actionLedger).orderBy(schema.actionLedger.seq),
    );
    const created = rows.filter((row) => row.action === "proposal.created");
    expect(created.length).toBeGreaterThanOrEqual(1);
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      if (!previous || !current) throw new Error("missing ledger row");
      expect(current.prevHash).toBe(previous.entryHash);
      expect(current.seq).toBe(previous.seq + 1);
    }
  });
});
