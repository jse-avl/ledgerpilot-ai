import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, defaultDataDir } from "./client";
import { runMigrations } from "./migrate";
import { seed } from "./seed";

/**
 * Local database server.
 *
 * PGlite is single-process: two Node processes cannot open the same data
 * directory. Rather than require Docker for `pnpm dev`, this exposes the embedded
 * database over the Postgres wire protocol on localhost, so the web app, the MCP
 * server and the CLI can all share one real database.
 *
 * This is a development convenience. Production uses Neon through DATABASE_URL.
 */

const port = Number(process.env.PGLITE_PORT ?? 5433);
const host = process.env.PGLITE_HOST ?? "127.0.0.1";
const maxConnections = Number(process.env.PGLITE_MAX_CONNECTIONS ?? 10);
const dataDir = process.env.PGLITE_DIR ?? defaultDataDir();

if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== "") {
  console.error(
    "[db] DATABASE_URL is set, so the app talks to that Postgres directly. Unset it to run the local socket server.",
  );
  process.exit(1);
}

const handle = await createDatabase({ dataDir });
if (handle.driver !== "pglite") {
  console.error("[db] expected the embedded PGlite driver");
  process.exit(1);
}

console.log(`[db] data directory: ${dataDir}`);
await runMigrations(handle);
const result = await seed(handle, { silent: false });
console.log(
  `[db] seeded ${result.tenants} workspaces, ${result.invoices} invoices, ${result.payments} payments, ${result.discrepancies} discrepancies`,
);

const server = new PGLiteSocketServer({
  db: handle.raw as PGlite,
  port,
  host,
  maxConnections,
  // PGlite executes one statement at a time; the queue is the point.
  debug: process.env.PGLITE_DEBUG === "1",
});

await server.start();
const url = `postgres://postgres:postgres@${host}:${port}/postgres`;
console.log(`[db] listening on ${host}:${port} (max ${maxConnections} connections)`);
console.log(`[db] DATABASE_URL=${url}`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[db] ${signal} received, shutting down`);
  await server.stop();
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
