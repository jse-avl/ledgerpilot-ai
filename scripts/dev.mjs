#!/usr/bin/env node
/**
 * One command to run the whole stack.
 *
 * PGlite cannot be opened by two processes at once, so the database is started
 * first as a local Postgres-wire server, then the web app and the MCP server
 * receive its DATABASE_URL. If DATABASE_URL is already set (Neon, Docker), the
 * local server is skipped and everything connects to it directly.
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.PGLITE_HOST ?? "127.0.0.1";
const port = Number(process.env.PGLITE_PORT ?? 5433);
const localUrl = `postgres://postgres:postgres@${host}:${port}/postgres`;
const useExternal = Boolean(process.env.DATABASE_URL?.trim());
const databaseUrl = useExternal ? process.env.DATABASE_URL : localUrl;

const children = [];
let shuttingDown = false;

function log(message) {
  console.log(`[dev] ${message}`);
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    // No shell: the Node binary path contains spaces on Windows, and quoting
    // through a shell is exactly how that breaks.
    shell: false,
    env: { ...process.env, DATABASE_URL: databaseUrl, ...options.env },
    ...options,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal) log(`${command} stopped (${signal}); shutting down`);
    else if (code !== 0) log(`${command} exited with code ${code}; shutting down`);
    void shutdown(code ?? 1);
  });
  return child;
}

function waitForPort(targetPort, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ host, port: targetPort });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`The database did not open ${host}:${targetPort} in time.`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

if (useExternal) {
  log("DATABASE_URL is set: using the external database, no local socket server.");
} else {
  log(`starting the local database on ${host}:${port}`);
  start(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "packages/db/src/serve.ts"], {
    env: { DATABASE_URL: "" },
  });
  try {
    await waitForPort(port);
  } catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    await shutdown(1);
    process.exit(1);
  }
  log(`database ready at ${localUrl}`);
}

log("starting apps (web + mcp)");
start(process.execPath, [
  path.join(root, "node_modules", "turbo", "bin", "turbo"),
  "run",
  "dev",
  "--parallel",
]);
