import {
  agingBucket,
  daysPastDue,
  defaultPolicy,
  evaluateApproval,
  money,
  verifyLedger,
  type AgingBucket,
  type LedgerEntry,
} from "@ledgerpilot/core";
import { runAsTenant, schema } from "@ledgerpilot/db";
import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDatabase } from "./db";
import { demoAsOf, type Workspace } from "./workspace";

/**
 * Read models for the UI. Every query runs inside `runAsTenant`, so a bug in a
 * page cannot leak another workspace's rows: the database refuses.
 */

export interface InvoiceSummary {
  readonly id: string;
  readonly number: string;
  readonly vendorName: string;
  readonly currency: string;
  readonly issueDate: string;
  readonly dueDate: string | null;
  readonly totalMinor: number;
  readonly openMinor: number;
  readonly status: string;
}

export interface CurrencyTotal {
  readonly currency: string;
  readonly amountMinor: number;
  readonly count: number;
}

export interface AgingRow {
  readonly currency: string;
  readonly buckets: Record<AgingBucket, number>;
  readonly totalMinor: number;
}

export interface DiscrepancyRow {
  readonly id: string;
  readonly kind: string;
  readonly severity: string;
  readonly detail: string;
  readonly status: string;
  readonly createdAt: string;
  readonly invoiceId: string | null;
  readonly invoiceNumber: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
}

export interface LedgerSummary {
  readonly entries: number;
  readonly head: string | null;
  readonly verified: boolean;
  readonly failedAt: number | null;
}

export interface Overview {
  readonly workspace: Workspace;
  readonly asOf: string;
  readonly counts: {
    readonly invoices: number;
    readonly payments: number;
    readonly documents: number;
    readonly openInvoices: number;
    readonly overdueInvoices: number;
    readonly openDiscrepancies: number;
    readonly pendingProposals: number;
  };
  readonly openTotals: readonly CurrencyTotal[];
  readonly overdueTotals: readonly CurrencyTotal[];
  readonly aging: readonly AgingRow[];
  readonly recentInvoices: readonly InvoiceSummary[];
  readonly exceptions: readonly DiscrepancyRow[];
  readonly ledger: LedgerSummary;
}

