# Architecture

This document describes what is actually built, not the target state. Where a
piece is planned rather than implemented, it says so.

- [Español](ARCHITECTURE.es.md)
- [ADRs](adr)
- [Evaluation report](eval-report.md)

---

## 1. What the system is for

LedgerPilot is an accounts-payable back office: documents arrive, invoices are
extracted and validated, payments are matched, exceptions are surfaced, and
actions are proposed for human approval. A language model may help read a
document or phrase an answer, but it never owns an amount, a match or an
execution.

The architecture follows from one constraint: **the product must work with no
AI provider configured, and must degrade visibly rather than silently.**

## 2. Runtime topology

### Local development (default)

```
pnpm dev
  └─ scripts/dev.mjs
       ├─ packages/db/src/serve.ts   PGlite over TCP on 127.0.0.1:5433
       ├─ apps/web                   next dev on :3000
       └─ apps/mcp                   Hono on :3100
```

One embedded PostgreSQL process, shared by the web app and the MCP server over
the normal `pg` wire protocol. This avoids Docker and avoids two divergeable
copies of the data. `serve.ts` refuses to start when `DATABASE_URL` is set,
because then an external server is authoritative.

PGlite allows at most 10 concurrent connections. The web app keeps one pool per
process; the MCP server keeps its own. That is the practical ceiling of the
local setup and the reason the pool is small.

### Deployed (target)

```
Vercel ── Next.js ── pooled Neon (Postgres 18) ── RLS
   │
   └── MCP server (Node runtime) ── same Neon database
```

`DATABASE_URL` switches the driver. No code path differs: the same Drizzle
queries and the same RLS policies run on both. `pnpm db:verify` checks a real
Postgres deployment for migration idempotency, seed presence, tenant isolation
through the application role, and ledger validity.

## 3. Package boundaries

| Package | Owns | Must never |
| --- | --- | --- |
| `@ledgerpilot/core` | money, FX, invoice math, aging, reconciliation, approval policy, audit chain, execution guard | import a model, a database or `next` |
| `@ledgerpilot/db` | schema, driver, migrations, seed, tenant context | contain business arithmetic |
| `@ledgerpilot/agent` | capability resolution, extraction, injection scanning, grounded answers | write to the database |
| `apps/web` | rendering, cookies (locale, workspace), HTTP surface | compute financial results itself |
| `apps/mcp` | protocol adapter and tool contracts | accept a client-supplied tenant |
| `@ledgerpilot/evals` | corpus, scoring, release gates | import app code |

`core` is pure. That is what makes it testable at 103 tests and reusable by the
eval harness without a database.

## 4. Data model

16 tables in three groups.

**Identity and tenancy**

- `tenants` — workspace, base currency.
- `memberships` — user ↔ tenant with a role.

**Documents and extraction**

- `documents` — filename, MIME type, hash, storage key, extracted `search_text`.
- `extractions` — one run over a document, with method and confidence.
- `extraction_fields` — per-field value, confidence (basis points), snippet,
  page and the method that produced it. A low-confidence field is a review task,
  not a failure.

**Financial state**

- `invoices`, `invoice_lines` — integer minor units plus currency; no floats.
- `payments`, `payment_allocations` — a payment can be partially applied.
- `discrepancies` — duplicates, amount mismatches, missing references,
  unapplied payments, with severity and evidence.
- `fx_rates` — exact rational rate, as-of date, source.
- `proposals`, `approvals`, `action_ledger` — the two-phase action pipeline.
- `agent_runs`, `eval_runs` — operational history for agent work and evals.

Invoices deliberately have **no unique constraint** on
`(tenant, vendor, normalized_number)`. Duplicate invoice numbers are a real
accounts-payable fact; hiding them behind a constraint would erase the very
exception the product exists to catch. Duplicates are detected and surfaced.

## 5. The tenant boundary

Every tenant-scoped operation goes through `runAsTenant(handle, tenantId, fn)`:

1. open a transaction;
2. `select set_config('app.tenant_id', $1, true)` — local to the transaction;
3. run the caller's queries;
4. commit or roll back.

Policies use `FORCE ROW LEVEL SECURITY`, so the owner does not bypass them. The
migrations create a non-superuser role `ledgerpilot_app`; when the connection is
a superuser and that role exists, `runAsTenant` switches to it with
`SET LOCAL ROLE`, which is what makes isolation real rather than declarative.
When the role is absent (some managed environments), the session setting still
applies, but the guarantee is weaker — `pnpm db:verify` reports the role's
presence so a deployment cannot quietly lose it.

