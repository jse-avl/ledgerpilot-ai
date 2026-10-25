import { createMcpHandler } from "@modelcontextprotocol/server";
import type { DatabaseHandle } from "@ledgerpilot/db";
import { Hono } from "hono";
import { SERVER_INFO, createLedgerPilotServer } from "./server";
import type { Workspace } from "./tenant";

/**
 * HTTP surface: a plain `/health` endpoint for humans and uptime checks, and
 * `/mcp` for the protocol. The MCP handler is stateless per request (the
 * 2026-07-28 model), so the process holds no session map.
 */
export function createHttpApp(options: { handle: DatabaseHandle; workspace: Workspace }) {
  const { handle, workspace } = options;

  const handler = createMcpHandler(() => createLedgerPilotServer({ handle, workspace }), {
    onerror: (error) => {
      console.error(`[mcp] ${error.name}: ${error.message}`);
    },
  });

  const app = new Hono();

  app.use("/mcp", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, Mcp-Protocol-Version, Authorization");
    c.header("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
  });

  app.options("/mcp", (c) => {
    c.header("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    return c.body(null, 204);
  });

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      server: SERVER_INFO,
      workspace: { slug: workspace.slug, name: workspace.name },
      mcp: "/mcp",
      protocol: "2026-07-28",
    }),
  );

  app.all("/mcp", (c) => handler.fetch(c.req.raw));

  return { app, handler };
}
