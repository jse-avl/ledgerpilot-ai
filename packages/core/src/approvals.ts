import { type Money, compare, isNegative, money } from "./money";

export interface ApprovalTier {
  /** Applies when the amount is strictly greater than this value. */
  readonly above: Money;
  readonly roles: readonly string[];
  /** How many distinct approvers are required. Defaults to 1. */
  readonly minApprovals?: number;
}

export interface ApprovalPolicy {
  readonly currency: string;
  readonly autoApproveUpTo: Money;
  readonly hardLimit: Money;
  readonly tiers: readonly ApprovalTier[];
  readonly allowedRoles: readonly string[];
  /** Risk flags that force a denial regardless of amount. */
  readonly blockedRiskFlags: readonly string[];
  readonly separationOfDuties: boolean;
}

export interface Actor {
  readonly id: string;
  readonly roles: readonly string[];
}

export interface ActionProposal {
  readonly id: string;
  readonly kind: string;
  readonly amount: Money;
  readonly proposer: Actor;
  readonly riskFlags?: readonly string[];
}

export type ApprovalDecision = "auto_approved" | "requires_approval" | "denied";

export type ApprovalReasonCode =
  | "AUTO_APPROVED"
  | "TIER_REQUIRES_ROLES"
  | "ABOVE_HARD_LIMIT"
  | "CURRENCY_MISMATCH"
  | "NEGATIVE_AMOUNT"
  | "BLOCKED_RISK_FLAG"
  | "PROPOSER_NOT_ALLOWED"
  | "NO_APPROVER_AVAILABLE"
  | "SELF_APPROVAL_BLOCKED";

export interface ApprovalReason {
  readonly code: ApprovalReasonCode;
  readonly message: string;
}

export interface ApprovalEvaluation {
  readonly decision: ApprovalDecision;
  readonly requiredRoles: readonly string[];
  readonly minApprovals: number;
  readonly excludedApproverIds: readonly string[];
  readonly reasons: readonly ApprovalReason[];
}

const EMPTY: readonly string[] = [];

function deny(reason: ApprovalReason): ApprovalEvaluation {
  return {
    decision: "denied",
    requiredRoles: EMPTY,
    minApprovals: 0,
    excludedApproverIds: EMPTY,
    reasons: [reason],
  };
}

export function defaultPolicy(currency: string): ApprovalPolicy {
  return {
    currency,
    autoApproveUpTo: money(50_000, currency),
    hardLimit: money(5_000_000, currency),
    tiers: [
      { above: money(50_000, currency), roles: ["finance_manager"], minApprovals: 1 },
      { above: money(1_000_000, currency), roles: ["finance_manager", "controller"], minApprovals: 2 },
    ],
    allowedRoles: ["analyst", "finance_manager", "controller"],
    blockedRiskFlags: ["untrusted_instruction", "prompt_injection_suspected"],
    separationOfDuties: true,
  };
}

/**
 * Policy engine for the human-in-the-loop gate. It is pure and deterministic:
 * the same proposal and policy always produce the same decision, which is what
 * makes the approval box in the UI explainable.
 */
