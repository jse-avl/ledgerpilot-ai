import { describe, expect, it } from "vitest";
import { money } from "../src/money";
import {
  type ActionProposal,
  canApprove,
  defaultPolicy,
  evaluateApproval,
  validatePolicy,
} from "../src/approvals";

const policy = defaultPolicy("USD");

function proposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "prop-1",
    kind: "apply_payment",
    amount: money(10_000, "USD"),
    proposer: { id: "user-1", roles: ["analyst"] },
    ...overrides,
  };
}

describe("approval policy", () => {
  it("auto-approves small, low-risk actions", () => {
    const evaluation = evaluateApproval(proposal(), policy);
    expect(evaluation.decision).toBe("auto_approved");
    expect(evaluation.requiredRoles).toEqual([]);
  });

  it("requires a finance manager above the auto-approval threshold", () => {
    const evaluation = evaluateApproval(proposal({ amount: money(200_000, "USD") }), policy);
    expect(evaluation.decision).toBe("requires_approval");
    expect(evaluation.requiredRoles).toEqual(["finance_manager"]);
    expect(evaluation.excludedApproverIds).toEqual(["user-1"]);
  });

  it("requires two roles for large amounts", () => {
    const evaluation = evaluateApproval(proposal({ amount: money(2_000_000, "USD") }), policy);
    expect(evaluation.decision).toBe("requires_approval");
    expect(evaluation.requiredRoles).toEqual(["finance_manager", "controller"]);
    expect(evaluation.minApprovals).toBe(2);
  });

  it("denies anything above the hard limit", () => {
    const evaluation = evaluateApproval(proposal({ amount: money(6_000_000, "USD") }), policy);
    expect(evaluation.decision).toBe("denied");
    expect(evaluation.reasons[0]?.code).toBe("ABOVE_HARD_LIMIT");
  });

  it("denies blocked risk flags even for small amounts", () => {
    const evaluation = evaluateApproval(
      proposal({ riskFlags: ["prompt_injection_suspected"] }),
      policy,
    );
    expect(evaluation.decision).toBe("denied");
    expect(evaluation.reasons[0]?.code).toBe("BLOCKED_RISK_FLAG");
  });

  it("escalates unknown risk flags instead of auto-approving", () => {
    const evaluation = evaluateApproval(proposal({ riskFlags: ["new_vendor"] }), policy);
    expect(evaluation.decision).toBe("requires_approval");
  });

  it("denies proposers without an allowed role", () => {
    const evaluation = evaluateApproval(
      proposal({ proposer: { id: "user-9", roles: ["intern"] } }),
      policy,
    );
    expect(evaluation.decision).toBe("denied");
    expect(evaluation.reasons[0]?.code).toBe("PROPOSER_NOT_ALLOWED");
  });

  it("denies currency mismatches", () => {
    const evaluation = evaluateApproval(proposal({ amount: money(100, "EUR") }), policy);
    expect(evaluation.reasons[0]?.code).toBe("CURRENCY_MISMATCH");
  });

  it("enforces separation of duties", () => {
    const evaluation = evaluateApproval(proposal({ amount: money(200_000, "USD") }), policy);
    const proposerCheck = canApprove(evaluation, { id: "user-1", roles: ["finance_manager"] });
    expect(proposerCheck.allowed).toBe(false);

    const managerCheck = canApprove(evaluation, { id: "user-2", roles: ["finance_manager"] });
    expect(managerCheck.allowed).toBe(true);

    const analystCheck = canApprove(evaluation, { id: "user-3", roles: ["analyst"] });
    expect(analystCheck.allowed).toBe(false);
  });

  it("validates a clean policy", () => {
    expect(validatePolicy(policy)).toEqual([]);
  });

  it("reports a threshold above the hard limit", () => {
    const problems = validatePolicy({
      ...policy,
      autoApproveUpTo: money(9_000_000, "USD"),
    });
    expect(problems.join(" ")).toMatch(/autoApproval threshold is above the hard limit/);
  });
});
