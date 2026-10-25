import {
  probeOllama,
  readAiConfig,
  resolveCapabilities,
  type CapabilityReport,
} from "@ledgerpilot/agent";

/**
 * Capability report for tool responses. Cached briefly so a chatty client does
 * not probe Ollama on every call, while still picking up a started/stopped
 * local runtime within half a minute.
 */

let cache: { report: CapabilityReport; at: number } | null = null;
const TTL_MS = 30_000;

export async function currentCapabilities(force = false): Promise<CapabilityReport> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.report;

  const config = readAiConfig();
  const probe = await probeOllama(config.localBaseUrl, 700);
  const report = resolveCapabilities(config, { localAvailable: probe.available });
  cache = { report, at: Date.now() };
  return report;
}

export function summarizeCapabilities(report: CapabilityReport) {
  return {
    resolvedMode: report.resolvedMode,
    cloudKeysPresent: [...report.cloudKeysPresent],
    localAvailable: report.localAvailable,
    capabilities: report.capabilities.map((item) => ({
      capability: item.capability,
      mode: item.mode,
      provider: item.provider,
      model: item.model,
      reasonCode: item.reasonCode,
    })),
    warningCodes: [...report.warningCodes],
  };
}
