# LedgerPilot AI

**Accounts payable, under control.** An AI-optional financial back-office agent:
a deterministic core does the arithmetic and the approvals, models are an
additive layer, and the agent can propose money movement but never execute it.

[Español](README.es.md) · [Architecture](docs/ARCHITECTURE.md) · [Evaluation report](docs/eval-report.md) · [Task board](docs/TASKS.md)

---

## Run it in one minute, with no keys and no Docker

```bash
pnpm install
pnpm dev
```

- Web app → <http://localhost:3000>
- MCP server → <http://localhost:3100/mcp> (`/health` for a plain JSON check)
- Health → <http://localhost:3000/api/health>

There is nothing to sign up for. With an empty `.env` the app starts an embedded
PostgreSQL (PGlite) on `127.0.0.1:5433`, migrates it, seeds three demo
workspaces and runs every feature in **heuristic mode**. No API key, no cloud
account, no container runtime.

From a fresh clone, `pnpm setup` does the same preparation explicitly
(env file, install, migrate, seed, capability report) and is safe to re-run.

> Demo data is synthetic and the reporting date is frozen at **2026-06-15** so
> aging and overdue figures are reproducible. The date is labelled in the UI.

## Why this is not another "AI invoicing" demo

Three claims, each with code and a test behind it:

| Claim | What that means here |
| --- | --- |
| **AI is optional per capability** | `vision.extract`, `text.reason`, `text.generate`, `embed` and `rerank` each resolve independently to `cloud` → `local` (Ollama) → `heuristic`. A missing key degrades one capability, never the product. The UI says which mode is live. |
| **Money never becomes a float** | Amounts are integer minor units plus a currency. FX uses exact rational rates. Allocation and rounding are tested with property-style cases. |
| **The agent proposes; a human pays** | The only write tool creates a proposal with a payload hash and a nonce. Execution requires a separate approval, a matching hash, an unused nonce and an unexpired proposal. Agent-initiated proposals always require a human. |

The interesting part of an agent in finance is not the prompt. It is what
happens when the model is wrong, unavailable, or being manipulated by the
document it is reading.

## What the demo shows

Three tenants, fully isolated by PostgreSQL Row Level Security:

| Workspace | Vendors (sample) | Story |
| --- | --- | --- |
| Northwind Trading Co. | Apex Industrial Supply | A clean mid-size AP ledger in USD |
| Café Americana | Panama Coffee Roasters | The same system, Spanish UI, Latin American vendors |
| Pacific Logistics S.A. | Balboa Freight | Freight-heavy payables and FX exposure |

Switch workspace from the sidebar; the rows change because the database is
queried as a different tenant, not because the UI filters an array.

Worth clicking:

- **Overview** — open payables, overdue, aging per currency, open exceptions,
  and the audit-ledger head with its verification result.
- **Invoices** — search across invoice number, vendor and document text; open
  an invoice to see line items, payments applied and the source document.
- **Exceptions** — duplicates, amount mismatches, missing references and
  unapplied payments, each with the evidence that produced it.
- **Proposals** — the agent's proposed allocations, visibly *not executed*,
  with payload hash, nonce and the roles required to approve.
- **Assistant** — answers computed from SQL over the current workspace, with
  citations. Ask "Which invoices are overdue?" in either language.
- **Language toggle** — EN/ES, cookie-based, server-rendered. No client store.

## Evidence, not adjectives

`pnpm eval` runs offline and writes [`docs/eval-report.md`](docs/eval-report.md):

| Metric | Result | Gate |
| --- | --- | --- |
| Field-level extraction F1 (24 invoices × 8 fields, EN/ES, 4 currencies) | 100.0% | ≥ 90% |
| Line-item F1 | 100.0% | ≥ 90% |
| Degraded documents handled honestly (8 cases) | 8/8 | 100% |
| Security cases: injection, approval, execution (17) | 17/17 | 100% |

The supported corpus is synthetic and deliberately in-distribution: it is a
regression harness for the layouts the extractor claims to support, not a claim
about arbitrary scans. The degraded set measures the opposite contract — when a
document is unreadable or ambiguous, the system returns `null`, lowers
confidence and raises a warning instead of inventing a number. The report says
this plainly, including what it does **not** measure.

Test suite: **195 package tests** (money, FX, aging, reconciliation, approval
policy, ledger, RLS, migrations, MCP contract, extraction, evals) plus **7
Playwright tests** against the real stack.

## Architecture in one picture

```
┌────────────┐     ┌──────────────────────────┐     ┌────────────────────┐
│  Browser   │────▶│ apps/web (Next.js 16)    │────▶│ packages/core      │
│  EN / ES   │     │ RSC · cookie locale      │     │ money · FX · aging │
└────────────┘     │ cookie workspace         │     │ policy · ledger    │
                   └───────────┬──────────────┘     └────────────────────┘
                               │ Drizzle + RLS                 ▲
                   ┌───────────▼──────────────┐               │
                   │ packages/db              │     ┌─────────┴──────────┐
                   │ PGlite ── or ── Postgres │◀────│ packages/agent     │
                   │ 16 tables · migrations   │     │ capabilities       │
                   └───────────▲──────────────┘     │ extraction         │
                               │                    │ grounded responder │
                   ┌───────────┴──────────────┐     └────────────────────┘
                   │ apps/mcp (Hono :3100)    │
                   │ MCP 2026-07-28, stateless│
                   │ 4 read tools + 1 proposal│
                   └──────────────────────────┘
```

