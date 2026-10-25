/**
 * Capability resolution.
 *
 * The product promise is "AI-optional, not AI-dependent": every capability
 * resolves independently to cloud, local or a deterministic fallback. A single
 * global on/off switch would break as soon as one key exists and another does
 * not, so resolution happens per capability.
 */

export type AiMode = "auto" | "mock" | "local" | "cloud";

export type CapabilityMode = "cloud" | "local" | "heuristic";

export type Capability =
  | "vision.extract"
  | "text.reason"
  | "text.generate"
  | "embed"
  | "rerank";

export type ProviderId = "gemini" | "openai" | "anthropic" | "ollama" | "heuristic";

export type ReasonCode =
  | "cloud_key_present"
  | "local_runtime_detected"
  | "no_ai_configured"
  | "mock_mode_forced"
  | "cloud_mode_without_key"
  | "local_mode_unavailable"
  | "capability_not_available_locally";

/** Machine-readable reasons so the UI can translate them instead of parsing English. */
export type WarningCode =
  | "mock_mode_forced"
  | "cloud_mode_without_key"
  | "local_mode_unavailable"
  | "no_ai_provider_configured";

export interface AiConfig {
  readonly mode: AiMode;
  readonly geminiKey: string | null;
  readonly openaiKey: string | null;
  readonly anthropicKey: string | null;
  readonly localBaseUrl: string;
  readonly localVisionModel: string;
  readonly localTextModel: string;
  readonly localEmbeddingModel: string;
  readonly extractionModel: string;
  readonly reasoningModel: string;
  readonly embeddingModel: string;
}

export interface CapabilityStatus {
  readonly capability: Capability;
  readonly mode: CapabilityMode;
  readonly provider: ProviderId;
  readonly model: string | null;
  readonly reasonCode: ReasonCode;
  readonly reason: string;
}

export interface CapabilityReport {
  readonly requestedMode: AiMode;
  readonly resolvedMode: CapabilityMode;
  readonly capabilities: readonly CapabilityStatus[];
  readonly cloudKeysPresent: readonly string[];
  readonly localAvailable: boolean;
  readonly warnings: readonly string[];
  readonly warningCodes: readonly WarningCode[];
}

export const CAPABILITIES: readonly Capability[] = [
  "vision.extract",
  "text.reason",
  "text.generate",
  "embed",
  "rerank",
];

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function parseMode(value: string | undefined): AiMode {
  const normalized = (value ?? "auto").trim().toLowerCase();
  return normalized === "mock" || normalized === "local" || normalized === "cloud"
    ? normalized
    : "auto";
}

export function readAiConfig(
  env: Record<string, string | undefined> = process.env,
): AiConfig {
  return {
    mode: parseMode(env.AI_MODE),
    geminiKey: clean(env.GEMINI_API_KEY),
    openaiKey: clean(env.OPENAI_API_KEY),
    anthropicKey: clean(env.ANTHROPIC_API_KEY),
    localBaseUrl: clean(env.AI_LOCAL_BASE_URL) ?? "http://localhost:11434/v1",
    localVisionModel: clean(env.AI_LOCAL_VISION_MODEL) ?? "qwen3-vl:4b",
    localTextModel: clean(env.AI_LOCAL_TEXT_MODEL) ?? "qwen3:4b",
    localEmbeddingModel: clean(env.AI_LOCAL_EMBEDDING_MODEL) ?? "embeddinggemma-2:270m",
    extractionModel: clean(env.AI_EXTRACTION_MODEL) ?? "gemini-3.8-flash",
    reasoningModel: clean(env.AI_REASONING_MODEL) ?? "gpt-6.1-sol",
    embeddingModel: clean(env.AI_EMBEDDING_MODEL) ?? "gemini-embedding-2",
  };
}

export interface ResolveOptions {
  /** Result of probing Ollama. Defaults to false: never assume a model is there. */
  readonly localAvailable?: boolean;
}

