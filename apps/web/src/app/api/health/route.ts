import { NextResponse } from "next/server";
import { capabilityReport } from "@/lib/capabilities";
import { getDatabase } from "@/lib/db";
import { loadOverview } from "@/lib/queries";
import { currentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Machine-readable health: driver, workspace, row counts, audit-ledger status
 * and the real capability decision. Safe to expose: no secrets, no row data.
 */
export async function GET() {
  const [handle, workspace, report] = await Promise.all([
    getDatabase(),
    currentWorkspace(),
    capabilityReport(),
  ]);
  const overview = await loadOverview(workspace);

  return NextResponse.json(
    {
      status: "ok",
      driver: handle.driver,
      workspace: {
        slug: workspace.slug,
        name: workspace.name,
        currency: workspace.currency,
      },
      asOf: overview.asOf,
      counts: overview.counts,
      ledger: overview.ledger,
      capabilities: {
        resolvedMode: report.resolvedMode,
        requestedMode: report.requestedMode,
        cloudKeysPresent: report.cloudKeysPresent,
        localAvailable: report.localAvailable,
        warningCodes: report.warningCodes,
        capabilities: report.capabilities.map((item) => ({
          capability: item.capability,
          mode: item.mode,
          provider: item.provider,
          model: item.model,
        })),
      },
      checkedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