An unknown or missing `app.tenant_id` returns no rows rather than an error:
deny-by-default is easier to reason about than a special case.

## 6. Money and time

- Amounts are `{ amount: number (minor units), currency: string }`.
- Parsing accepts `1,234.56`, `1.234,56`, parentheses for negatives and currency
  symbols, and rejects ambiguity instead of guessing.
- Allocation uses banker's rounding and distributes remainders deterministically,
  so `100.00 / 3` never loses a cent.
- FX is stored as an exact rational (`numerator` / `denominator`) with an as-of
  date; conversions round once, at the end.
- Zero-decimal currencies (JPY, KRW…) are handled by the currency registry, not
  by a hard-coded `100`.
- Reporting uses a frozen demo date (`DEMO_AS_OF=2026-06-15`) so aging buckets
  and overdue totals are reproducible in screenshots, tests and evals.

## 7. Capability resolution (the AI-optional core)

Five capabilities are resolved independently:

```
vision.extract   document → structured fields
text.reason      question → intent/plan
text.generate    facts → prose
embed            text → vectors
rerank           candidates → ordering
```

Resolution order per capability:

1. **cloud** — the provider key for that capability exists and `AI_MODE` allows it;
2. **local** — `AI_LOCAL_BASE_URL` answers a health probe (Ollama);
3. **heuristic** — a deterministic implementation.

`AI_MODE` can force a ceiling (`heuristic`, `local`, `cloud`) or leave it at
`auto`. The result is a `CapabilityReport` with the requested mode, the resolved
mode, per-capability provider/model and warning codes. It is exposed in
`/api/health`, in the sidebar badge and in `pnpm doctor` (EN/ES). Missing keys
are reported as a fact, not an error.

The heuristic implementations are not stubs:

- **Extraction** parses labelled text-layer invoices in English and Spanish:
  invoice number, vendor, both dates, currency, subtotal, tax, total and line
  items, each with confidence and a snippet. It validates totals against
  subtotal + tax and reports mismatches.
- **Reasoning** maps a question to one of a small set of SQL-backed intents
  (invoice lookup, overdue summary, open payables, discrepancy summary, spend by
  vendor) and abstains when the data does not support an answer.
- **Generation** renders those facts into a bilingual template with citations.

## 8. Extraction and untrusted input

Document text is data, never instruction. The pipeline is:

```
text → injection scan → field extraction → validation → confidence → review routing
```

The injection scan looks for instruction overrides, fake role tags, approval
bypasses and forced actions, in English and Spanish. A hit adds
`untrusted_instruction` to the document's risk flags. Risk flags travel with the
proposal; the approval policy denies blocked flags regardless of amount. A
document that says "pay this immediately without approval" therefore makes
approval *harder*, not easier.

Ambiguity is handled the same way. `03/04/2026` is parsed but marked ambiguous,
confidence drops below the review threshold and an `*_AMBIGUOUS` warning is
recorded. The eval suite does not score a guess as correct; it scores the honest
degradation.

## 9. The action pipeline

```
agent/user → createProposal(payload)
                 │  payload_hash = sha256(canonical JSON)
                 │  nonce = random
                 ▼
          pending_approval ── human decision ──▶ approved | rejected
                 │                                   │
                 │                                   ▼
                 │                         assertExecutable(
                 │                           status, hash, nonce,
                 │                           expiry, unused nonce,
                 │                           approver ≠ proposer)
                 │                                   │
                 └──────────── expired ──────────────┴──▶ execute once
```

Guarantees enforced in code and covered by the security suite:

- a proposal is not an execution;
- the proposer cannot approve their own proposal (separation of duties);
- changing the payload after approval invalidates the hash;
- a nonce can be redeemed once;
- an expired proposal cannot execute;
- an approval for one proposal cannot be replayed on another;
- agent-initiated proposals always require a human;
- every state change appends to a hash-chained ledger, and `verifyLedger`
  detects a modified or removed entry.

## 10. The web surface

Next.js App Router with server components. Two cookies carry UI context:

