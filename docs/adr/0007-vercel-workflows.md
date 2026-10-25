# 0007 — Durable execution on Vercel Workflows

- **Status:** **Proposed — not implemented**
- **Date:** 2026-06
- **Applies to:** future `apps/web` approval flow; no current code

*Resumen (ES):* propuesta, no hecho. Las aprobaciones de varios pasos, los
reintentos de conciliación y la expiración de propuestas encajan en un flujo
durable. Hoy el sistema funciona sin él; el guardia de ejecución ya separa
"propuesta" de "ejecutado", que es la propiedad que un workflow preservaría.

## Context

The two-phase proposal model already separates decision from execution. What it
does not do, in this build, is survive a process restart *between* those phases
with an automatic timer, a retry policy or a multi-step approval sequence.

Concrete cases that need durable orchestration:

- a proposal expires after 24 h and must transition to `expired` even if nobody
  opens the app;
- a high-value proposal needs two approvals, days apart, with reminders;
- a reconciliation that touches hundreds of invoices should retry a transient
  database error without duplicating an allocation;
- an action that calls an external ERP must be idempotent across retries.

A cron job plus ad-hoc retries can be made to work. It is code that looks simple
and fails in exactly the situations that matter.

## Decision (proposed)

Adopt **Vercel Workflows** for the approval and execution stages when the hosted
demo is built:

- one workflow per proposal, keyed by proposal id, so a retry cannot create a
  second execution;
- `sleepUntil(expiresAt)` for expiry instead of a polling job;
- approval steps that wait for a human event, with the same separation-of-duties
  checks already enforced in `core`;
- execution as a single step that calls `assertExecutable` and the (future) ERP
  adapter, with the nonce as the idempotency key;
- the hash-chained ledger written inside the step, so a retry either completes
  the entry or leaves no trace.

This ADR is **not** a description of current behaviour. No `workflow` dependency
is installed and no durable runner exists in this repository. The synchronous
API path, the proposal store, the approval policy and the execution guard are
implemented and tested.

## Consequences of adopting it

- Expiry and retries stop depending on a user visiting the app.
- The proposal id becomes a natural workflow id; the nonce remains the execution
  idempotency key, so the safety model does not change.
- A hosted vendor becomes part of the critical path for approvals. The
  deterministic guard stays in `core` so a future move to another runner does not
  require rewriting the financial rules.
- Local development needs a way to run the workflow runtime (or a documented
  substitute); this must be solved before the feature is claimed as done.

## Why it is an ADR and not code

Writing a durable workflow before real approval volume exists would encode
guesses about reminders, escalations and ERP adapters. The current build states
the boundary explicitly and leaves the orchestration for the milestone that has
the requirements. See [TASKS.md](../TASKS.md), week 5.