interface Decision {
  readonly mode: CapabilityMode;
  readonly provider: ProviderId;
  readonly model: string | null;
  readonly reasonCode: ReasonCode;
  readonly reason: string;
}

const HEURISTIC: Record<Capability, Decision> = {
  "vision.extract": {
    mode: "heuristic",
    provider: "heuristic",
    model: null,
    reasonCode: "no_ai_configured",
    reason: "PDF text layer plus OCR and layout rules",
  },
  "text.reason": {
    mode: "heuristic",
    provider: "heuristic",
    model: null,
    reasonCode: "no_ai_configured",
    reason: "Typed rules and scoring instead of model reasoning",
  },
  "text.generate": {
    mode: "heuristic",
    provider: "heuristic",
    model: null,
    reasonCode: "no_ai_configured",
    reason: "Data-backed response templates",
  },
  embed: {
    mode: "heuristic",
    provider: "heuristic",
    model: null,
    reasonCode: "no_ai_configured",
    reason: "Postgres full-text search with trigram fallback",
  },
  rerank: {
    mode: "heuristic",
    provider: "heuristic",
    model: null,
    reasonCode: "no_ai_configured",
    reason: "Lexical and field-position ranking",
  },
};

function cloudVision(config: AiConfig): Decision | null {
  if (!config.geminiKey) return null;
  return {
    mode: "cloud",
    provider: "gemini",
    model: config.extractionModel,
    reasonCode: "cloud_key_present",
    reason: "GEMINI_API_KEY detected; multimodal extraction enabled",
  };
}

function cloudReasoning(config: AiConfig): Decision | null {
  if (config.openaiKey) {
    return {
      mode: "cloud",
      provider: "openai",
      model: config.reasoningModel,
      reasonCode: "cloud_key_present",
      reason: "OPENAI_API_KEY detected",
    };
  }
  if (config.anthropicKey) {
    return {
      mode: "cloud",
      provider: "anthropic",
      model: "claude-sonnet-5.5",
      reasonCode: "cloud_key_present",
      reason: "ANTHROPIC_API_KEY detected",
    };
  }
  if (config.geminiKey) {
    return {
      mode: "cloud",
      provider: "gemini",
      model: config.extractionModel,
      reasonCode: "cloud_key_present",
      reason: "Falling back to the Gemini key for reasoning",
    };
  }
  return null;
}

function localDecision(
  config: AiConfig,
  model: string,
  capability: Capability,
): Decision {
  return {
    mode: "local",
    provider: "ollama",
    model,
    reasonCode: "local_runtime_detected",
    reason: `Ollama reachable at ${config.localBaseUrl} (${capability})`,
  };
}

function decide(
  capability: Capability,
  config: AiConfig,
  localAvailable: boolean,
): Decision {
  switch (capability) {
    case "vision.extract": {
      const cloud = cloudVision(config);
      if (cloud) return cloud;
      if (localAvailable) return localDecision(config, config.localVisionModel, capability);
      return HEURISTIC[capability];
    }
    case "text.reason":
    case "text.generate": {
      const cloud = cloudReasoning(config);
      if (cloud) return cloud;
      if (localAvailable) return localDecision(config, config.localTextModel, capability);
      return HEURISTIC[capability];
    }
    case "embed": {
      if (config.geminiKey) {
        return {
          mode: "cloud",
          provider: "gemini",
          model: config.embeddingModel,
          reasonCode: "cloud_key_present",
          reason: "GEMINI_API_KEY detected; multimodal embeddings enabled",
        };
      }
      if (localAvailable) return localDecision(config, config.localEmbeddingModel, capability);
      return HEURISTIC[capability];
    }
    case "rerank": {
      // No cloud reranker is wired in Phase 0; lexical ranking is good enough
      // and keeps retrieval explainable.
      return {
        ...HEURISTIC[capability],
        reasonCode: localAvailable ? "capability_not_available_locally" : "no_ai_configured",
        reason: "Lexical ranking over field position and match strength",
      };
    }
    default: {
      const exhaustive: never = capability;
      throw new Error(`Unhandled capability: ${String(exhaustive)}`);
    }
  }
}

