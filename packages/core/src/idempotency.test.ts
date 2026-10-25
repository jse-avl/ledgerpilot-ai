import { describe, expect, it } from "vitest";
import {
  IdempotencyError,
  assertExecutable,
  createProposal,
  decideProposal,
  executionKey,
  hashPayload,
} from "../src/idempotency";

const createdAt = "2026-03-01T10:00:00.000Z";

function build() {
  const proposal = createProposal({
    id: "prop-1",
    tenantId: "tenant-1",
    kind: "apply_payment",
    payload: { invoiceId: "inv-1", amountMinor: 50_000, currency: "USD" },
    proposedBy: "user-1",
    createdAt,
  });
  const decided = decideProposal({
    proposal,
    approverId: "user-2",
    decision: "approved",
    decidedAt: "2026-03-01T11:00:00.000Z",
  });
  return decided;
}

describe("two-phase proposals", () => {
  it("hashes the payload deterministically", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it("binds the approval to the payload hash and nonce", () => {
    const { proposal, approval } = build();
    expect(approval.payloadHash).toBe(proposal.payloadHash);
    expect(approval.nonce).toBe(proposal.nonce);
  });

  it("allows execution of an approved, unexpired, unused proposal", () => {
    const { proposal, approval } = build();
    expect(() =>
      assertExecutable(proposal, approval, {
        now: "2026-03-01T12:00:00.000Z",
        usedNonces: new Set(),
      }),
    ).not.toThrow();
  });

  it("blocks a payload swapped after approval", () => {
    const { proposal, approval } = build();
    const tampered = {
      ...proposal,
      payload: { invoiceId: "inv-1", amountMinor: 9_000_000, currency: "USD" },
    };
    expect(() =>
      assertExecutable(tampered, approval, {
        now: "2026-03-01T12:00:00.000Z",
        usedNonces: new Set(),
      }),
    ).toThrowError(expect.objectContaining({ code: "PAYLOAD_CHANGED" }));
  });

  it("blocks self-approval", () => {
    const proposal = createProposal({
      id: "prop-2",
      tenantId: "tenant-1",
      kind: "apply_payment",
      payload: {},
      proposedBy: "user-1",
      createdAt,
    });
    expect(() =>
      decideProposal({
        proposal,
        approverId: "user-1",
        decision: "approved",
        decidedAt: "2026-03-01T11:00:00.000Z",
      }),
    ).toThrow(IdempotencyError);
  });

  it("blocks replaying a consumed nonce", () => {
    const { proposal, approval } = build();
    expect(() =>
      assertExecutable(proposal, approval, {
        now: "2026-03-01T12:00:00.000Z",
        usedNonces: new Set([proposal.nonce]),
      }),
    ).toThrowError(expect.objectContaining({ code: "NONCE_ALREADY_USED" }));
  });

  it("blocks expired proposals", () => {
    const { proposal, approval } = build();
    expect(() =>
      assertExecutable(proposal, approval, {
        now: "2026-03-05T00:00:00.000Z",
        usedNonces: new Set(),
      }),
    ).toThrowError(expect.objectContaining({ code: "PROPOSAL_EXPIRED" }));
  });

  it("blocks rejected proposals", () => {
    const proposal = createProposal({
      id: "prop-3",
      tenantId: "tenant-1",
      kind: "apply_payment",
      payload: {},
      proposedBy: "user-1",
      createdAt,
    });
    const rejected = decideProposal({
      proposal,
      approverId: "user-2",
      decision: "rejected",
      decidedAt: "2026-03-01T11:00:00.000Z",
    });
    expect(() =>
      assertExecutable(rejected.proposal, rejected.approval, {
        now: "2026-03-01T12:00:00.000Z",
        usedNonces: new Set(),
      }),
    ).toThrowError(expect.objectContaining({ code: "NOT_APPROVED" }));
  });

  it("derives a tenant-scoped execution key", () => {
    const { proposal } = build();
    expect(executionKey(proposal)).toBe(`tenant-1:prop-1:${proposal.nonce}`);
  });
});
