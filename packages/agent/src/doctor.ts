import {
  probeOllama,
  readAiConfig,
  resolveCapabilities,
  type AiConfig,
  type CapabilityReport,
  type CapabilityStatus,
  type OllamaProbe,
} from "./capabilities";
import { normalizeLocale, strings, type Locale } from "./i18n";

/**
 * `pnpm doctor` — answers the only question that matters before a demo:
 * "what is actually going to run, and why?"
 *
 * The table uses plain ASCII separators so column alignment is stable across
 * terminals. Absence of AI is reported as a supported state, never as an
 * error, and the exit code stays 0.
 */

export interface DoctorReport {
  readonly config: AiConfig;
  readonly probe: OllamaProbe;
  readonly report: CapabilityReport;
}

export interface DoctorOptions {
  readonly env?: Record<string, string | undefined>;
  /** Skip the network probe (tests, CI). */
  readonly probeLocal?: boolean;
}

export async function collectDoctorReport(options: DoctorOptions = {}): Promise<DoctorReport> {
  const config = readAiConfig(options.env ?? process.env);
  const probe =
    options.probeLocal === false
      ? { available: false, baseUrl: config.localBaseUrl, models: [] }
      : await probeOllama(config.localBaseUrl);
  const report = resolveCapabilities(config, { localAvailable: probe.available });
  return { config, probe, report };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 3))}...`;
}

/** Translates a resolver decision instead of printing its English reason. */
function localizedReason(item: CapabilityStatus, doctor: DoctorReport, locale: Locale): string {
  const t = strings(locale).doctor;
  switch (item.reasonCode) {
    case "cloud_key_present":
      return t.rationale.cloud(item.provider, item.model ?? "-");
    case "local_runtime_detected":
      return t.rationale.local(item.model ?? "-", doctor.probe.baseUrl);
    case "mock_mode_forced":
      return t.rationale.mock;
    case "capability_not_available_locally":
      return t.rationale.notAvailableLocally;
    default:
      return t.rationale.heuristic[item.capability];
  }
}

export function renderDoctorReport(doctor: DoctorReport, locale: Locale = "en"): string {
  const t = strings(locale).doctor;
  const { config, probe, report } = doctor;
  const lines: string[] = [];

  lines.push(t.title);
  lines.push("=".repeat(t.title.length));
  lines.push(`${t.requestedMode}: ${report.requestedMode}`);
  lines.push(`${t.resolvedMode}: ${t.modes[report.resolvedMode]}`);
  lines.push(
    `${t.cloudKeys}: ${report.cloudKeysPresent.length === 0 ? t.none : report.cloudKeysPresent.join(", ")}`,
  );
  lines.push(
    `${t.localRuntime}: ${probe.available ? `${t.available} (${probe.baseUrl})` : `${t.unavailable} (${probe.baseUrl})`}`,
  );
  if (probe.available && probe.models.length > 0) {
    lines.push(`  models: ${probe.models.join(", ")}`);
  }
  lines.push("");

  const rows = report.capabilities.map((item) => ({
    capability: t.capabilities[item.capability],
    mode: t.modes[item.mode],
    provider: item.provider,
    model: item.model ?? "-",
    reason: localizedReason(item, doctor, locale),
  }));

  const headers = t.columns;
  const widths = {
    capability: Math.max(headers.capability.length, ...rows.map((row) => row.capability.length)),
    mode: Math.max(headers.mode.length, ...rows.map((row) => row.mode.length)),
    provider: Math.max(headers.provider.length, ...rows.map((row) => row.provider.length)),
    model: Math.max(headers.model.length, ...rows.map((row) => row.model.length)),
  };
  const reasonWidth = 60;

  lines.push(
    [
      pad(headers.capability, widths.capability),
      pad(headers.mode, widths.mode),
      pad(headers.provider, widths.provider),
      pad(headers.model, widths.model),
      headers.reason,
    ].join("  "),
  );
  lines.push(
    [
      "-".repeat(widths.capability),
      "-".repeat(widths.mode),
      "-".repeat(widths.provider),
      "-".repeat(widths.model),
      "-".repeat(reasonWidth),
    ].join("  "),
  );
  for (const row of rows) {
    lines.push(
      [
        pad(row.capability, widths.capability),
        pad(row.mode, widths.mode),
        pad(row.provider, widths.provider),
        pad(row.model, widths.model),
        truncate(row.reason, reasonWidth),
      ].join("  "),
    );
  }

  lines.push("");
  lines.push(`${t.warnings}:`);
  const warningLines =
    report.warningCodes.length > 0
      ? report.warningCodes.map((code) => t.warningText[code])
      : [...report.warnings];
  for (const warning of warningLines) lines.push(`  - ${warning}`);

  lines.push("");
  lines.push(`${t.nextSteps}:`);
  lines.push(`  - ${t.hints.heuristic}`);
  if (!report.localAvailable) lines.push(`  - ${t.hints.ollama}`);
  if (!config.geminiKey) lines.push(`  - ${t.hints.gemini}`);
  if (!config.openaiKey) lines.push(`  - ${t.hints.openai}`);
  if (report.resolvedMode !== "heuristic") {
    lines.push(`  - ${t.hints.active}`);
  }

  return lines.join("\n");
}

function parseArgs(argv: readonly string[]): { locale: Locale; json: boolean; noProbe: boolean } {
  let locale: Locale = normalizeLocale(process.env.LEDGERPILOT_LOCALE);
  let json = false;
  let noProbe = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json") json = true;
    else if (arg === "--no-probe") noProbe = true;
    else if (arg.startsWith("--lang=")) locale = normalizeLocale(arg.slice("--lang=".length));
    else if (arg === "--lang" || arg === "-l") {
      locale = normalizeLocale(argv[index + 1]);
      index += 1;
    }
  }

  return { locale, json, noProbe };
}

const isMain =
  process.argv[1] !== undefined && process.argv[1].replaceAll("\\", "/").endsWith("doctor.ts");

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const doctor = await collectDoctorReport({ probeLocal: !args.noProbe });
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          requestedMode: doctor.report.requestedMode,
          resolvedMode: doctor.report.resolvedMode,
          cloudKeysPresent: doctor.report.cloudKeysPresent,
          localAvailable: doctor.report.localAvailable,
          capabilities: doctor.report.capabilities,
          warnings: doctor.report.warnings,
          warningCodes: doctor.report.warningCodes,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(renderDoctorReport(doctor, args.locale));
  }
}
