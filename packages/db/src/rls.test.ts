import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, runAsTenant, type DatabaseHandle } from "../src/client";
import { runMigrations } from "../src/migrate";
import * as schema from "../src/schema";

const tenantA = randomUUID();
const tenantB = randomUUID();

let handle: DatabaseHandle;

function documentRow(tenantId: string, filename: string) {
  return {
    tenantId,
    kind: "invoice",
    filename,
    mimeType: "application/pdf",
    sizeBytes: 1000,
    sha256: filename.padEnd(64, "0"),
    storageKey: `test/${filename}`,
    uploadedBy: "test",
    searchText: `invoice ${filename}`,
  };
}

/** Runs a query as the least-privilege app role, the way production should. */
async function asAppRole<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  await handle.exec("set role ledgerpilot_app");
  try {
    await handle.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    return await fn();
  } finally {
    await handle.exec("reset role");
  }
}

describe("database migrations", () => {
  beforeAll(async () => {
    handle = await createDatabase({ dataDir: "memory://" });
    await runMigrations(handle, { silent: true });

    await runAsTenant(handle, tenantA, async (db) => {
      await db.insert(schema.tenants).values({ id: tenantA, slug: "tenant-a", name: "Tenant A" });
      await db.insert(schema.documents).values(documentRow(tenantA, "a-invoice.pdf"));
    });
    await runAsTenant(handle, tenantB, async (db) => {
      await db.insert(schema.tenants).values({ id: tenantB, slug: "tenant-b", name: "Tenant B" });
      await db.insert(schema.documents).values(documentRow(tenantB, "b-invoice.pdf"));
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("applies every migration exactly once", async () => {
    const applied = await handle.query<{ name: string }>("select name from _migrations order by name");
    expect(applied.rows.map((row) => row.name)).toEqual([
      "0000_large_lester.sql",
      "0001_rls.sql",
    ]);

    const secondRun = await runMigrations(handle, { silent: true });
    expect(secondRun).toEqual([]);
  });

  it("enables RLS on every tenant-scoped table", async () => {
    const policies = await handle.query<{ tablename: string }>(
      "select tablename from pg_policies where policyname = 'tenant_isolation' order by tablename",
    );
    const tables = policies.rows.map((row) => row.tablename);
    expect(tables).toEqual(
      expect.arrayContaining([
        "action_ledger",
        "documents",
        "invoices",
        "payments",
        "proposals",
        "tenants",
      ]),
    );
    expect(tables.length).toBeGreaterThanOrEqual(14);
  });

  it("hides other tenants' rows from the app role", async () => {
    const visibleToA = await asAppRole(tenantA, async () =>
      handle.query<{ tenant_id: string; filename: string }>(
        "select tenant_id, filename from documents order by filename",
      ),
    );
    expect(visibleToA.rows).toEqual([{ tenant_id: tenantA, filename: "a-invoice.pdf" }]);

    const visibleToB = await asAppRole(tenantB, async () =>
      handle.query<{ tenant_id: string; filename: string }>(
        "select tenant_id, filename from documents order by filename",
      ),
    );
    expect(visibleToB.rows).toEqual([{ tenant_id: tenantB, filename: "b-invoice.pdf" }]);
  });

  it("returns nothing when no tenant is set (deny by default)", async () => {
    await handle.exec("set role ledgerpilot_app");
    try {
      await handle.query("select set_config('app.tenant_id', '', false)");
      const result = await handle.query<{ count: string }>("select count(*)::text as count from documents");
      expect(result.rows[0]?.count).toBe("0");
    } finally {
      await handle.exec("reset role");
    }
  });

  it("blocks writing a row for another tenant", async () => {
    await expect(
      asAppRole(tenantA, async () => {
        await handle.query(
          `insert into documents (tenant_id, kind, filename, mime_type, size_bytes, sha256, storage_key, uploaded_by)
           values ($1, 'invoice', 'smuggled.pdf', 'application/pdf', 10, $2, 'test/smuggled.pdf', 'test')`,
          [tenantB, "smuggled".padEnd(64, "0")],
        );
      }),
    ).rejects.toThrow();
  });
});