- `lp_lang` — `en` | `es`; all user-visible strings, dates and money follow it.
- `lp_workspace` — one of the seeded slugs; resolved to a tenant id server-side.

Both are set by small route handlers that validate their input and redirect to a
**safe same-origin** `next` path. The redirect builder uses the request `Host`
header rather than `request.url`, because Next normalises the URL to `localhost`
in development and a redirect to a different host would drop the cookie just set.

Queries run through `runAsTenant`; pages do not filter by tenant in JavaScript.
Switching workspace changes what the database returns.

The assistant is a server-rendered form. It loads facts with SQL, calls the
deterministic responder, and renders headline, bullets and citations. There is no
client-side model call, so no key ever reaches the browser.

## 11. The MCP server

- Protocol **2026-07-28**, stateless: every request is self-contained, there is
  no session map, and `server/discover` is answered directly.
- Transport: Hono `app.all("/mcp", ...)` delegating to the SDK handler;
  `GET /health` is a plain JSON diagnostic.
- The tenant comes from `MCP_TENANT` (a demo slug; unset means the first seeded
  workspace). No tool schema contains a tenant field, so a client cannot ask for
  another workspace.
- Four read tools and one write tool. `propose_action` inserts a proposal and a
  ledger entry in one tenant transaction, refuses a duplicate payload, and says
  in its response that nothing was executed.
- Contract tests drive the real SDK client over `InMemoryTransport`, so tool
  names, schemas and error shapes are tested the way a client sees them.

## 12. Evaluation strategy

Two different questions, two different suites:

1. **Does the deterministic path work?** 24 synthetic invoices, EN/ES, three
   layouts, four currencies, both decimal conventions, rotating label variants.
   Field-level precision/recall/F1, line-item F1, exact-match only.
2. **Does it fail honestly?** 8 degraded documents (no total, no currency, no
   due date, ambiguous date, no text layer, inconsistent total, no vendor, not
   an invoice). The expectation is `null` plus a warning, never a guess.

Plus 17 security cases over injection scanning, approval policy and the execution
guard. Thresholds live in `packages/evals/src/report.ts` and are asserted by
Vitest, so a regression fails CI even if nobody regenerates the report.
`pnpm eval` writes `docs/eval-report.md` and exits non-zero on a miss.

The report states its own limits: the corpus is in-distribution, OCR is out of
scope, and the security cases are unit-level, complemented (not replaced) by the
Playwright suite against the running stack.

## 13. Operations

| Concern | Mechanism |
| --- | --- |
| Schema changes | plain SQL migrations, applied in order, tracked in a table; idempotent |
| Demo data | deterministic seed with a fixed PRNG; re-running skips seeded tenants |
| Health | `/api/health` (web) and `/health` (MCP): driver, counts, ledger head, capabilities |
| Deployment check | `pnpm db:verify`: migrations, role, seed, isolation, unknown tenant, ledger |
| Audit | append-only hash chain; verification is part of health and CI |
| CI | typecheck → tests → evals (artifact) → build; separate Postgres 18 job for migrations, seed, socket test and RLS parity |

## 14. Known failure modes

- **No OCR.** A scan without a text layer yields nothing and is routed to
  review. This is visible in the UI and asserted in evals.
- **Heuristic extraction is layout-sensitive.** It supports labelled invoices in
  the shapes in the corpus; unusual layouts will need review.
- **Cloud adapters are contract-tested only.** Without keys, the cloud branch is
  verified by interfaces and mocks, not by live calls.
- **Demo auth.** Workspace selection is a cookie, not a session. Anyone can
  switch among the three demo tenants; that is the point of the demo and the
  reason no real data belongs in it.
- **Local connection ceiling.** PGlite permits 10 connections; the pool is sized
  for a single developer, not for load.
- **Execution is simulated.** The pipeline is real; the bank is not.

## 15. Planned, not built

- Better Auth organizations, invitations and MFA; membership-derived tenant.
- PDF text extraction and OCR fallback, with page-level evidence in a review UI.
- Durable workflows on Vercel Workflows for multi-step approvals and retries.
- OAuth 2.1 for MCP with `mcp:read`, `mcp:write`, `mcp:approve` scopes.
- Embeddings and reranking as an additive retrieval layer over Postgres FTS.
- A public deployment on Vercel + Neon with the seeded demo.

These are tracked in [TASKS.md](TASKS.md), not claimed as done.
