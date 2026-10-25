import { describe, expect, it } from "vitest";
import { appendLedgerEntry, buildLedger, verifyLedger } from "../src/ledger";
import { canonicalJson, sha256Hex } from "../src/hashing";

const base = {
  tenantId: "tenant-1",
  actorId: "user-1",
  action: "payment.applied",
  createdAt: "2026-03-01T10:00:00.000Z",
};

describe("audit ledger", () => {
  it("builds a verifiable hash chain", () => {
    const chain = buildLedger([
      { ...base, payload: { invoiceId: "inv-1", amount: 1000 } },
      { ...base, payload: { invoiceId: "inv-2", amount: 2000 } },
      { ...base, actorId: "user-2", action: "proposal.approved", payload: { proposalId: "p-1" } },
    ]);

    const verification = verifyLedger(chain);
    expect(verification.valid).toBe(true);
    if (verification.valid) {
      expect(verification.length).toBe(3);
      expect(verification.head).toBe(chain[2]?.entryHash);
    }
    expect(chain[0]?.prevHash).toBe("0".repeat(64));
    expect(chain[1]?.prevHash).toBe(chain[0]?.entryHash);
  });

  it("detects a tampered payload", () => {
    const chain = buildLedger([
      { ...base, payload: { amount: 1000 } },
      { ...base, payload: { amount: 2000 } },
    ]);
    const tampered = [chain[0]!, { ...chain[1]!, payload: { amount: 9_000_000 } }];

    const verification = verifyLedger(tampered);
    expect(verification.valid).toBe(false);
    if (!verification.valid) {
      expect(verification.brokenAt).toBe(1);
      expect(verification.reason).toMatch(/entryHash mismatch/);
    }
  });

  it("detects a deleted entry", () => {
    const chain = buildLedger([
      { ...base, payload: { n: 1 } },
      { ...base, payload: { n: 2 } },
      { ...base, payload: { n: 3 } },
    ]);
    const verification = verifyLedger([chain[0]!, chain[2]!]);
    expect(verification.valid).toBe(false);
    if (!verification.valid) expect(verification.brokenAt).toBe(1);
  });

  it("refuses to mix tenants in one chain", () => {
    const chain = buildLedger([{ ...base, payload: {} }]);
    expect(() =>
      appendLedgerEntry(chain, { ...base, tenantId: "tenant-2", payload: {} }),
    ).toThrow(/mix tenants/);
  });

  it("produces a stable hash for key-order permutations", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(sha256Hex(canonicalJson({ a: 1, b: 2 }))).toHaveLength(64);
  });

  it("rejects values that cannot be canonicalized", () => {
    expect(() => canonicalJson({ a: undefined })).not.toThrow();
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/Non-finite/);
    expect(() => canonicalJson({ a: 1n })).toThrow(/bigint/);
  });
});
