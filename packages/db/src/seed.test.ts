import { type LedgerEntry, verifyLedger } from "@ledgerpilot/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, runAsTenant, type DatabaseHandle } from "../src/client";
import { generateDemoData } from "../src/demo-data";
import { seed, type SeedResult } from "../src/seed";
import * as schema from "../src/schema";

let handle: DatabaseHandle;
let result: SeedResult;

describe("demo seed", () => {
  beforeAll(async () => {
    // Pinned for the same reason as the RLS suite: this test asserts the exact
    // rows a fresh seed creates, so it must not inherit an already-seeded
    // DATABASE_URL from CI or a developer shell.
    handle = await createDatabase({ driver: "pglite", dataDir: "memory://" });
    result = await seed(handle, { silent: true });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("creates three tenants with deterministic ids", () => {
    const demo = generateDemoData();
    expect(demo.map((tenant) => tenant.slug)).toEqual([
      "northwind",
      "cafe-americana",
      "pacific-logistics",
    ]);
    expect(generateDemoData()[0]?.invoices[0]?.id).toBe(demo[0]?.invoices[0]?.id);
    expect(result.tenants).toBe(3);
  });

  it("loads invoices, lines and payments", () => {
    expect(result.invoices).toBe(39);
    expect(result.payments).toBe(18);
    expect(result.allocations).toBeGreaterThanOrEqual(12);
  });

  it("produces real discrepancies, including duplicates and partials", () => {
    expect(result.discrepancies).toBeGreaterThanOrEqual(10);
  });

  it("persists data per tenant behind RLS", async () => {
    for (const tenant of generateDemoData()) {
      const counts = await runAsTenant(handle, tenant.id, async (db) => {
        const invoices = await db.select({ id: schema.invoices.id }).from(schema.invoices);
        const payments = await db.select({ id: schema.payments.id }).from(schema.payments);
        const lines = await db.select({ id: schema.invoiceLines.id }).from(schema.invoiceLines);
        return { invoices: invoices.length, payments: payments.length, lines: lines.length };
      });
      expect(counts.invoices).toBe(tenant.invoices.length);
      expect(counts.payments).toBe(tenant.payments.length);
      expect(counts.lines).toBeGreaterThanOrEqual(tenant.invoices.length);
    }
  });

  it("writes a verifiable audit chain per tenant", async () => {
    for (const tenant of generateDemoData()) {
      const rows = await runAsTenant(handle, tenant.id, async (db) =>
        db.select().from(schema.actionLedger).orderBy(schema.actionLedger.seq),
      );
      const entries: LedgerEntry[] = rows.map((row) => ({
        seq: row.seq,
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: row.action,
        payload: row.payload,
        createdAt: row.createdAt,
        prevHash: row.prevHash,
        entryHash: row.entryHash,
      }));
      const verification = verifyLedger(entries);
      expect(verification.valid).toBe(true);
      expect(entries.length).toBe(3);
    }
  });

  it("is idempotent: a second run skips existing tenants", async () => {
    const second = await seed(handle, { silent: true });
    expect(second.tenants).toBe(0);
    expect(second.skippedTenants).toHaveLength(3);

    const total = await runAsTenant(handle, generateDemoData()[0]!.id, async (db) =>
      db.select({ id: schema.invoices.id }).from(schema.invoices),
    );
    expect(total).toHaveLength(13);
  });

  it("stores the seeded invoice counts by status", async () => {
    const tenant = generateDemoData()[0]!;
    const rows = await runAsTenant(handle, tenant.id, async (db) =>
      db
        .select({ status: schema.invoices.status, open: schema.invoices.openMinor })
        .from(schema.invoices),
    );
    expect(rows.some((row) => row.status === "paid")).toBe(true);
    expect(rows.some((row) => row.status === "partial")).toBe(true);
    expect(rows.some((row) => row.status === "open")).toBe(true);
    expect(rows.every((row) => row.open >= 0)).toBe(true);
  });
});
