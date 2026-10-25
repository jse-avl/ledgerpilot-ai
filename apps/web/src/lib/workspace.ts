import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { generateDemoData } from "@ledgerpilot/db/demo-data";
import { runAsTenant, schema } from "@ledgerpilot/db";
import { getDatabase } from "./db";

/**
 * Workspace resolution.
 *
 * The demo has three seeded workspaces. The choice travels in a cookie so a
 * visitor can switch and watch RLS change what is visible; the server still
 * validates the slug and never trusts it as a tenant id.
 */

export const WORKSPACE_COOKIE = "lp_workspace";
export const DEFAULT_WORKSPACE = process.env.DEMO_TENANT ?? "northwind";

export interface Workspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly currency: string;
}

export function workspaceOptions(): { slug: string; name: string }[] {
  return generateDemoData().map((tenant) => ({ slug: tenant.slug, name: tenant.name }));
}

export function workspaceSlugs(): string[] {
  return generateDemoData().map((tenant) => tenant.slug);
}

export async function currentWorkspace(): Promise<Workspace> {
  const store = await cookies();
  const wanted = store.get(WORKSPACE_COOKIE)?.value ?? DEFAULT_WORKSPACE;
  const demo = generateDemoData();
  const fallback = demo[0];
  if (!fallback) throw new Error("No demo workspaces are defined.");

  const chosen = demo.find((tenant) => tenant.slug === wanted) ?? fallback;
  const handle = await getDatabase();

  const [tenant] = await runAsTenant(handle, chosen.id, async (db) =>
    db.select().from(schema.tenants).where(eq(schema.tenants.id, chosen.id)).limit(1),
  );

  return {
    id: chosen.id,
    slug: tenant?.slug ?? chosen.slug,
    name: tenant?.name ?? chosen.name,
    currency: chosen.currency,
  };
}

/**
 * The demo dataset is dated; "today" would make every invoice 90+ days old and
 * hide the aging buckets. Freeze the reporting date unless DEMO_AS_OF says
 * otherwise, and label it in the UI.
 */
export function demoAsOf(): string {
  const configured = process.env.DEMO_AS_OF?.trim();
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured;
  return "2026-06-15";
}
