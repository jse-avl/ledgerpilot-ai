# 0006 — Evaluations are a release gate, not a dashboard

- **Status:** Accepted
- **Date:** 2026-06
- **Applies to:** `packages/evals`, `.github/workflows/ci.yml`

*Resumen (ES):* las evaluaciones corren offline, son deterministas y sus umbrales
viven en el código. Si la extracción o la seguridad regresan, CI falla aunque
nadie regenere el informe. El informe declara lo que no mide.

## Context

"Agent quality" is usually reported as a number in a slide, produced once, on a
dataset nobody can run. That number is unfalsifiable and rots immediately. For a
financial product, the questions that matter are narrower and testable:

1. Does extraction return the right field on documents we claim to support?
2. When a document is incomplete or ambiguous, does it fail honestly?
3. Do the approval and execution boundaries hold under adversarial input?

## Decision

Three suites, one command, hard thresholds:

| Suite | Size | Measure | Gate |
| --- | --- | --- | --- |
| Supported extraction | 24 invoices × 8 fields | micro F1, line-item F1 | ≥ 90% |
| Degraded documents | 8 cases | honest behaviour (null + warning) | 100% |
| Security | 17 cases | injection, approval, execution | 100% |

Implementation choices:

- **Synthetic and deterministic.** A seeded PRNG generates the corpus; the same
  input produces the same output on every machine. No customer data, no network.
- **Exact match only.** An invented value counts as both a false positive and a
  false negative, because attaching an invoice to the wrong record is worse than
  leaving it for a human.
- **Thresholds in code.** `THRESHOLDS` lives in `packages/evals/src/report.ts` and
  is asserted by `evals.test.ts`. `pnpm eval` writes `docs/eval-report.md` and
  exits non-zero on a miss; CI uploads the report as an artifact.
- **The corpus excludes ambiguous dates from the "correct" score.** `03/04/2026`
  has no knowable answer; asking the extractor to guess would rig the benchmark.
  Ambiguity is measured in the degraded suite, where the expectation is a
  confidence drop and a warning.
- **The report states its limits.** In-distribution corpus, no OCR, unit-level
  security cases. A 100% F1 is presented as a regression harness result, not as a
  claim about arbitrary scans.

## Consequences

- A regression stops the build before a human reads a document.
- The numbers are reproducible by anyone with the repository, which is the only
  reason to trust them.
- The supported score is intentionally high; its value is as a tripwire. The
  degraded and security suites are where the product's behaviour is actually
  specified.
- Adding a provider or a layout requires extending the corpus, not editing a
  slide.
- End-to-end claims are covered separately by the Playwright suite against the
  running stack, because unit-level security checks do not prove the server wires
  them correctly.
