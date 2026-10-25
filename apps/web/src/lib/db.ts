import { createDatabase, type DatabaseHandle } from "@ledgerpilot/db";
import { runMigrations } from "@ledgerpilot/db/migrate";
import { seed } from "@ledgerpilot/db/seed";

/**
 * One database handle per server process.
 *
 * Next may evaluate this module more than once (route handlers, server
 * components, hot reload), so the promise lives on globalThis. The embedded
 * PGlite path migrates and seeds on first use, which makes `next dev` work on a
 * fresh clone even without running `pnpm setup` first.
 */

const globalForDb = globalThis as unknown as {
  __ledgerpilotDb?: Promise<DatabaseHandle>;
};

async function connect(): Promise<DatabaseHandle> {
  const handle = await createDatabase();
  if (handle.driver === "pglite") {
    await runMigrations(handle, { silent: true });
    await seed(handle, { silent: true });
  }
  return handle;
}

export function getDatabase(): Promise<DatabaseHandle> {
  globalForDb.__ledgerpilotDb ??= connect();
  return globalForDb.__ledgerpilotDb;
}
