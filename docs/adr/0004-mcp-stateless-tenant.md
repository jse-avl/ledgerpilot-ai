# 0004 — MCP 2026-07-28, stateless, tenant resolved server-side

- **Status:** Accepted
- **Date:** 2026-06
- **Applies to:** `apps/mcp`

*Resumen (ES):* el servidor MCP no guarda sesiones y nunca acepta un inquilino del
cliente: lo resuelve desde `MCP_TENANT`. La única escritura crea una propuesta y
una entrada de auditoría; jamás ejecuta.

## Context

MCP servers are usually demoed as a local process with a session map and a tool
that takes whatever id the client sends. That is a poor fit for a multi-tenant
financial system:

- a session map is state to lose, expire and secure;
- a client-supplied tenant id is an authorization decision made by the caller;
- a "pay invoice" tool is a money-moving endpoint reachable by a model.

The protocol revision in this repository is **2026-07-28**, which is stateless
and answers `server/discover` directly.

## Decision

1. **Stateless transport.** Every request carries everything needed to answer it.
   No session id, no in-memory map, no cross-request cache of tenant data.
2. **One tenant per server instance, resolved by the server** from `MCP_TENANT`
   (slug or UUID). No tool schema contains a tenant field, so a client cannot
   widen its scope even if it tries.
3. **Read tools are safe in a loop:** `health_check`, `search_documents`,
   `get_invoice`, `list_discrepancies`.
4. **The only write tool proposes.** `propose_action` writes a proposal plus a
   hash-chained ledger entry in one transaction, refuses a duplicate payload, and
   marks it `agent_initiated`, which forces human approval at any amount.
5. **Errors are protocol errors, not prose.** Invalid input fails schema
   validation; a duplicate proposal returns a structured refusal.
6. **Contract tests use the real SDK client** over `InMemoryTransport`, so the
   tested surface is what an MCP client actually sees.

## Consequences

- Horizontal scaling is trivial: instances share a database, not a session.
- A compromised or confused client cannot select another tenant.
- The model's blast radius is a `pending_approval` row.
- A server instance serves one tenant. Multi-tenant routing belongs at the edge
  (one instance per workspace, or an authenticated resolver), not in tool
  arguments.
- OAuth 2.1 with `mcp:read`, `mcp:write`, `mcp:approve` is still pending; today,
  network locality and the server-side tenant are the boundary. That is stated in
  the README.
