# 0003 — PGlite locally, Postgres/Neon in production

- **Status:** Accepted
- **Date:** 2026-06
- **Applies to:** `packages/db`, `scripts/dev.mjs`

*Resumen (ES):* sin `DATABASE_URL` la aplicación levanta PGlite y lo expone por
socket TCP para que web y MCP compartan una sola base, sin Docker. Con
`DATABASE_URL` usa Postgres real (Neon en producción) con el mismo esquema, las
mismas consultas y las mismas políticas RLS.

## Context

A demo that requires Docker or a cloud database is a demo most reviewers will not
run. But an in-memory database that only one process can open cannot demonstrate
multi-tenant isolation between two services, and a fake database cannot prove
that RLS works.

## Decision

One schema, two drivers, chosen by environment:

- `DATABASE_URL` empty → **PGlite 0.5** embedded in `.data/pglite`.
- `DATABASE_URL` set → **node-postgres** against any Postgres 13+ (Neon,
  local, CI).

For local development, `packages/db/src/serve.ts` starts PGlite and exposes it on
`127.0.0.1:5433` speaking the Postgres wire protocol, capped at 10 connections.
`scripts/dev.mjs` waits for the port, then starts the web app and the MCP server,
both pointing at that socket. Web and MCP therefore read *the same rows*, and RLS
is exercised for real rather than mocked.

`serve.ts` refuses to start if `DATABASE_URL` is set: one authoritative database
per run, no ambiguity about which data a page shows.

## Consequences

- **Zero setup:** no container runtime, no account, one command.
- **Parity where it matters:** the same Drizzle schema, SQL migrations, policies
  and queries run locally and in production. CI's Postgres 18 job proves it by
  running migrations, seed, `db:verify` and the socket test against a real server.
- **Limits:** PGlite allows 10 connections and is not a production database. The
  pool is small by design; this is a single-developer environment.
- **Seeding differs:** the MCP server migrates and seeds automatically only for
  PGlite. With an external database, migrations and seed are an explicit step so
  a service start can never mutate shared data by surprise.
- **Verification is explicit:** `pnpm db:verify` exists because "it worked
  locally" is not evidence about RLS on Neon.