function groupTotals(
  rows: readonly { currency: string; amountMinor: number; count?: number }[],
): CurrencyTotal[] {
  const totals = new Map<string, { amountMinor: number; count: number }>();
  for (const row of rows) {
    const current = totals.get(row.currency) ?? { amountMinor: 0, count: 0 };
    totals.set(row.currency, {
      amountMinor: current.amountMinor + row.amountMinor,
      count: current.count + (row.count ?? 1),
    });
  }
  return [...totals.entries()]
    .map(([currency, value]) => ({ currency, ...value }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function agingOf(invoices: readonly InvoiceSummary[], asOf: string): AgingRow[] {
  const byCurrency = new Map<string, Record<AgingBucket, number>>();
  for (const invoice of invoices) {
    if (invoice.openMinor <= 0 || !invoice.dueDate) continue;
    const buckets = byCurrency.get(invoice.currency) ?? {
      current: 0,
      "1-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
    };
    buckets[agingBucket(daysPastDue(invoice.dueDate, asOf))] += invoice.openMinor;
    byCurrency.set(invoice.currency, buckets);
  }
  return [...byCurrency.entries()]
    .map(([currency, buckets]) => ({
      currency,
      buckets,
      totalMinor: Object.values(buckets).reduce((total, value) => total + value, 0),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function toLedger(rows: readonly (typeof schema.actionLedger.$inferSelect)[]): LedgerSummary {
  const entries: LedgerEntry[] = rows.map((row) => ({
    seq: row.seq,
    tenantId: row.tenantId,
    actorId: row.actorId,
    action: row.action,
    payload: row.payload as Record<string, unknown>,
    createdAt: row.createdAt,
    prevHash: row.prevHash,
    entryHash: row.entryHash,
  }));
  const verification = verifyLedger(entries);
  return {
    entries: entries.length,
    head: entries.at(-1)?.entryHash ?? null,
    verified: verification.valid,
    failedAt: verification.valid ? null : verification.brokenAt,
  };
}

export async function loadOverview(workspace: Workspace): Promise<Overview> {
  const handle = await getDatabase();
  const asOf = demoAsOf();

  return runAsTenant(handle, workspace.id, async (db) => {
    const invoices = await db
      .select({
        id: schema.invoices.id,
        number: schema.invoices.number,
        vendorName: schema.invoices.vendorName,
        currency: schema.invoices.currency,
        issueDate: schema.invoices.issueDate,
        dueDate: schema.invoices.dueDate,
        totalMinor: schema.invoices.totalMinor,
        openMinor: schema.invoices.openMinor,
        status: schema.invoices.status,
      })
      .from(schema.invoices)
      .orderBy(asc(schema.invoices.dueDate));

    const payments = await db.select({ count: sql<number>`count(*)::int` }).from(schema.payments);
    const documents = await db.select({ count: sql<number>`count(*)::int` }).from(schema.documents);
    const issues = await db
      .select({
        id: schema.discrepancies.id,
        kind: schema.discrepancies.kind,
        severity: schema.discrepancies.severity,
        detail: schema.discrepancies.detail,
        status: schema.discrepancies.status,
        createdAt: schema.discrepancies.createdAt,
        invoiceId: schema.discrepancies.invoiceId,
        invoiceNumber: schema.invoices.number,
        amountMinor: schema.discrepancies.amountMinor,
        currency: schema.discrepancies.currency,
      })
      .from(schema.discrepancies)
      .leftJoin(schema.invoices, eq(schema.discrepancies.invoiceId, schema.invoices.id))
      .where(eq(schema.discrepancies.status, "open"))
      .orderBy(desc(schema.discrepancies.createdAt));
    const proposals = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.proposals)
      .where(eq(schema.proposals.status, "pending_approval"));
    const ledgerRows = await db
      .select()
      .from(schema.actionLedger)
      .orderBy(asc(schema.actionLedger.seq));

    const open = invoices.filter((invoice) => invoice.openMinor > 0);
    const overdue = open.filter((invoice) => invoice.dueDate !== null && invoice.dueDate < asOf);

    return {
      workspace,
      asOf,
      counts: {
        invoices: invoices.length,
        payments: payments[0]?.count ?? 0,
        documents: documents[0]?.count ?? 0,
        openInvoices: open.length,
        overdueInvoices: overdue.length,
        openDiscrepancies: issues.length,
        pendingProposals: proposals[0]?.count ?? 0,
      },
      openTotals: groupTotals(
        open.map((invoice) => ({ currency: invoice.currency, amountMinor: invoice.openMinor })),
      ),
      overdueTotals: groupTotals(
        overdue.map((invoice) => ({ currency: invoice.currency, amountMinor: invoice.openMinor })),
      ),
      aging: agingOf(open, asOf),
      recentInvoices: open.slice(0, 6),
      exceptions: issues.slice(0, 5),
      ledger: toLedger(ledgerRows),
    };
  });
}

export async function listInvoices(workspace: Workspace, query = ""): Promise<InvoiceSummary[]> {
  const handle = await getDatabase();
  const term = query.trim();
  return runAsTenant(handle, workspace.id, async (db) => {
    const search = term === "" ? undefined : `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await db
      .select({
        id: schema.invoices.id,
        number: schema.invoices.number,
        vendorName: schema.invoices.vendorName,
        currency: schema.invoices.currency,
        issueDate: schema.invoices.issueDate,
        dueDate: schema.invoices.dueDate,
        totalMinor: schema.invoices.totalMinor,
        openMinor: schema.invoices.openMinor,
        status: schema.invoices.status,
      })
      .from(schema.invoices)
      .where(
        search
          ? or(ilike(schema.invoices.number, search), ilike(schema.invoices.vendorName, search))
          : undefined,
      )
      .orderBy(desc(schema.invoices.issueDate), asc(schema.invoices.number));
    return rows;
  });
}

export interface InvoiceDetail {
  readonly invoice: InvoiceSummary & {
    readonly subtotalMinor: number;
    readonly taxMinor: number;
    readonly sourceDocumentId: string | null;
  };
  readonly lines: readonly {
    readonly lineNo: number;
    readonly description: string;
    readonly quantityMilli: number;
    readonly unitPriceMinor: number;
    readonly taxMinor: number;
    readonly totalMinor: number;
    readonly accountCode: string | null;
  }[];
  readonly allocations: readonly {
    readonly paymentId: string;
    readonly reference: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly paidAt: string;
    readonly strategy: string;
  }[];
  readonly issues: readonly DiscrepancyRow[];
  readonly document: { readonly id: string; readonly filename: string; readonly sha256: string } | null;
}

export async function loadInvoice(
  workspace: Workspace,
  reference: string,
): Promise<InvoiceDetail | null> {
  const handle = await getDatabase();
  const ref = reference.trim();
  if (ref === "") return null;

  return runAsTenant(handle, workspace.id, async (db) => {
    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(
        /^[0-9a-f-]{36}$/i.test(ref)
          ? eq(schema.invoices.id, ref)
          : eq(
              schema.invoices.normalizedNumber,
              ref.toUpperCase().replace(/[^A-Z0-9]/g, ""),
            ),
      )
      .limit(1);
    if (!invoice) return null;

    const lines = await db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoice.id))
      .orderBy(asc(schema.invoiceLines.lineNo));

    const allocations = await db
      .select({
        paymentId: schema.payments.id,
        reference: schema.payments.reference,
        amountMinor: schema.paymentAllocations.amountMinor,
        currency: schema.paymentAllocations.currency,
        paidAt: schema.payments.paidAt,
        strategy: schema.paymentAllocations.strategy,
      })
      .from(schema.paymentAllocations)
      .innerJoin(schema.payments, eq(schema.paymentAllocations.paymentId, schema.payments.id))
      .where(eq(schema.paymentAllocations.invoiceId, invoice.id))
      .orderBy(asc(schema.payments.paidAt));

    const issues = await db
      .select({
        id: schema.discrepancies.id,
        kind: schema.discrepancies.kind,
        severity: schema.discrepancies.severity,
        detail: schema.discrepancies.detail,
        status: schema.discrepancies.status,
        createdAt: schema.discrepancies.createdAt,
        invoiceId: schema.discrepancies.invoiceId,
        invoiceNumber: schema.invoices.number,
        amountMinor: schema.discrepancies.amountMinor,
        currency: schema.discrepancies.currency,
      })
      .from(schema.discrepancies)
      .leftJoin(schema.invoices, eq(schema.discrepancies.invoiceId, schema.invoices.id))
      .where(eq(schema.discrepancies.invoiceId, invoice.id));

    let document: InvoiceDetail["document"] = null;
    if (invoice.sourceDocumentId) {
      const [row] = await db
        .select({
          id: schema.documents.id,
          filename: schema.documents.filename,
          sha256: schema.documents.sha256,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, invoice.sourceDocumentId))
        .limit(1);
      document = row ?? null;
    }

    return {
      invoice: {
        id: invoice.id,
        number: invoice.number,
        vendorName: invoice.vendorName,
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        totalMinor: invoice.totalMinor,
        openMinor: invoice.openMinor,
        status: invoice.status,
        subtotalMinor: invoice.subtotalMinor,
        taxMinor: invoice.taxMinor,
        sourceDocumentId: invoice.sourceDocumentId,
      },
      lines: lines.map((line) => ({
        lineNo: line.lineNo,
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitPriceMinor: line.unitPriceMinor,
        taxMinor: line.taxMinor,
        totalMinor: line.totalMinor,
        accountCode: line.accountCode,
      })),
      allocations,
      issues,
      document,
    };
  });
}

export async function listDiscrepancies(
  workspace: Workspace,
  status: "open" | "all" = "open",
): Promise<DiscrepancyRow[]> {
  const handle = await getDatabase();
  return runAsTenant(handle, workspace.id, async (db) => {
    const base = db
      .select({
        id: schema.discrepancies.id,
        kind: schema.discrepancies.kind,
        severity: schema.discrepancies.severity,
        detail: schema.discrepancies.detail,
        status: schema.discrepancies.status,
        createdAt: schema.discrepancies.createdAt,
        invoiceId: schema.discrepancies.invoiceId,
        invoiceNumber: schema.invoices.number,
        amountMinor: schema.discrepancies.amountMinor,
        currency: schema.discrepancies.currency,
      })
      .from(schema.discrepancies)
      .leftJoin(schema.invoices, eq(schema.discrepancies.invoiceId, schema.invoices.id));

    const rows =
      status === "all"
        ? await base.orderBy(desc(schema.discrepancies.createdAt))
        : await base
            .where(eq(schema.discrepancies.status, "open"))
            .orderBy(desc(schema.discrepancies.createdAt));
    return rows;
  });
}

export interface ProposalRow {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly status: string;
  readonly payloadHash: string;
  readonly nonce: string;
  readonly proposedBy: string;
  readonly riskFlags: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly requiredRoles: readonly string[];
  readonly minApprovals: number;
  readonly excludedApproverIds: readonly string[];
}

function payloadField(payload: unknown, field: string): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  return (payload as Record<string, unknown>)[field];
}

export async function listProposals(
  workspace: Workspace,
  status?: string,
): Promise<ProposalRow[]> {
  const handle = await getDatabase();
  return runAsTenant(handle, workspace.id, async (db) => {
    const base = db.select().from(schema.proposals);
    const rows =
      status === undefined
        ? await base.orderBy(desc(schema.proposals.createdAt))
        : await base
            .where(eq(schema.proposals.status, status))
            .orderBy(desc(schema.proposals.createdAt));

    return rows.map((row) => {
      const amountMinor = Number(payloadField(row.payload, "amountMinor") ?? 0);
      const currency = String(payloadField(row.payload, "currency") ?? workspace.currency);
      const riskFlags = Array.isArray(row.riskFlags)
        ? row.riskFlags.filter((flag): flag is string => typeof flag === "string")
        : [];
      const evaluation = evaluateApproval(
        {
          id: row.id,
          kind: row.kind,
          amount: money(amountMinor, currency),
          proposer: { id: row.proposedBy, roles: ["analyst"] },
          riskFlags,
        },
        defaultPolicy(currency),
      );

      return {
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        status: row.status,
        payloadHash: row.payloadHash,
        nonce: row.nonce,
        proposedBy: row.proposedBy,
        riskFlags,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        amountMinor,
        currency,
        requiredRoles: evaluation.decision === "denied" ? [] : evaluation.requiredRoles,
        minApprovals: evaluation.decision === "denied" ? 0 : evaluation.minApprovals,
        excludedApproverIds: evaluation.decision === "denied" ? [] : evaluation.excludedApproverIds,
      };
    });
  });
}

export interface AssistantFacts {
  readonly invoices: readonly {
    readonly id: string;
    readonly number: string;
    readonly vendorName: string;
    readonly currency: string;
    readonly totalMinor: number;
    readonly openMinor: number;
    readonly dueDate: string;
    readonly status: string;
    readonly sourceDocumentId: string | null;
  }[];
  readonly discrepancies: readonly {
    readonly id: string;
    readonly kind: string;
    readonly severity: string;
    readonly detail: string;
  }[];
}

export async function loadAssistantFacts(workspace: Workspace): Promise<AssistantFacts> {
  const handle = await getDatabase();
  return runAsTenant(handle, workspace.id, async (db) => {
    const invoices = await db
      .select({
        id: schema.invoices.id,
        number: schema.invoices.number,
        vendorName: schema.invoices.vendorName,
        currency: schema.invoices.currency,
        totalMinor: schema.invoices.totalMinor,
        openMinor: schema.invoices.openMinor,
        issueDate: schema.invoices.issueDate,
        dueDate: schema.invoices.dueDate,
        status: schema.invoices.status,
        sourceDocumentId: schema.invoices.sourceDocumentId,
      })
      .from(schema.invoices)
      .orderBy(asc(schema.invoices.dueDate));
    const issues = await db
      .select({
        id: schema.discrepancies.id,
        kind: schema.discrepancies.kind,
        severity: schema.discrepancies.severity,
        detail: schema.discrepancies.detail,
      })
      .from(schema.discrepancies)
      .where(eq(schema.discrepancies.status, "open"));

    return {
      invoices: invoices.map((invoice) => ({
        ...invoice,
        dueDate: invoice.dueDate ?? invoice.issueDate,
      })),
      discrepancies: issues,
    };
  });
}