Key boundaries:

- **`core` never imports a model or a database.** It is pure functions over
  money and policy, and it is where all financial truth lives.
- **`db` owns the schema and the tenant boundary.** Every tenant-scoped query
  runs inside `runAsTenant`, which sets `app.tenant_id`; RLS policies are
  `FORCE ROW LEVEL SECURITY`, so even the table owner is filtered when the role
  is not a superuser.
- **`agent` cannot write.** It produces extractions, flags and grounded text.
- **`mcp` and `web` are adapters.** Neither contains business arithmetic.

More detail, including failure modes and the deployment topology:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## AI, when you have keys

Every AI variable is optional. Resolution is per capability and surfaced in
`/api/health`, `pnpm doctor` and the UI badge.

```dotenv
# None of these are required.
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
AI_LOCAL_BASE_URL=http://localhost:11434/v1   # Ollama, if it is running
AI_MODE=auto                               # auto | mock | local | cloud
```

With no key and no Ollama, `AI_MODE=auto` resolves to `heuristic`. The
assistant still answers: it maps the question to a SQL-backed intent and renders
a deterministic, cited answer. It abstains when the workspace has no evidence
for the question rather than guessing.

## The MCP server

`apps/mcp` speaks the **2026-07-28** stateless protocol over HTTP at `/mcp`.

| Tool | Kind | Guarantee |
| --- | --- | --- |
| `health_check` | read | driver, counts, ledger head, actual capability modes |
| `search_documents` | read | full-text search scoped to the resolved workspace |
| `get_invoice` | read | invoice, lines, payments and source document |
| `list_discrepancies` | read | open exceptions with evidence |
| `propose_action` | write | proposal + hash-chained audit entry only; never executes |

The tenant is **resolved by the server** from `MCP_TENANT`. No tool accepts a
tenant id, and no client can widen its own scope. `propose_action` always marks
the proposal `agent_initiated`, which forces human approval regardless of
amount, and a duplicate proposal for the same payload is refused.

```bash
curl -s http://127.0.0.1:3100/health | jq
```

Connect any MCP client to `http://127.0.0.1:3100/mcp`; `MCP_TENANT` accepts a
demo slug (`northwind`, `cafe-americana`, `pacific-logistics`). Unset, the
server serves the first seeded workspace.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | database + web + MCP, one process tree |
| `pnpm setup` | fresh-clone preparation, safe to re-run |
| `pnpm test` | package tests (Vitest) |
| `pnpm typecheck` | TypeScript across the monorepo |
| `pnpm eval` | offline evaluation; fails on a threshold miss |
| `pnpm build` | production build |
| `pnpm doctor` | capability report, EN/ES |
| `pnpm db:migrate` / `db:seed` / `db:reset` | database lifecycle |
| `pnpm db:verify` | deployment check: migrations, seed, RLS isolation, ledger |
| `pnpm --filter @ledgerpilot/web e2e` | Playwright against the real stack |

## Repository layout

```
apps/
  web/            Next.js 16 app (RSC, Tailwind 4, cookie locale/tenant)
  mcp/            stateless MCP server (Hono)
packages/
  core/           money, FX, invoices, aging, reconciliation, policy, ledger
  db/             Drizzle schema, dual driver, migrations, seed, verify
  agent/          capability resolver, extraction, injection scan, responder
  evals/          synthetic bilingual corpus, F1 harness, security cases
docs/             architecture, ADRs, generated eval report, task board
scripts/          dev and setup orchestration
```

## Decisions

Architecture decision records live in [`docs/adr/`](docs/adr):

- [0001 — Money as integer minor units](docs/adr/0001-money-as-minor-units.md)
- [0002 — AI optional per capability](docs/adr/0002-ai-optional-by-capability.md)
- [0003 — PGlite locally, Postgres/Neon in production](docs/adr/0003-pglite-local-neon-production.md)
- [0004 — MCP 2026-07-28, stateless, tenant resolved server-side](docs/adr/0004-mcp-stateless-tenant.md)
- [0005 — Two-phase proposals and human approval](docs/adr/0005-two-phase-proposals.md)
- [0006 — Evals as a release gate](docs/adr/0006-evals-as-release-gate.md)
- [0007 — Durable execution on Vercel Workflows (proposed)](docs/adr/0007-vercel-workflows.md)

## Limitations, stated on purpose

- **No OCR in this build.** Documents without a text layer are rejected and
  routed to review; OCR is the next extraction step, not a hidden promise.
- **The cloud adapters are contract-tested, not key-tested.** No key was
  available while building this, so cloud mode is exercised through interfaces
  and mocks. The deterministic path is the one covered end to end.
- **Extraction is tuned to labelled, text-layer invoices** in English and
  Spanish. Arbitrary scanned invoices will need OCR and a larger corpus.
- **Auth is demo-grade.** Workspace selection is a cookie among three seeded
  tenants; Better Auth organizations and real sessions are the next milestone.
- **Execution is simulated.** Proposals are persisted and audited; no bank or
  ERP integration moves money. That is deliberate for a public demo.

## Related work

This project follows [`financial-automation`](https://github.com/jse-avl/financial-automation)
(reconciliation and reporting automation) and [`sap-po-automation`](https://github.com/jse-avl/sap-po-automation)
(document intake for procurement). LedgerPilot is the agentic layer those
systems were missing: same financial discipline, explicit model boundaries.

## License

MIT © 2026 jse-avl. See [LICENSE](LICENSE).
