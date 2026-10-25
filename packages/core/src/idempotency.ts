import { canonicalJson, newNonce, sha256Hex } from "./hashing";

export type ProposalStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "executed";

export interface Proposal<T = unknown> {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly payload: T;
  readonly payloadHash: string;
  readonly nonce: string;
  readonly status: ProposalStatus;
  readonly proposedBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly summary: string;
}

export interface CreateProposalInput<T> {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly payload: T;
  readonly proposedBy: string;
  readonly createdAt: string;
  /** Time-to-live in seconds. Defaults to 24 hours. */
  readonly ttlSeconds?: number;
  readonly summary?: string;
}

export type IdempotencyErrorCode =
  | "NOT_APPROVED"
  | "PAYLOAD_CHANGED"
  | "NONCE_MISMATCH"
  | "NONCE_ALREADY_USED"
  | "PROPOSAL_EXPIRED"
  | "PROPOSAL_MISMATCH";

export class IdempotencyError extends Error {
  readonly code: IdempotencyErrorCode;

  constructor(code: IdempotencyErrorCode, message: string) {
    super(message);
    this.name = "IdempotencyError";
    this.code = code;
  }
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

export function createProposal<T>(input: CreateProposalInput<T>): Proposal<T> {
  const ttl = input.ttlSeconds ?? 86_400;
  const createdAt = new Date(input.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(`Invalid createdAt: ${input.createdAt}`);
  }
  return Object.freeze({
    id: input.id,
    tenantId: input.tenantId,
    kind: input.kind,
    payload: input.payload,
    payloadHash: hashPayload(input.payload),
    nonce: newNonce(),
    status: "pending_approval",
    proposedBy: input.proposedBy,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ttl * 1000).toISOString(),
    summary: input.summary ?? input.kind,
  });
}

export interface ApprovalRecord {
  readonly proposalId: string;
  readonly decision: "approved" | "rejected";
  readonly approverId: string;
  readonly payloadHash: string;
  readonly nonce: string;
  readonly decidedAt: string;
  readonly comment?: string;
}

export interface DecideInput {
  readonly proposal: Proposal;
  readonly approverId: string;
  readonly decision: "approved" | "rejected";
  readonly decidedAt: string;
  readonly comment?: string;
  /** Reject self-approval. Defaults to true. */
  readonly separationOfDuties?: boolean;
}

export function decideProposal(input: DecideInput): {
  proposal: Proposal;
  approval: ApprovalRecord;
} {
  const { proposal, approverId, decidedAt } = input;
  if ((input.separationOfDuties ?? true) && approverId === proposal.proposedBy) {
    throw new IdempotencyError(
      "NOT_APPROVED",
      "The proposer cannot approve their own proposal",
    );
  }
  if (proposal.status !== "pending_approval") {
    throw new IdempotencyError(
      "NOT_APPROVED",
      `Proposal ${proposal.id} is ${proposal.status}, expected pending_approval`,
    );
  }

  return {
    proposal: Object.freeze({
      ...proposal,
      status: input.decision === "approved" ? "approved" : "rejected",
    }),
    approval: Object.freeze({
      proposalId: proposal.id,
      decision: input.decision,
      approverId,
      payloadHash: proposal.payloadHash,
      nonce: proposal.nonce,
      decidedAt,
      ...(input.comment === undefined ? {} : { comment: input.comment }),
    }),
  };
}

export interface ExecutionGuardOptions {
  readonly now: string;
  /** Nonces already consumed by executed actions. */
  readonly usedNonces: ReadonlySet<string>;
}

/**
 * The execution gate. It re-verifies that the approved payload is byte-for-byte
 * the payload being executed, that the nonce is the approved one, that the
 * proposal has not expired, and that the nonce has never been used before.
 *
 * This closes the time-of-check/time-of-use gap: an agent can propose, a human
 * can approve, and the agent still cannot swap the amount afterwards.
 */
export function assertExecutable(
  proposal: Proposal,
  approval: ApprovalRecord,
  options: ExecutionGuardOptions,
): void {
  if (proposal.status !== "approved") {
    throw new IdempotencyError("NOT_APPROVED", `Proposal is ${proposal.status}, not approved`);
  }
  if (approval.decision !== "approved") {
    throw new IdempotencyError("NOT_APPROVED", "Approval record is a rejection");
  }
  if (approval.proposalId !== proposal.id) {
    throw new IdempotencyError("PROPOSAL_MISMATCH", "Approval belongs to another proposal");
  }

  const actualHash = hashPayload(proposal.payload);
  if (actualHash !== proposal.payloadHash) {
    throw new IdempotencyError("PAYLOAD_CHANGED", "Proposal payload was modified after approval");
  }
  if (approval.payloadHash !== actualHash) {
    throw new IdempotencyError("PAYLOAD_CHANGED", "Approval was granted for a different payload");
  }
  if (approval.nonce !== proposal.nonce) {
    throw new IdempotencyError("NONCE_MISMATCH", "Approval nonce does not match the proposal");
  }

  const now = Date.parse(options.now);
  if (Number.isNaN(now)) {
    throw new Error(`Invalid clock value: ${options.now}`);
  }
  if (now > Date.parse(proposal.expiresAt)) {
    throw new IdempotencyError(
      "PROPOSAL_EXPIRED",
      `Proposal expired at ${proposal.expiresAt}`,
    );
  }
  if (options.usedNonces.has(proposal.nonce)) {
    throw new IdempotencyError("NONCE_ALREADY_USED", "This proposal was already executed");
  }
}

export function executionKey(proposal: Proposal): string {
  return `${proposal.tenantId}:${proposal.id}:${proposal.nonce}`;
}
