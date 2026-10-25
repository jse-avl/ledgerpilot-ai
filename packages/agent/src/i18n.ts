import type { Capability, CapabilityMode, WarningCode } from "./capabilities";

/**
 * Bilingual strings for everything the agent surfaces to a human (CLI doctor,
 * MCP tool responses, chat answers). Code and comments stay in English; only
 * user-visible copy is translated.
 */

export type Locale = "en" | "es";

export const LOCALES: readonly Locale[] = ["en", "es"];

export function normalizeLocale(value: string | undefined): Locale {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "es" || normalized.startsWith("es-") ? "es" : "en";
}

export function intlLocale(locale: Locale): string {
  return locale === "es" ? "es-ES" : "en-US";
}

export interface DoctorStrings {
  readonly title: string;
  readonly requestedMode: string;
  readonly resolvedMode: string;
  readonly cloudKeys: string;
  readonly localRuntime: string;
  readonly none: string;
  readonly available: string;
  readonly unavailable: string;
  readonly warnings: string;
  readonly nextSteps: string;
  readonly columns: {
    readonly capability: string;
    readonly mode: string;
    readonly provider: string;
    readonly model: string;
    readonly reason: string;
  };
  readonly modes: Record<CapabilityMode, string>;
  readonly capabilities: Record<Capability, string>;
  readonly rationale: {
    readonly cloud: (provider: string, model: string) => string;
    readonly local: (model: string, baseUrl: string) => string;
    readonly mock: string;
    readonly notAvailableLocally: string;
    readonly heuristic: Record<Capability, string>;
  };
  readonly warningText: Record<WarningCode, string>;
  readonly hints: {
    readonly heuristic: string;
    readonly ollama: string;
    readonly gemini: string;
    readonly openai: string;
    readonly active: string;
  };
}

export interface AgentStrings {
  readonly doctor: DoctorStrings;
}

export const AGENT_STRINGS: Readonly<Record<Locale, AgentStrings>> = {
  en: {
    doctor: {
      title: "LedgerPilot capability report",
      requestedMode: "Requested mode",
      resolvedMode: "Resolved mode",
      cloudKeys: "Cloud keys",
      localRuntime: "Local runtime",
      none: "none",
      available: "available",
      unavailable: "not reachable",
      warnings: "Warnings",
      nextSteps: "Next steps",
      columns: {
        capability: "Capability",
        mode: "Mode",
        provider: "Provider",
        model: "Model",
        reason: "Reason",
      },
      modes: {
        cloud: "cloud",
        local: "local",
        heuristic: "heuristic",
      },
      capabilities: {
        "vision.extract": "Document extraction",
        "text.reason": "Reasoning",
        "text.generate": "Answer writing",
        embed: "Embeddings",
        rerank: "Re-ranking",
      },
      rationale: {
        cloud: (provider, model) => `Cloud model ${model} via ${provider}`,
        local: (model, baseUrl) => `Local model ${model} via Ollama at ${baseUrl}`,
        mock: "Forced by AI_MODE=mock",
        notAvailableLocally: "No local model is wired for this capability",
        heuristic: {
          "vision.extract": "PDF text layer plus OCR and layout rules",
          "text.reason": "Typed rules and scoring instead of model reasoning",
          "text.generate": "Data-backed response templates",
          embed: "Postgres full-text search with trigram fallback",
          rerank: "Lexical ranking over field position and match strength",
        },
      },
      warningText: {
        mock_mode_forced: "AI_MODE=mock: every capability falls back to deterministic components.",
        cloud_mode_without_key:
          "AI_MODE=cloud was requested but no cloud key is set; falling back to heuristic mode.",
        local_mode_unavailable:
          "AI_MODE=local was requested but Ollama did not respond; falling back to heuristic mode.",
        no_ai_provider_configured:
          "No AI provider configured. Everything still works: add GEMINI_API_KEY or run Ollama to enable model-backed extraction and chat.",
      },
      hints: {
        heuristic:
          "Nothing to install: the app already runs fully on deterministic components.",
        ollama:
          "Optional local models: install Ollama and run `ollama pull qwen3:4b` to move text work from heuristic to local.",
        gemini:
          "Optional cloud extraction: set GEMINI_API_KEY in .env to enable multimodal document extraction.",
        openai:
          "Optional cloud reasoning: set OPENAI_API_KEY in .env to enable model-written answers.",
        active: "Models are active: nothing else to do.",
      },
    },
  },
  es: {
    doctor: {
      title: "Informe de capacidades de LedgerPilot",
      requestedMode: "Modo solicitado",
      resolvedMode: "Modo resuelto",
      cloudKeys: "Claves en la nube",
      localRuntime: "Runtime local",
      none: "ninguna",
      available: "disponible",
      unavailable: "no disponible",
      warnings: "Avisos",
      nextSteps: "Siguientes pasos",
      columns: {
        capability: "Capacidad",
        mode: "Modo",
        provider: "Proveedor",
        model: "Modelo",
        reason: "Motivo",
      },
      modes: {
        cloud: "nube",
        local: "local",
        heuristic: "heurístico",
      },
      capabilities: {
        "vision.extract": "Extracción de documentos",
        "text.reason": "Razonamiento",
        "text.generate": "Redacción de respuestas",
        embed: "Embeddings",
        rerank: "Reordenamiento",
      },
      rationale: {
        cloud: (provider, model) => `Modelo en la nube ${model} vía ${provider}`,
        local: (model, baseUrl) => `Modelo local ${model} vía Ollama en ${baseUrl}`,
        mock: "Forzado por AI_MODE=mock",
        notAvailableLocally: "No hay modelo local conectado para esta capacidad",
        heuristic: {
          "vision.extract": "Capa de texto del PDF más OCR y reglas de maquetación",
          "text.reason": "Reglas tipadas y puntuación en lugar de razonamiento del modelo",
          "text.generate": "Plantillas de respuesta respaldadas por datos",
          embed: "Búsqueda de texto completo en Postgres con respaldo trigram",
          rerank: "Ordenamiento léxico por posición del campo y fuerza de coincidencia",
        },
      },
      warningText: {
        mock_mode_forced: "AI_MODE=mock: todas las capacidades usan componentes deterministas.",
        cloud_mode_without_key:
          "Se solicitó AI_MODE=cloud pero no hay ninguna clave en la nube; se usa el modo heurístico.",
        local_mode_unavailable:
          "Se solicitó AI_MODE=local pero Ollama no respondió; se usa el modo heurístico.",
        no_ai_provider_configured:
          "No hay proveedor de IA configurado. Todo sigue funcionando: añade GEMINI_API_KEY o ejecuta Ollama para habilitar extracción y chat con modelos.",
      },
      hints: {
        heuristic:
          "No hay nada que instalar: la aplicación ya funciona con componentes deterministas.",
        ollama:
          "Modelos locales opcionales: instala Ollama y ejecuta `ollama pull qwen3:4b` para pasar de heurístico a local.",
        gemini:
          "Extracción en la nube opcional: define GEMINI_API_KEY en .env para habilitar extracción multimodal.",
        openai:
          "Razonamiento en la nube opcional: define OPENAI_API_KEY en .env para habilitar respuestas escritas por modelo.",
        active: "Los modelos están activos: no hay nada más que hacer.",
      },
    },
  },
};

export function strings(locale: Locale): AgentStrings {
  return AGENT_STRINGS[locale];
}
