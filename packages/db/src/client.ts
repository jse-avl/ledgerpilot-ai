import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export type DriverKind = "pglite" | "postgres";

export interface DatabaseHandle {
  readonly db: Database;
  readonly driver: DriverKind;
  readonly raw: PGlite | Pool;
  query<T>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  /** Postgres connection string. Falls back to process.env.DATABASE_URL. */
  readonly url?: string;
  /** PGlite data directory. Defaults to <repo>/.data/pglite. Use "memory://" for tests. */
  readonly dataDir?: string;
}

/** Walks up from the current directory to find the workspace root. */
export function findRepoRoot(start: string = process.cwd()): string {
  let directory = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path.resolve(start);
}

export function defaultDataDir(): string {
  return path.join(findRepoRoot(), ".data", "pglite");
}

/**
 * PGlite creates its data directory but not the parent, so a fresh clone fails
 * with ENOENT on `.data/pglite`. Create the parent ourselves; in-memory and
 * non-filesystem URLs are passed through untouched.
 */
function ensureDataDir(dataDir: string): string {
  if (dataDir.includes("://")) return dataDir;
  mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  return dataDir;
}

/**
 * One schema, two drivers:
 *   - no DATABASE_URL -> embedded PGlite (zero install, works on a fresh clone)
 *   - DATABASE_URL    -> any Postgres 18, including Neon's pooled connection
 *
 * The PGlite instance is cast to the node-postgres database type because both
 * adapters expose the same Drizzle query builder over the same SQL dialect.
 */
export async function createDatabase(
  options: CreateDatabaseOptions = {},
): Promise<DatabaseHandle> {
  const url = options.url ?? process.env.DATABASE_URL;
  const dataDir = options.dataDir ?? process.env.PGLITE_DIR ?? defaultDataDir();

  if (url && url.trim() !== "") {
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 5),
      ...(url.includes("neon.tech") ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    return {
      db: drizzleNode(pool, { schema }),
      driver: "postgres",
      raw: pool,
      async query<T>(text: string, params: readonly unknown[] = []) {
        const result = await pool.query(text, params as unknown[]);
        return { rows: result.rows as T[] };
      },
      async exec(text: string) {
        await pool.query(text);
      },
      async close() {
        await pool.end();
      },
    };
  }

  const client = new PGlite(ensureDataDir(dataDir));
  await client.waitReady;

  return {
    db: drizzlePglite(client, { schema }) as unknown as Database,
    driver: "pglite",
    raw: client,
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await client.query<T>(text, params as unknown[]);
      return { rows: result.rows };
    },
    async exec(text: string) {
      await client.exec(text);
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Runs a unit of work with app.tenant_id set, which is what the RLS policies
 * read. Always use this for tenant-scoped reads and writes.
 *
 * Superusers bypass RLS even with FORCE ROW LEVEL SECURITY. That covers the
 * embedded PGlite instance and the local socket server, so when the connection
 * is a superuser and the least-privilege role exists, we `SET LOCAL ROLE` to
 * make local isolation real instead of silently ignored. On Neon the app
 * connects as the (non-superuser) table owner, where FORCE RLS already applies.
 */
export async function runAsTenant<T>(
  handle: DatabaseHandle,
  tenantId: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const restricted = await shouldSwitchRole(handle);
  return handle.db.transaction(async (tx) => {
    if (restricted) {
      await tx.execute(sql`set local role ledgerpilot_app`);
    }
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Database);
  });
}

const roleSwitchCache = new WeakMap<DatabaseHandle, boolean>();

async function shouldSwitchRole(handle: DatabaseHandle): Promise<boolean> {
  const cached = roleSwitchCache.get(handle);
  if (cached !== undefined) return cached;

  const result = await handle.query<{ is_superuser: boolean; app_role: boolean }>(
    `select current_setting('is_superuser') = 'on' as is_superuser,
            exists (select 1 from pg_roles where rolname = 'ledgerpilot_app') as app_role`,
  );
  const enabled = result.rows[0]?.is_superuser === true && result.rows[0]?.app_role === true;
  roleSwitchCache.set(handle, enabled);
  return enabled;
}

export async function currentTenantId(handle: DatabaseHandle): Promise<string | null> {
  const result = await handle.query<{ tenant_id: string | null }>(
    "select nullif(current_setting('app.tenant_id', true), '') as tenant_id",
  );
  return result.rows[0]?.tenant_id ?? null;
}
