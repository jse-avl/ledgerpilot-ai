import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { createDatabase, type DatabaseHandle } from "./client";

/**
 * The migrations folder is resolved at call time, not import time.
 *
 * Bundlers (Next/Turbopack) can evaluate this module outside a normal file
 * context, where `import.meta.dirname` is undefined. Walking up from the
 * working directory also covers running the app from `apps/web`.
 */
function resolveMigrationsDir(): string {
  const override = process.env.LEDGERPILOT_MIGRATIONS_DIR;
  if (override) return path.resolve(override);

  const metaDir = typeof import.meta.dirname === "string" ? import.meta.dirname : undefined;
  if (metaDir) {
    const candidate = path.resolve(metaDir, "../migrations");
    if (existsSync(candidate)) return candidate;
  }

  let directory = process.cwd();
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(directory, "packages", "db", "migrations");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return path.resolve(process.cwd(), "migrations");
}

async function ensureMigrationsTable(handle: DatabaseHandle): Promise<void> {
  await handle.exec(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamp with time zone not null default now()
    );
  `);
}

async function appliedMigrations(handle: DatabaseHandle): Promise<Set<string>> {
  const result = await handle.query<{ name: string }>("select name from _migrations order by name");
  return new Set(result.rows.map((row) => row.name));
}

async function applyFile(handle: DatabaseHandle, file: string, sqlText: string): Promise<void> {
  if (handle.driver === "postgres") {
    const client = await (handle.raw as Pool).connect();
    try {
      await client.query("begin");
      await client.query(sqlText);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const client = handle.raw as PGlite;
  await client.exec("begin");
  try {
    await client.exec(sqlText);
    await client.query("insert into _migrations (name) values ($1)", [file]);
    await client.exec("commit");
  } catch (error) {
    await client.exec("rollback");
    throw error;
  }
}

export interface MigrateOptions {
  readonly dir?: string;
  readonly silent?: boolean;
}

export async function runMigrations(
  handle: DatabaseHandle,
  options: MigrateOptions = {},
): Promise<string[]> {
  const directory = options.dir ?? resolveMigrationsDir();
  await ensureMigrationsTable(handle);
  const applied = await appliedMigrations(handle);

  const files = (await readdir(/* turbopackIgnore: true */ directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const executed: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = await readFile(/* turbopackIgnore: true */ path.join(directory, file), "utf8");
    await applyFile(handle, file, sqlText);
    executed.push(file);
    if (!options.silent) console.log(`  applied ${file}`);
  }

  if (!options.silent) {
    console.log(
      executed.length === 0
        ? "Database is up to date."
        : `Applied ${executed.length} migration(s).`,
    );
  }
  return executed;
}

const isMain =
  process.argv[1] !== undefined &&
  process.argv[1].replaceAll("\\", "/").endsWith("migrate.ts");

if (isMain) {
  const handle = await createDatabase();
  try {
    console.log(
      `Migrating ${handle.driver === "pglite" ? "embedded PGlite" : "Postgres"}...`,
    );
    await runMigrations(handle);
  } finally {
    await handle.close();
  }
}