export function resolveCapabilities(
  config: AiConfig,
  options: ResolveOptions = {},
): CapabilityReport {
  const localAvailable = options.localAvailable ?? false;
  const warnings: string[] = [];
  const warningCodes: WarningCode[] = [];
  const cloudKeysPresent = [
    config.geminiKey ? "GEMINI_API_KEY" : null,
    config.openaiKey ? "OPENAI_API_KEY" : null,
    config.anthropicKey ? "ANTHROPIC_API_KEY" : null,
  ].filter((key): key is string => key !== null);

  let forced: "cloud" | "local" | null = null;

  if (config.mode === "mock") {
    forced = null;
    warnings.push("AI_MODE=mock: every capability falls back to deterministic components.");
    warningCodes.push("mock_mode_forced");
  } else if (config.mode === "cloud") {
    if (cloudKeysPresent.length === 0) {
      warnings.push(
        "AI_MODE=cloud was requested but no cloud key is set; falling back to heuristic mode.",
      );
      warningCodes.push("cloud_mode_without_key");
    } else {
      forced = "cloud";
    }
  } else if (config.mode === "local") {
    if (!localAvailable) {
      warnings.push(
        `AI_MODE=local was requested but Ollama did not respond at ${config.localBaseUrl}; falling back to heuristic mode.`,
      );
      warningCodes.push("local_mode_unavailable");
    } else {
      forced = "local";
    }
  }

  const capabilities = CAPABILITIES.map((capability) => {
    if (config.mode === "mock") {
      return {
        capability,
        ...HEURISTIC[capability],
        reasonCode: "mock_mode_forced" as const,
        reason: "Forced by AI_MODE=mock",
      };
    }

    const decision = decide(capability, config, localAvailable);
    if (forced === "local" && decision.mode === "cloud") {
      return {
        capability,
        ...(localAvailable
          ? localDecision(
              config,
              capability === "vision.extract"
                ? config.localVisionModel
                : capability === "embed"
                  ? config.localEmbeddingModel
                  : config.localTextModel,
              capability,
            )
          : HEURISTIC[capability]),
      };
    }
    return { capability, ...decision };
  });

  const anyCloud = capabilities.some((capability) => capability.mode === "cloud");
  const anyLocal = capabilities.some((capability) => capability.mode === "local");
  const resolvedMode: CapabilityMode = anyCloud ? "cloud" : anyLocal ? "local" : "heuristic";

  if (resolvedMode === "heuristic" && warnings.length === 0) {
    warnings.push(
      "No AI provider configured. Everything still works: add GEMINI_API_KEY or run Ollama to enable model-backed extraction and chat.",
    );
    warningCodes.push("no_ai_provider_configured");
  }

  return {
    requestedMode: config.mode,
    resolvedMode,
    capabilities,
    cloudKeysPresent,
    localAvailable,
    warnings,
    warningCodes,
  };
}

export function capability(
  report: CapabilityReport,
  name: Capability,
): CapabilityStatus {
  const found = report.capabilities.find((item) => item.capability === name);
  if (!found) throw new Error(`Unknown capability: ${name}`);
  return found;
}

export interface OllamaProbe {
  readonly available: boolean;
  readonly baseUrl: string;
  readonly models: readonly string[];
  readonly error?: string;
}

/** Short, non-fatal probe. Never throws: absence of Ollama is a supported state. */
export async function probeOllama(
  baseUrl: string,
  timeoutMs = 1_200,
): Promise<OllamaProbe> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { available: false, baseUrl, models: [], error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      data?: { id?: string }[];
      models?: { name?: string }[];
    };
    const models = [
      ...(payload.data ?? []).map((model) => model.id ?? ""),
      ...(payload.models ?? []).map((model) => model.name ?? ""),
    ].filter((id) => id !== "");
    return { available: true, baseUrl, models };
  } catch (error) {
    return {
      available: false,
      baseUrl,
      models: [],
      error: error instanceof Error ? error.message : "unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}
