import {
  probeOllama,
  readAiConfig,
  resolveCapabilities,
  type CapabilityReport,
} from "@ledgerpilot/agent";

/**
 * Capability report for the header badge. Cached for half a minute so a page
 * view does not probe a local runtime, but starting Ollama still shows up
 * quickly without restarting the app.
 */

const globalForCapabilities = globalThis as unknown as {
  __ledgerpilotCapabilities?: { report: CapabilityReport; at: number };
};

const TTL_MS = 30_000;

export async function capabilityReport(): Promise<CapabilityReport> {
  const cached = globalForCapabilities.__ledgerpilotCapabilities;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.report;

  const config = readAiConfig();
  const probe = await probeOllama(config.localBaseUrl, 600);
  const report = resolveCapabilities(config, { localAvailable: probe.available });
  globalForCapabilities.__ledgerpilotCapabilities = { report, at: Date.now() };
  return report;
}
