# LedgerPilot AI — Task board

Living checklist. Updated as work lands.
Legend: `[x]` done · `[~]` in progress · `[ ]` pending

---

## Phase 0 — Foundation (current)

### Monorepo
- [x] pnpm workspaces + Turborepo + base tsconfig
- [x] `.env.example` with every variable optional
- [x] Root scripts (`dev`, `test`, `typecheck`, `doctor`, `eval`, `db:*`)
- [x] `pnpm dev` starts the shared local database, web and MCP together
- [x] `pnpm setup` from a fresh clone: env, install, migrate, seed, doctor
- [x] Bilingual README (EN/ES), MIT license, architecture doc and ADRs
- [x] Public repo `jse-avl/ledgerpilot-ai` + first push

### `packages/core` — deterministic financial core
- [x] Money as integer minor units + currency (never floats)
- [x] Banker's rounding, exact allocation, amount parsing/formatting
- [x] FX with exact rational rates, as-of lookup, zero-decimal currencies
- [x] Invoice lines, tax, totals and validation
- [x] Aging buckets (current / 1-30 / 31-60 / 61-90 / 90+)
- [x] Reconciliation: reference/amount/vendor/date scoring + duplicates
- [x] Approval policy engine with separation of duties and hard limits
- [x] Append-only hash-chained audit ledger
- [x] Two-phase proposals (`payload_hash` + `nonce`) and execution guard
- [x] 103 unit + property tests passing

### `packages/db`
- [x] Drizzle schema (tenants, documents, extractions, invoices, payments, ledger…)
- [x] Dual driver: PGlite embedded by default, Postgres via `DATABASE_URL`
- [x] SQL migrations + RLS policies per tenant (`0000` schema, `0001` RLS)
- [x] RLS isolation test (two tenants cannot see each other, real non-superuser role)
- [x] Deterministic demo seed (3 tenants, 39 invoices, 18 payments, 18 discrepancies)
- [x] Hash-chained audit entries seeded and verified
- [x] Local socket server (`pnpm db:serve`) so web + MCP share one PGlite without Docker
- [x] Wire-protocol test: reads over `pg`, tenant isolation holds through `SET LOCAL ROLE`
- [x] 13 tests passing (migrations, RLS, seed idempotency, socket)

### `packages/agent`
- [x] Capability resolver (`cloud` / `local` / `heuristic` per capability)
- [x] `AI_MODE=auto|mock|local|cloud` with honest, machine-readable reasons
- [x] `pnpm doctor` capability report, English and Spanish
- [x] Heuristic invoice extractor (text → fields + per-field confidence)
- [x] Spanish/English date, currency and amount parsing
- [x] Prompt-injection scan that forces human review
- [x] Template responder that cites real rows and abstains otherwise
- [x] Bilingual user-facing strings (`en` / `es`)
- [x] 52 tests passing

### `apps/mcp`
- [x] MCP server, spec 2026-07-28 (stateless, `server/discover`, no session map)
- [x] Read tools: `search_documents`, `get_invoice`, `list_discrepancies`, `health_check`
- [x] Write tool: `propose_action` (proposal + audit entry only, never executes)
- [x] Server-resolved workspace (`MCP_TENANT`); no tool accepts a tenant id
- [x] RLS-enforced reads through `runAsTenant`
- [x] 15 contract tests over the real SDK client (`InMemoryTransport`)
- [x] Hono `/mcp` + `/health` on port 3100
- [ ] OAuth metadata stub (Better Auth plugin wires in week 1)

### `apps/web`
- [x] Next.js 16 app shell + Tailwind 4
- [x] Bilingual UI (EN/ES) with a cookie-based toggle, no client state
- [x] Workspace switcher that demonstrates RLS with the three demo tenants
- [x] Capability badge that states the real mode (cloud / local / heuristic)
- [x] Overview: open payables, overdue, aging per currency, exceptions, ledger
- [x] Invoices list with search + open filter, and invoice detail with lines and payments
- [x] Exception inbox
- [x] Proposal inbox (read-only, with hash, nonce and required roles)
- [x] Deterministic assistant grounded in SQL, with citations and abstention
- [x] `/api/health` with driver, counts, ledger verification and capabilities
- [x] Playwright smoke suite (7 tests) against the real stack: bilingual toggle,
      workspace switch, invoice detail, assistant, proposals, health
- [ ] Extraction review UI with page evidence (week 2)
- [ ] Approve / reject actions wired to the workflow (week 5)

### `packages/evals`
- [x] Deterministic synthetic invoice generator (24 cases, EN/ES, 2 layouts, 4 currencies)
- [x] Offline extraction suite with field-level precision/recall/F1
- [x] Degraded-document suite: null instead of invented, with warnings
- [x] Security cases: prompt injection, approval policy, execution guard (17)
- [x] `docs/eval-report.md` generated artifact, thresholds enforced by Vitest
- [x] `pnpm eval` exits non-zero when a threshold is missed

### Quality & delivery
- [x] GitHub Actions CI: typecheck, tests, evals (artifact) and build
- [x] Postgres 18 service in CI for migrations, RLS parity and ledger verification
- [x] `pnpm db:verify` deployment check (idempotent migrations, isolation, ledger)
- [x] ADRs: money, AI-optional, PGlite/Neon, MCP 2026, two-phase proposals,
      evals-first, Vercel Workflows (proposed)
- [x] Public repo `jse-avl/ledgerpilot-ai` + first push

---

## Week 1 — Auth & tenancy
- [ ] Better Auth (organizations, invitations, MFA)
- [ ] Session → tenant membership resolution
- [ ] Signed uploads + storage driver (local / R2)
- [ ] Tenant switcher and audit of membership changes

## Week 2 — Extraction
- [ ] PDF text extraction (`pdfjs-dist`) + OCR fallback (`tesseract.js`)
- [ ] JSON-schema extraction contract + per-field confidence
- [ ] Review UI with evidence (page, bbox, snippet)
- [ ] Gemini adapter behind the capability interface (only if key present)
- [ ] 20 extraction eval cases

## Week 3 — Retrieval
- [ ] Postgres full-text + trigram search over document text
- [ ] Page-level citations and abstention when evidence is missing
- [ ] Optional embeddings (Gemini / Ollama) as an additive layer

## Week 4 — Reconciliation
- [ ] Payment → invoice allocation UI
- [ ] Duplicate detection and discrepancy inbox
- [ ] FX-aware reporting with historical rates
- [ ] MCP read tools backed by the real database

## Week 5 — Actions
- [ ] Two-phase write tools + approval inbox
- [ ] Durable workflows on Vercel Workflows
- [ ] Audit ledger persistence + verification command
- [ ] Idempotent execution tests

## Week 6 — MCP advanced
- [ ] Tasks extension for long reconciliations
- [ ] MCP Apps (`ui://`) invoice review surface
- [ ] OAuth 2.1 with scopes `mcp:read`, `mcp:write`, `mcp:approve`
- [ ] Trace & cost dashboard

## Week 7 — Quality
- [ ] 100 eval cases + adversarial set
- [ ] CI quality gates
- [ ] Cost/latency optimization pass
- [ ] Public eval report page

## Week 8 — Portfolio
- [ ] Vercel deploy + Neon + R2 + demo seed
- [ ] 3-minute demo video
- [ ] Case study + cross-links with `financial-automation` and `sap-po-automation`
- [ ] Release `v1.0.0`
