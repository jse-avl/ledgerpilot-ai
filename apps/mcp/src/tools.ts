import type { McpServer } from "@modelcontextprotocol/server";
import type { DatabaseHandle } from "@ledgerpilot/db";
import { z } from "zod";
import { currentCapabilities, summarizeCapabilities } from "./capabilities";
import {
  DomainError,
  getInvoice,
  health,
  listDiscrepancies,
  proposeAction,
  searchDocuments,
} from "./store";
import type { Workspace } from "./tenant";

export interface ToolContext {
  readonly handle: DatabaseHandle;
  readonly workspace: Workspace;
}

const workspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

const invoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  vendorName: z.string(),
  currency: z.string(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  subtotalMinor: z.number(),
  taxMinor: z.number(),
  totalMinor: z.number(),
  openMinor: z.number(),
  status: z.string(),
});

function ok(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function fail(code: string, message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `${code}: ${message}` }],
  };
}

function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof DomainError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "INTERNAL_ERROR", message: error.message };
  return { code: "INTERNAL_ERROR", message: String(error) };
}

/**
 * Tool surface.
 *
 * Read tools are safe to call in a loop. The only write tool creates a
 * proposal: it cannot move money, and it says so in its response.
 */
export function registerTools(server: McpServer, context: ToolContext): void {
  const { handle, workspace } = context;

  server.registerTool(
    "health_check",
    {
      title: "Health check",
      description:
        "Report the database driver, the active workspace, row counts, audit-ledger head and which AI capabilities are actually running (cloud, local or heuristic).",
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.literal("ok"),
        driver: z.string(),
        workspace: workspaceSchema,
        counts: z.object({
          documents: z.number(),
          invoices: z.number(),
          payments: z.number(),
          openDiscrepancies: z.number(),
          proposals: z.number(),
          ledgerEntries: z.number(),
        }),
        ledgerHead: z.string().nullable(),
        checkedAt: z.string(),
        capabilities: z.object({
          resolvedMode: z.string(),
          cloudKeysPresent: z.array(z.string()),
          localAvailable: z.boolean(),
          capabilities: z.array(
            z.object({
              capability: z.string(),
              mode: z.string(),
              provider: z.string(),
              model: z.string().nullable(),
              reasonCode: z.string(),
            }),
          ),
          warningCodes: z.array(z.string()),
        }),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const report = await health(handle, workspace);
        const capabilities = summarizeCapabilities(await currentCapabilities());
        return ok({ ...report, capabilities });
      } catch (error) {
        const described = describeError(error);
        return fail(described.code, described.message);
      }
    },
  );

  server.registerTool(
    "search_documents",
    {
      title: "Search documents",
      description:
        "Full-text search across invoice PDFs, payment advices and policies in the active workspace. Returns page-level snippets you can cite.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Words or a vendor/invoice reference to search for"),
        limit: z.number().int().min(1).max(25).optional().describe("Maximum hits (default 10)"),
      }),
      outputSchema: z.object({
        query: z.string(),
        count: z.number(),
        strategy: z.string(),
        results: z.array(
          z.object({
            id: z.string(),
            filename: z.string(),
            kind: z.string(),
            pageCount: z.number().nullable(),
            rank: z.number(),
            snippet: z.string(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        const result = await searchDocuments(handle, workspace.id, query, limit ?? 10);
        return ok({ ...result });
      } catch (error) {
        const described = describeError(error);
        return fail(described.code, described.message);
      }
    },
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get invoice",
      description:
        "Fetch one invoice by UUID or invoice number, with line items, payment allocations, related discrepancies and the source document.",
      inputSchema: z.object({
        reference: z.string().min(1).describe("Invoice UUID or human invoice number, e.g. INV-2026-1003"),
      }),
      outputSchema: z.object({
        invoice: invoiceSchema,
        lines: z.array(
          z.object({
            lineNo: z.number(),
            description: z.string(),
            quantityMilli: z.number(),
            unitPriceMinor: z.number(),
            taxMinor: z.number(),
            totalMinor: z.number(),
            accountCode: z.string().nullable(),
          }),
        ),
        allocations: z.array(
          z.object({
            paymentId: z.string(),
            reference: z.string(),
            amountMinor: z.number(),
            currency: z.string(),
            paidAt: z.string(),
            strategy: z.string(),
          }),
        ),
        discrepancies: z.array(
          z.object({
            id: z.string(),
            kind: z.string(),
            severity: z.string(),
            detail: z.string(),
            status: z.string(),
          }),
        ),
        sourceDocument: z.object({ id: z.string(), filename: z.string() }).nullable(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ reference }) => {
      try {
        const invoice = await getInvoice(handle, workspace.id, reference);
        if (!invoice) {
          return fail("INVOICE_NOT_FOUND", `No invoice matches "${reference}" in ${workspace.slug}`);
        }
        return ok({ ...invoice });
      } catch (error) {
        const described = describeError(error);
        return fail(described.code, described.message);
      }
    },
  );

  server.registerTool(
    "list_discrepancies",
    {
      title: "List discrepancies",
      description:
        "List reconciliation exceptions: duplicates, amount mismatches, overpayments, unmatched payments and their severity.",
      inputSchema: z.object({
        status: z.enum(["open", "resolved", "all"]).optional().describe("Defaults to open"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum rows (default 25)"),
      }),
      outputSchema: z.object({
        status: z.string(),
        count: z.number(),
        discrepancies: z.array(
          z.object({
            id: z.string(),
            kind: z.string(),
            severity: z.string(),
            detail: z.string(),
            status: z.string(),
            invoiceId: z.string().nullable(),
            paymentId: z.string().nullable(),
            amountMinor: z.number().nullable(),
            currency: z.string().nullable(),
            createdAt: z.string(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit }) => {
      try {
        const result = await listDiscrepancies(handle, workspace.id, {
          ...(status ? { status } : {}),
          limit: limit ?? 25,
        });
        return ok({ ...result });
      } catch (error) {
        const described = describeError(error);
        return fail(described.code, described.message);
      }
    },
  );

  server.registerTool(
    "propose_action",
    {
      title: "Propose an action",
      description:
        "Create a two-phase proposal (payload hash + nonce) for a human to approve. This NEVER executes anything: it is the only write tool and it only records intent.",
      inputSchema: z.object({
        type: z.enum(["allocate_payment", "flag_discrepancy"]),
        paymentId: z.string().uuid().optional().describe("Required for allocate_payment"),
        invoiceId: z.string().uuid().optional().describe("Required for allocate_payment"),
        discrepancyId: z.string().uuid().optional().describe("Required for flag_discrepancy"),
        amountMinor: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Minor units; defaults to the smaller of payment and open balance"),
        note: z.string().max(500).optional(),
      }),
      outputSchema: z.object({
        proposalId: z.string(),
        kind: z.string(),
        status: z.literal("pending_approval"),
        summary: z.string(),
        payload: z.record(z.string(), z.unknown()),
        payloadHash: z.string(),
        nonce: z.string(),
        expiresAt: z.string(),
        approval: z.object({
          decision: z.string(),
          requiredRoles: z.array(z.string()),
          minApprovals: z.number(),
          excludedApproverIds: z.array(z.string()),
          reasons: z.array(z.object({ code: z.string(), message: z.string() })),
        }),
        executed: z.literal(false),
        message: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const result = await proposeAction(handle, workspace, input);
        return ok({ ...result });
      } catch (error) {
        const described = describeError(error);
        return fail(described.code, described.message);
      }
    },
  );
}
