import { canonicalJson, sha256Hex } from "./hashing";

export const GENESIS_HASH = "0".repeat(64);

export interface LedgerPayload {
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface LedgerEntry extends LedgerPayload {
  readonly seq: number;
  readonly prevHash: string;
  readonly entryHash: string;
}

export type LedgerVerification =
  | { readonly valid: true; readonly length: number; readonly head: string }
  | { readonly valid: false; readonly brokenAt: number; readonly reason: string };

/**
 * Ledger timestamps are normalized before hashing so that a round-trip through
 * Postgres (`timestamptz` renders as "2026-06-15 09:00:00+00") still verifies.
 */
export function normalizeTimestamp(value: string): string {
  const parsed = parseTimestamp(value);
  return new Date(parsed).toISOString();
}

/**
 * Accepts both ISO-8601 and Postgres' `timestamptz` text form
 * ("2026-06-15 09:00:00+00") so a ledger hash survives a database round-trip.
 */
function parseTimestamp(value: string): number {
  const withT = value.includes("T") ? value : value.replace(" ", "T");
  const withSecondsOffset = /[+-]\d{2}$/.test(withT) ? `${withT}:00` : withT;
  const parsed = Date.parse(withSecondsOffset);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ledger timestamp: "${value}"`);
  }
  return parsed;
}

function hashOf(entry: LedgerPayload & { seq: number; prevHash: string }): string {
  return sha256Hex(
    canonicalJson({
      seq: entry.seq,
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      action: entry.action,
      payload: entry.payload,
      createdAt: normalizeTimestamp(entry.createdAt),
      prevHash: entry.prevHash,
    }),
  );
}

/**
 * Append-only, hash-chained audit ledger. `prevHash` links each entry to the
 * previous one, so deleting or editing history breaks verification.
 */
export function appendLedgerEntry(
  chain: readonly LedgerEntry[],
  payload: LedgerPayload,
): LedgerEntry {
  const previous = chain.at(-1);
  const seq = previous ? previous.seq + 1 : 1;
  const prevHash = previous ? previous.entryHash : GENESIS_HASH;

  if (previous && previous.tenantId !== payload.tenantId) {
    throw new Error("A ledger chain cannot mix tenants");
  }

  const base = { ...payload, seq, prevHash, createdAt: normalizeTimestamp(payload.createdAt) };
  return Object.freeze({ ...base, entryHash: hashOf(base) });
}

export function verifyLedger(entries: readonly LedgerEntry[]): LedgerVerification {
  let previousHash = GENESIS_HASH;
  let expectedSeq = 1;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      return { valid: false, brokenAt: index, reason: "Missing entry" };
    }
    if (entry.seq !== expectedSeq) {
      return {
        valid: false,
        brokenAt: index,
        reason: `Expected seq ${expectedSeq}, found ${entry.seq}`,
      };
    }
    if (entry.prevHash !== previousHash) {
      return {
        valid: false,
        brokenAt: index,
        reason: `prevHash mismatch at seq ${entry.seq}`,
      };
    }
    const recomputed = hashOf(entry);
    if (recomputed !== entry.entryHash) {
      return {
        valid: false,
        brokenAt: index,
        reason: `entryHash mismatch at seq ${entry.seq} (tampered payload?)`,
      };
    }
    previousHash = entry.entryHash;
    expectedSeq += 1;
  }

  return { valid: true, length: entries.length, head: previousHash };
}

export function buildLedger(payloads: readonly LedgerPayload[]): LedgerEntry[] {
  const chain: LedgerEntry[] = [];
  for (const payload of payloads) {
    chain.push(appendLedgerEntry(chain, payload));
  }
  return chain;
}
