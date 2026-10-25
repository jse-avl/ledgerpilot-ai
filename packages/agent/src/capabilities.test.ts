import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  capability,
  probeOllama,
  readAiConfig,
  resolveCapabilities,
} from "./capabilities";

const base = { AI_LOCAL_BASE_URL: "http://127.0.0.1:9" } as Record<string, string>;

describe("readAiConfig", () => {
  it("defaults to auto mode and empty keys", () => {
    const config = readAiConfig({});
    expect(config.mode).toBe("auto");
    expect(config.geminiKey).toBeNull();
    expect(config.openaiKey).toBeNull();
    expect(config.anthropicKey).toBeNull();
    expect(config.localBaseUrl).toBe("http://localhost:11434/v1");
  });

  it("treats blank keys as absent, not as empty strings", () => {
    const config = readAiConfig({ GEMINI_API_KEY: "   ", OPENAI_API_KEY: "" });
    expect(config.geminiKey).toBeNull();
    expect(config.openaiKey).toBeNull();
  });

  it("ignores unknown modes and falls back to auto", () => {
    expect(readAiConfig({ AI_MODE: "banana" }).mode).toBe("auto");
    expect(readAiConfig({ AI_MODE: "MOCK" }).mode).toBe("mock");
  });
});

describe("resolveCapabilities without any AI", () => {
  const report = resolveCapabilities(readAiConfig(base));

  it("resolves every capability to heuristic", () => {
    expect(report.resolvedMode).toBe("heuristic");
    expect(report.capabilities).toHaveLength(CAPABILITIES.length);
    for (const item of report.capabilities) {
      expect(item.mode).toBe("heuristic");
      expect(item.provider).toBe("heuristic");
      expect(item.model).toBeNull();
      expect(item.reasonCode).toBe("no_ai_configured");
    }
  });

  it("explains that this is a supported state", () => {
    expect(report.cloudKeysPresent).toEqual([]);
    expect(report.warnings.join(" ")).toContain("No AI provider configured");
    expect(report.warnings.join(" ")).toContain("still works");
    expect(report.warningCodes).toContain("no_ai_provider_configured");
  });
});

describe("resolveCapabilities with a Gemini key", () => {
  const report = resolveCapabilities(
    readAiConfig({ ...base, GEMINI_API_KEY: "test-gemini-key" }),
  );

  it("enables vision and embeddings", () => {
    expect(capability(report, "vision.extract").mode).toBe("cloud");
    expect(capability(report, "vision.extract").provider).toBe("gemini");
    expect(capability(report, "embed").mode).toBe("cloud");
  });

  it("reuses the Gemini key for reasoning as a documented fallback", () => {
    const reason = capability(report, "text.reason");
    expect(reason.mode).toBe("cloud");
    expect(reason.reason).toContain("Gemini");
  });

  it("keeps re-ranking heuristic because no cloud reranker is wired", () => {
    expect(capability(report, "rerank").mode).toBe("heuristic");
  });
});

describe("resolveCapabilities with an OpenAI key", () => {
  it("routes reasoning to OpenAI but leaves vision heuristic", () => {
    const report = resolveCapabilities(readAiConfig({ ...base, OPENAI_API_KEY: "test-openai" }));
    expect(capability(report, "text.reason").provider).toBe("openai");
    expect(capability(report, "text.generate").mode).toBe("cloud");
    expect(capability(report, "vision.extract").mode).toBe("heuristic");
  });
});

describe("resolveCapabilities with a local runtime", () => {
  it("uses Ollama for the capabilities it can serve", () => {
    const report = resolveCapabilities(readAiConfig(base), { localAvailable: true });
    expect(report.resolvedMode).toBe("local");
    expect(capability(report, "vision.extract").provider).toBe("ollama");
    expect(capability(report, "text.reason").model).toBe("qwen3:4b");
    expect(capability(report, "embed").mode).toBe("local");
    expect(capability(report, "rerank").mode).toBe("heuristic");
  });

  it("prefers cloud over local when both are available", () => {
    const report = resolveCapabilities(
      readAiConfig({ ...base, GEMINI_API_KEY: "test-gemini-key" }),
      { localAvailable: true },
    );
    expect(capability(report, "vision.extract").mode).toBe("cloud");
    expect(capability(report, "text.reason").mode).toBe("cloud");
  });
});

describe("AI_MODE overrides", () => {
  it("mock forces deterministic components even with keys present", () => {
    const report = resolveCapabilities(
      readAiConfig({ ...base, AI_MODE: "mock", GEMINI_API_KEY: "test-gemini-key" }),
    );
    expect(report.resolvedMode).toBe("heuristic");
    for (const item of report.capabilities) {
      expect(item.reasonCode).toBe("mock_mode_forced");
    }
  });

  it("cloud without keys degrades to heuristic and says why", () => {
    const report = resolveCapabilities(readAiConfig({ ...base, AI_MODE: "cloud" }));
    expect(report.resolvedMode).toBe("heuristic");
    expect(report.warnings.join(" ")).toContain("no cloud key");
  });

  it("local without a runtime degrades to heuristic and says why", () => {
    const report = resolveCapabilities(readAiConfig({ ...base, AI_MODE: "local" }), {
      localAvailable: false,
    });
    expect(report.resolvedMode).toBe("heuristic");
    expect(report.warnings.join(" ")).toContain("Ollama did not respond");
  });

  it("local with a runtime suppresses the cloud path", () => {
    const report = resolveCapabilities(
      readAiConfig({ ...base, AI_MODE: "local", GEMINI_API_KEY: "test-gemini-key" }),
      { localAvailable: true },
    );
    expect(capability(report, "vision.extract").mode).toBe("local");
  });
});

describe("probeOllama", () => {
  it("never throws when nothing is listening", async () => {
    const probe = await probeOllama("http://127.0.0.1:9", 400);
    expect(probe.available).toBe(false);
    expect(probe.models).toEqual([]);
    expect(probe.error).toBeTruthy();
  });
});
