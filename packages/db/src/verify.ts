import { verifyLedger, type LedgerEntry } from "@ledgerpilot/core";
import { createDatabase, runAsTenant, type DatabaseHandle } from "./client";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

/**
 * `pnpm db:verify` — checks a real Postgres deployment (CI service, Neon, or a
 * local server) against the guarantees the demo relies on:
 *
 *   1. migrations apply cleanly and are idempotent
 *   2. the demo seed is present
 *   3. Row Level Security actually isolates tenants through the app role
 *   4. the audit ledger still verifies end to end
 *
 * The embedded PGlite path is covered by the unit tests; this command exists for
 * the databases where deployment mistakes hide.
 */

interface TenantRow {
  readonly id: string;
  readonly slug: string;
}

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    console.log(`  FAIL  ${message}`);
    failures.push(message);
  }
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("[verify] DATABASE_URL is required. Point it at the database to verify.");
  process.exit(1);
}

const handle: DatabaseHandle = await createDatabase({ url });
console.log(`[verify] driver: ${handle.driver}`);

try {
  const applied = await runMigrations(handle, { silent: true });
  const again = await runMigrations(handle, { silent: true });
  check(again.length === 0, `migrations are idempotent (${applied.length} applied this run)`);

  const role = await handle.query<{ present: boolean }>(
    "select exists(select 1 from pg_roles where rolname = 'ledgerpilot_app') as present",
  );
  check(role.rows[0]?.present === true, "application role ledgerpilot_app exists");

  const tenants = await handle.query<TenantRow>("select id, slug from tenants order by slug");
  check(tenants.rows.length >= 3, `demo workspaces present (${tenants.rows.length})`);

  const counts = await handle.query<{ invoices: number; payments: number; ledger: number }>(
    `select
       (select count(*)::int from invoices) as invoices,
       (select count(*)::int from payments) as payments,
       (select count(*)::int from action_ledger) as ledger`,
  );
  const summary = counts.rows[0];
  check((summary?.invoices ?? 0) > 0, `invoices seeded (${summary?.invoices ?? 0})`);
  check((summary?.payments ?? 0) > 0, `payments seeded (${summary?.payments ?? 0})`);
  check((summary?.ledger ?? 0) > 0, `audit entries seeded (${summary?.ledger ?? 0})`);

  const [first, second] = tenants.rows;
  if (!first || !second) throw new Error("Two demo workspaces are required for the isolation check.");

  const idsFor = (tenantId: string) =>
    runAsTenant(handle, tenantId, async (db) =>
      db.select({ id: schema.invoices.id }).from(schema.invoices),
    );

  const firstIds = new Set((await idsFor(first.id)).map((row) => row.id));
  const secondIds = (await idsFor(second.id)).map((row) => row.id);
  check(firstIds.size > 0, `${first.slug} can read its own invoices (${firstIds.size})`);
  check(secondIds.length > 0, `${second.slug} can read its own invoices (${secondIds.length})`);
  check(
    secondIds.every((id) => !firstIds.has(id)),
    "tenant isolation holds through the application role",
  );

  // An empty tenant context must see nothing. This is the failure mode that
  // matters: a missing `set_config` should deny, not leak.
  const withoutTenant = await runAsTenant(handle, "00000000-0000-0000-0000-000000000000", async (db) =>
    db.select({ id: schema.invoices.id }).from(schema.invoices),
  );
  check(withoutTenant.length === 0, "an unknown tenant context sees no rows");

  const ledgerRows = await runAsTenant(handle, first.id, async (db) => {
    const rows = await db.select().from(schema.actionLedger);
    return rows;
  });
  const entries: LedgerEntry[] = ledgerRows
    .sort((a, b) => a.seq - b.seq)
    .map((row) => ({
      seq: row.seq,
      tenantId: row.tenantId,
      actorId: row.actorId,
      action: row.action,
      payload: row.payload as Record<string, unknown>,
      createdAt: row.createdAt,
      prevHash: row.prevHash,
      entryHash: row.entryHash,
    }));
  const verified = verifyLedger(entries);
  check(verified.valid, `audit ledger verifies (${entries.length} entries, ${first.slug})`);
} catch (error) {
  console.error(`[verify] ${error instanceof Error ? error.message : String(error)}`);
  failures.push("verification threw");
} finally {
  await handle.close();
}

if (failures.length > 0) {
  console.error(`\n[verify] ${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\n[verify] All checks passed.");
