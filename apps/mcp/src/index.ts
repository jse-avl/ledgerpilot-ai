/**
 * @ledgerpilot/mcp — the agent-facing surface of the back office.
 *
 * Five tools, one of which writes, and that one only writes a proposal. Every
 * tool reads through `runAsTenant`, so the workspace boundary is enforced by
 * Row Level Security rather than by prompt discipline.
 */

export * from "./capabilities";
export * from "./http";
export * from "./server";
export * from "./store";
export * from "./tenant";
export * from "./tools";
