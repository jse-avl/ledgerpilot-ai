#!/usr/bin/env node
/**
 * `pnpm setup` — from a fresh clone to a working demo, with no keys and no
 * Docker. It is safe to run repeatedly: every step checks before it acts.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    ...options,
  });
  if (result.status !== 0) {
    console.error(`\n[setup] "${command} ${args.join(" ")}" failed.`);
    process.exit(result.status ?? 1);
  }
}

function step(title) {
  console.log(`\n[setup] ${title}`);
}

step("checking Node.js");
const major = Number(process.versions.node.split(".")[0]);
if (Number.isNaN(major) || major < 22) {
  console.error(`[setup] Node.js 22.12+ is required; found ${process.versions.node}.`);
  process.exit(1);
}
console.log(`[setup] Node.js ${process.versions.node}`);

step("preparing .env");
const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  console.log("[setup] .env already exists; leaving it untouched.");
} else if (existsSync(path.join(root, ".env.example"))) {
  copyFileSync(path.join(root, ".env.example"), envPath);
  console.log("[setup] created .env from .env.example (every value is optional).");
} else {
  console.log("[setup] no .env.example found; continuing with process environment only.");
}

step("installing dependencies");
run("pnpm", ["install"]);

step("migrating and seeding the embedded database");
run("pnpm", ["--filter", "@ledgerpilot/db", "run", "seed"]);

step("capability check (AI is optional)");
run("pnpm", ["run", "doctor"]);

console.log(`
[setup] Done.

  pnpm dev      start the database, the web app and the MCP server
  pnpm test     run every test suite
  pnpm doctor   see what is running (cloud, local or heuristic)
`);
