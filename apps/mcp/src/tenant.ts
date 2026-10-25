import { generateDemoData } from "@ledgerpilot/db/demo-data";

/**
 * Workspace resolution.
 *
 * Phase 0 runs in demo mode: the workspace is chosen by the server (env var or
 * first seeded workspace), never by the caller. When OAuth lands, the verified
 * token maps to a membership and this module is the only place that changes.
 * No tool accepts a tenant id, so a model cannot hop workspaces.
 */

export interface Workspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly currency: string;
}

export function listWorkspaces(): Workspace[] {
  return generateDemoData().map((tenant) => ({
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    currency: tenant.currency,
  }));
}

export function resolveWorkspace(slug?: string): Workspace {
  const workspaces = listWorkspaces();
  const wanted = slug?.trim().toLowerCase() ?? "";
  if (wanted === "") {
    const first = workspaces[0];
    if (!first) throw new Error("No workspaces are available. Run `pnpm db:seed` first.");
    return first;
  }
  const found = workspaces.find((workspace) => workspace.slug === wanted);
  if (!found) {
    throw new Error(
      `Unknown workspace "${slug}". Available: ${workspaces.map((workspace) => workspace.slug).join(", ")}`,
    );
  }
  return found;
}