export function evaluateApproval(
  proposal: ActionProposal,
  policy: ApprovalPolicy,
): ApprovalEvaluation {
  if (proposal.amount.currency !== policy.currency) {
    return deny({
      code: "CURRENCY_MISMATCH",
      message: `Proposal is ${proposal.amount.currency} but policy is ${policy.currency}`,
    });
  }
  if (isNegative(proposal.amount)) {
    return deny({
      code: "NEGATIVE_AMOUNT",
      message: "Proposals cannot move a negative amount",
    });
  }
  if (compare(proposal.amount, policy.hardLimit) === 1) {
    return deny({
      code: "ABOVE_HARD_LIMIT",
      message: `Amount exceeds the hard limit of ${policy.hardLimit.amount} minor units`,
    });
  }

  const flags = proposal.riskFlags ?? [];
  const blocked = flags.filter((flag) => policy.blockedRiskFlags.includes(flag));
  if (blocked.length > 0) {
    return deny({
      code: "BLOCKED_RISK_FLAG",
      message: `Blocked risk flags present: ${blocked.join(", ")}`,
    });
  }

  const proposerRoles = proposal.proposer.roles.filter((role) =>
    policy.allowedRoles.includes(role),
  );
  if (proposerRoles.length === 0) {
    return deny({
      code: "PROPOSER_NOT_ALLOWED",
      message: "Proposer has no role allowed to create financial proposals",
    });
  }

  const autoApprove = compare(proposal.amount, policy.autoApproveUpTo) <= 0 && flags.length === 0;
  if (autoApprove) {
    return {
      decision: "auto_approved",
      requiredRoles: EMPTY,
      minApprovals: 0,
      excludedApproverIds: EMPTY,
      reasons: [
        {
          code: "AUTO_APPROVED",
          message: `Amount is at or below the auto-approval threshold of ${policy.autoApproveUpTo.amount} minor units`,
        },
      ],
    };
  }

  const tier = findTier(proposal.amount, policy.tiers);
  const requiredRoles = tier ? tier.roles : policy.allowedRoles;
  const minApprovals = tier?.minApprovals ?? 1;
  const excluded = policy.separationOfDuties ? [proposal.proposer.id] : [];

  if (requiredRoles.length === 0) {
    return deny({
      code: "NO_APPROVER_AVAILABLE",
      message: "No approval role is configured for this amount",
    });
  }

  return {
    decision: "requires_approval",
    requiredRoles,
    minApprovals,
    excludedApproverIds: excluded,
    reasons: [
      {
        code: "TIER_REQUIRES_ROLES",
        message: `Amount above ${policy.autoApproveUpTo.amount} minor units requires ${requiredRoles.join(", ")}`,
      },
      ...(policy.separationOfDuties
        ? [
            {
              code: "SELF_APPROVAL_BLOCKED" as const,
              message: "The proposer cannot approve their own proposal",
            },
          ]
        : []),
    ],
  };
}

function findTier(amount: Money, tiers: readonly ApprovalTier[]): ApprovalTier | undefined {
  const ordered = [...tiers].sort((a, b) => compare(a.above, b.above));
  let match: ApprovalTier | undefined;
  for (const tier of ordered) {
    if (compare(amount, tier.above) === 1) match = tier;
  }
  return match;
}

export interface ApproverCheck {
  readonly allowed: boolean;
  readonly reason?: string;
}

export function canApprove(
  evaluation: ApprovalEvaluation,
  approver: Actor,
): ApproverCheck {
  if (evaluation.decision !== "requires_approval") {
    return { allowed: false, reason: `Proposal is ${evaluation.decision}` };
  }
  if (evaluation.excludedApproverIds.includes(approver.id)) {
    return { allowed: false, reason: "Separation of duties: proposer cannot approve" };
  }
  const matches = approver.roles.filter((role) => evaluation.requiredRoles.includes(role));
  if (matches.length === 0) {
    return {
      allowed: false,
      reason: `Requires one of: ${evaluation.requiredRoles.join(", ")}`,
    };
  }
  return { allowed: true };
}

export function validatePolicy(policy: ApprovalPolicy): string[] {
  const problems: string[] = [];
  if (policy.autoApproveUpTo.currency !== policy.currency) {
    problems.push("autoApproveUpTo currency does not match policy currency");
  }
  if (policy.hardLimit.currency !== policy.currency) {
    problems.push("hardLimit currency does not match policy currency");
  }
  if (compare(policy.autoApproveUpTo, policy.hardLimit) === 1) {
    problems.push("autoApproval threshold is above the hard limit");
  }
  for (const tier of policy.tiers) {
    if (tier.above.currency !== policy.currency) {
      problems.push(`tier ${tier.above.amount} currency does not match policy currency`);
    }
    if (tier.roles.length === 0) {
      problems.push(`tier above ${tier.above.amount} has no roles`);
    }
  }
  if (policy.allowedRoles.length === 0) {
    problems.push("allowedRoles is empty");
  }
  return problems;
}
