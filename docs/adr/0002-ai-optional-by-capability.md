# 0002 — AI is optional per capability, not per product

- **Status:** Accepted
- **Date:** 2026-06
- **Applies to:** `packages/agent`, `apps/web`, `apps/mcp`

*Resumen (ES):* la IA se resuelve por capacidad (`cloud` → `local` → `heuristic`).
Si falta una clave se degrada una función y la interfaz lo dice; la aplicación
nunca deja de funcionar por configuración ausente.

## Context

The project had no API keys and could not assume a reviewer would have any. Two
bad options were available:

1. **Require a key**, making the repository unrunnable and every claim untested.
2. **Simulate AI**, shipping a fake "agent" whose quality nobody can inspect.

There is a third: implement every capability deterministically first, then treat
a model as an accelerator with the same interface.

## Decision

Five capabilities are declared independently:

| Capability | Heuristic implementation | Model, when present |
| --- | --- | --- |
| `vision.extract` | labelled-text parser with confidence and snippets | multimodal extraction |
| `text.reason` | intent classification over SQL-backed questions | planning / tool choice |
| `text.generate` | bilingual templates with citations | prose |
| `embed` | none; retrieval falls back to Postgres FTS | vector search |
| `rerank` | deterministic ordering | cross-encoder |

Each resolves on its own:

```
cloud (key + AI_MODE allows)  →  local (Ollama probe)  →  heuristic
```

`AI_MODE=auto|mock|local|cloud` sets a ceiling. The result is a
`CapabilityReport` — requested mode, resolved mode, provider/model per
capability, warning codes — rendered in the UI badge, `/api/health` and
`pnpm doctor` (EN/ES).

Two rules keep this honest:

- **No silent fallback.** The resolved mode is visible; the badge never claims a
  model is working when it is not.
- **No fake capability.** If a heuristic cannot answer, it abstains. The
  responder returns `grounded: false` rather than inventing a figure.

## Consequences

- A fresh clone is a complete product, not a broken configuration.
- Evals run offline and deterministically, which is what makes them a release
  gate (see ADR 0006).
- The cloud adapters could only be contract-tested, not key-tested. That
  limitation is stated in the README and the eval report instead of being hidden.
- Adding a provider means implementing an interface, not touching business logic.
- Heuristic extraction is layout-sensitive; the corpus defines the supported
  shapes and the degraded suite measures the fallback.
