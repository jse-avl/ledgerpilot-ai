import { describe, expect, it } from "vitest";
import { createDatabase, runAsTenant } from "./client";
import * as schema from "./schema";

/**
 * Exercises the shared local database (`pnpm db:serve`) over the real Postgres
 * wire protocol. Skipped unless LEDGERPILOT_SOCKET_URL points at it, because the
 * suite must pass with nothing running.
 *
 *   pnpm db:serve
 *   LEDGERPILOT_SOCKET_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres pnpm test
 */
const url = process.env.LEDGERPILOT_SOCKET_URL;

describe.skipIf(!url)("shared database over the socket", () => {
  it("reads the seeded data and enforces tenant isolation", async () => {
    const handle = await createDatabase({ url });
    try {
      expect(handle.driver).toBe("postgres");

      const tenants = await handle.query<{ id: string; slug: string }>(
        "select id, slug from tenants order by slug",
      );
      expect(tenants.rows.length).toBeGreaterThanOrEqual(3);

      const northwind = tenants.rows.find((row) => row.slug === "northwind");
      const other = tenants.rows.find((row) => row.slug === "cafe-americana");
      if (!northwind || !other) throw new Error("expected the demo workspaces");

      const northwindInvoices = await runAsTenant(handle, northwind.id, async (db) =>
        db.select({ id: schema.invoices.id }).from(schema.invoices),
      );
      const otherInvoices = await runAsTenant(handle, other.id, async (db) =>
        db.select({ id: schema.invoices.id }).from(schema.invoices),
      );

      expect(northwindInvoices.length).toBeGreaterThan(0);
      expect(otherInvoices.length).toBeGreaterThan(0);
      const northwindIds = new Set(northwindInvoices.map((row) => row.id));
      for (const row of otherInvoices) {
        expect(northwindIds.has(row.id)).toBe(false);
      }
    } finally {
      await handle.close();
    }
  });
});
