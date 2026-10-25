import { serve } from "@hono/node-server";
import { createDatabase } from "@ledgerpilot/db";
import { runMigrations } from "@ledgerpilot/db/migrate";
import { seed } from "@ledgerpilot/db/seed";
import { createHttpApp } from "./http";
import { resolveWorkspace } from "./tenant";

/**
 * Standalone MCP server.
 *
 * Zero configuration path: with no DATABASE_URL it opens embedded PGlite,
 * migrates and seeds, then serves. Point DATABASE_URL at the local socket
 * server (`pnpm db:serve`) or Neon to share one database with the web app.
 */

const port = Number(process.env.MCP_PORT ?? 3100);
const host = process.env.MCP_HOST ?? "127.0.0.1";

const handle = await createDatabase();
console.log(
  `[mcp] database driver: ${handle.driver}${handle.driver === "pglite" ? " (embedded)" : ""}`,
);

if (handle.driver === "pglite") {
  await runMigrations(handle);
  await seed(handle, { silent: true });
}

const workspace = resolveWorkspace(process.env.MCP_TENANT);
console.log(`[mcp] workspace: ${workspace.name} (${workspace.slug})`);

const { app, handler } = createHttpApp({ handle, workspace });

const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.log(`[mcp] listening on http://${host}:${port}`);
  console.log(`[mcp] endpoint http://${host}:${port}/mcp  (protocol 2026-07-28)`);
  console.log(`[mcp] health   http://${host}:${port}/health`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[mcp] ${signal} received, shutting down`);
  server.close();
  await handler.close();
  await handle.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
