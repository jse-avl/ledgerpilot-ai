# 0005 — Two-phase proposals and human approval

- **Status:** Accepted
- **Date:** 2026-06
- **Applies to:** `packages/core/src/idempotency.ts`, `approvals.ts`, `ledger.ts`, `apps/mcp`

*Resumen (ES):* una propuesta no es una ejecución. Se guarda con hash del payload
y un nonce; ejecutar exige aprobación humana separada, hash intacto, nonce sin
usar y propuesta vigente. Todo cambio se agrega a un libro encadenado por hash.

## Context

The dangerous moment in an AP agent is not reading an invoice. It is the
transition from "the model suggested something" to "money moved". Three things
must be true at once:

- a human decided, and the decision is attributable;
- what the human approved is exactly what executes;
- the same approval cannot be replayed.

A single `POST /pay` call with an agent-authored body satisfies none of them.

## Decision

The action pipeline has two phases with a durable gap between them.

**Phase 1 — propose**

`createProposal` canonicalises the payload (sorted keys, stable encoding),
computes `payload_hash = sha256(canonical JSON)`, generates a random `nonce` and
stores a `pending_approval` row with an expiry (24 h by default).

The approval policy (`evaluateApproval`) runs before a proposal is actionable:

- hard limit above `5,000,000` minor units → **denied**, not escalated;
- blocked risk flags (`untrusted_instruction`, `prompt_injection_suspected`) →
  **denied**, whatever the amount;
- below `50,000` minor units and no flags → auto-approved, which still does not
  mean executed;
- `50,000`–`1,000,000` → `finance_manager`;
- above `1,000,000` → `finance_manager` + `controller`, two distinct approvers;
- the proposer is always excluded from approving their own proposal;
- agent-initiated proposals always require a human.

**Phase 2 — execute**

`assertExecutable(proposal, approval, { now, usedNonces })` refuses unless:

| Check | Error |
| --- | --- |
| status is `approved` | `NOT_APPROVED` |
| approval points at this proposal | `PROPOSAL_MISMATCH` |
| approval hash equals the current payload hash | `PAYLOAD_CHANGED` |
| nonce matches and has not been used | `NONCE_MISMATCH` / `NONCE_ALREADY_USED` |
| `now` is before the expiry | `PROPOSAL_EXPIRED` |

Every accepted transition appends to `action_ledger`, where each entry contains
the previous entry's hash. `verifyLedger` recomputes the chain, so editing or
deleting history is detectable.

## Consequences

- A model error or injection can at worst create a visible, expiring proposal.
- "Approved" and "executed" are separate facts, which makes the UI honest and
  the audit trail meaningful.
- Execution is idempotent by construction: a retry with a used nonce fails loudly
  instead of paying twice.
- More moving parts than a single endpoint — deliberately, because the gap is the
  safety property.
- In this repository execution itself is simulated; the guard, the ledger and the
  tests are real, and the bank/ERP integration is out of scope (see README).
