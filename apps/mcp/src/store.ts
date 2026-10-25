import { randomUUID } from "node:crypto";
import {
  appendLedgerEntry,
  createProposal,
  defaultPolicy,
  evaluateApproval,
  format,
  money,
  normalizeInvoiceNumber,
  type ApprovalEvaluation,
  type LedgerEntry,
} from "@ledgerpilot/core";
import { runAsTenant, schema, type DatabaseHandle } from "@ledgerpilot/db";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * Tenant-scoped reads and proposal writes. Every query runs through
 * `runAsTenant`, so the RLS policy is the enforcement point, not a JavaScript
 * filter that a future refactor can forget.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

function clampLimit(limit: number, fallback = 10, max = 25): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

// ---------------------------------------------------------------- search

export interface DocumentHit {
  readonly id: string;
  readonly filename: string;
  readonly kind: string;
  readonly pageCount: number | null;
  readonly rank: number;
  readonly snippet: string;
}

export interface DocumentSearchResult {
  readonly query: string;
  readonly count: number;
  readonly strategy: "full_text" | "substring" | "empty";
  readonly results: readonly DocumentHit[];
}

export async function searchDocuments(
  handle: DatabaseHandle,
  tenantId: string,
  query: string,
  limit = 10,
): Promise<DocumentSearchResult> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { query, count: 0, strategy: "empty", results: [] };
  }
  const capped = clampLimit(limit);

  return runAsTenant(handle, tenantId, async (db) => {
    const rank = sql<number>`(ts_rank_cd(
      to_tsvector('simple', ${schema.documents.searchText}),
      plainto_tsquery('simple', ${trimmed})
    ))::float8`;
    const snippet = sql<string>`ts_headline(
      'simple',
      ${schema.documents.searchText},
      plainto_tsquery('simple', ${trimmed}),
      'MaxWords=25, MinWords=8'
    )`;

    const rows = await db
      .select({
        id: schema.documents.id,
        filename: schema.documents.filename,
        kind: schema.documents.kind,
        pageCount: schema.documents.pageCount,
        rank,
        snippet,
      })
      .from(schema.documents)
      .where(
        sql`to_tsvector('simple', ${schema.documents.searchText}) @@ plainto_tsquery('simple', ${trimmed})`,
      )
      .orderBy(sql`${rank} desc`, desc(schema.documents.createdAt))
      .limit(capped);

    if (rows.length > 0) {
      return { query: trimmed, count: rows.length, strategy: "full_text", results: rows };
    }

    // Full-text search is exact on lexemes: "invoi" matches nothing. A
    // substring pass keeps partial references useful without pretending it
    // ranked well (rank stays 0 so the answer can say so).
    const escaped = trimmed.replace(/[\\%_]/g, (match) => `\\${match}`);
    const fallback = await db
      .select({
        id: schema.documents.id,
        filename: schema.documents.filename,
        kind: schema.documents.kind,
        pageCount: schema.documents.pageCount,
        snippet: sql<string>`left(${schema.documents.searchText}, 200)`,
      })
      .from(schema.documents)
      .where(sql`${schema.documents.searchText} ilike ${`%${escaped}%`}`)
      .orderBy(desc(schema.documents.createdAt))
      .limit(capped);

    return {
      query: trimmed,
      count: fallback.length,
      strategy: "substring",
      results: fallback.map((row) => ({ ...row, rank: 0 })),
    };
  });
}

// ---------------------------------------------------------------- invoices

export interface InvoiceDetail {
  readonly invoice: {
    readonly id: string;
    readonly number: string;
    readonly vendorName: string;
    readonly currency: string;
    readonly issueDate: string;
    readonly dueDate: string | null;
    readonly subtotalMinor: number;
    readonly taxMinor: number;
    readonly totalMinor: number;
    readonly openMinor: number;
    readonly status: string;
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
  readonly discrepancies: readonly {
    readonly id: string;
    readonly kind: string;
    readonly severity: string;
    readonly detail: string;
    readonly status: string;
  }[];
  readonly sourceDocument: { readonly id: string; readonly filename: string } | null;
}

export async function getInvoice(
  handle: DatabaseHandle,
  tenantId: string,
  reference: string,
): Promise<InvoiceDetail | null> {
  const ref = reference.trim();
  if (ref === "") return null;

  return runAsTenant(handle, tenantId, async (db) => {
    const where = UUID_RE.test(ref)
      ? eq(schema.invoices.id, ref)
      : eq(schema.invoices.normalizedNumber, normalizeInvoiceNumber(ref));

    const [invoice] = await db.select().from(schema.invoices).where(where).limit(1);
    if (!invoice) return null;

    const lines = await db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoice.id))
      .orderBy(schema.invoiceLines.lineNo);

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
      .where(eq(schema.paymentAllocations.invoiceId, invoice.id));

    const issues = await db
      .select({
        id: schema.discrepancies.id,
        kind: schema.discrepancies.kind,
        severity: schema.discrepancies.severity,
        detail: schema.discrepancies.detail,
        status: schema.discrepancies.status,
      })
      .from(schema.discrepancies)
      .where(eq(schema.discrepancies.invoiceId, invoice.id));

    let sourceDocument: { id: string; filename: string } | null = null;
    if (invoice.sourceDocumentId) {
      const [document] = await db
        .select({ id: schema.documents.id, filename: schema.documents.filename })
        .from(schema.documents)
        .where(eq(schema.documents.id, invoice.sourceDocumentId))
        .limit(1);
      sourceDocument = document ?? null;
    }

    return {
      invoice: {
        id: invoice.id,
        number: invoice.number,
        vendorName: invoice.vendorName,
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotalMinor: invoice.subtotalMinor,
        taxMinor: invoice.taxMinor,
        totalMinor: invoice.totalMinor,
        openMinor: invoice.openMinor,
        status: invoice.status,
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
      discrepancies: issues,
      sourceDocument,
    };
  });
}

// ---------------------------------------------------------------- discrepancies

export interface DiscrepancyRow {
  readonly id: string;
  readonly kind: string;
  readonly severity: string;
  readonly detail: string;
  readonly status: string;
  readonly invoiceId: string | null;
  readonly paymentId: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly createdAt: string;
}

export interface DiscrepancyList {
  readonly status: string;
  readonly count: number;
  readonly discrepancies: readonly DiscrepancyRow[];
}

export async function listDiscrepancies(
  handle: DatabaseHandle,
  tenantId: string,
  options: { status?: string; limit?: number } = {},
): Promise<DiscrepancyList> {
  const status = options.status ?? "open";
  const capped = clampLimit(options.limit ?? 25, 25, 100);

  return runAsTenant(handle, tenantId, async (db) => {
    const query = db
      .select({
        id: schema.discrepancies.id,
        kind: schema.discrepancies.kind,
        severity: schema.discrepancies.severity,
        detail: schema.discrepancies.detail,
        status: schema.discrepancies.status,
        invoiceId: schema.discrepancies.invoiceId,
        paymentId: schema.discrepancies.paymentId,
        amountMinor: schema.discrepancies.amountMinor,
        currency: schema.discrepancies.currency,
        createdAt: schema.discrepancies.createdAt,
      })
      .from(schema.discrepancies);

    const rows =
      status === "all"
        ? await query.orderBy(desc(schema.discrepancies.createdAt)).limit(capped)
        : await query
            .where(eq(schema.discrepancies.status, status))
            .orderBy(desc(schema.discrepancies.createdAt))
            .limit(capped);

    return { status, count: rows.length, discrepancies: rows };
  });
}

// ---------------------------------------------------------------- health

export interface HealthReport {
  readonly status: "ok";
  readonly driver: string;
  readonly workspace: { id: string; slug: string; name: string };
  readonly counts: {
    documents: number;
    invoices: number;
    payments: number;
    openDiscrepancies: number;
    proposals: number;
    ledgerEntries: number;
  };
  readonly ledgerHead: string | null;
  readonly checkedAt: string;
}

export async function health(
  handle: DatabaseHandle,
  workspace: { id: string; slug: string; name: string },
): Promise<HealthReport> {
  return runAsTenant(handle, workspace.id, async (db) => {
    // One statement, not six: a transaction owns a single connection, and the
    // Postgres protocol does not pipeline concurrent queries on it. Running
    // them in parallel works on PGlite but is a bug on node-postgres.
    const result = await db.execute(sql`
      select
        (select count(*)::int from ${schema.documents}) as documents,
        (select count(*)::int from ${schema.invoices}) as invoices,
        (select count(*)::int from ${schema.payments}) as payments,
        (select count(*)::int from ${schema.discrepancies} where ${schema.discrepancies.status} = 'open') as open_discrepancies,
        (select count(*)::int from ${schema.proposals}) as proposals,
        (select seq from ${schema.actionLedger} order by seq desc limit 1) as ledger_seq,
        (select entry_hash from ${schema.actionLedger} order by seq desc limit 1) as ledger_head
    `);
    const row = (result.rows[0] ?? {}) as {
      documents?: number;
      invoices?: number;
      payments?: number;
      open_discrepancies?: number;
      proposals?: number;
      ledger_seq?: number;
      ledger_head?: string | null;
    };

    return {
      status: "ok",
      driver: handle.driver,
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
      counts: {
        documents: Number(row.documents ?? 0),
        invoices: Number(row.invoices ?? 0),
        payments: Number(row.payments ?? 0),
        openDiscrepancies: Number(row.open_discrepancies ?? 0),
        proposals: Number(row.proposals ?? 0),
        ledgerEntries: Number(row.ledger_seq ?? 0),
      },
      ledgerHead: row.ledger_head ?? null,
      checkedAt: new Date().toISOString(),
    };
  });
}

// ---------------------------------------------------------------- proposals

export type ProposalType = "allocate_payment" | "flag_discrepancy";

export interface ProposeInput {
  readonly type: ProposalType;
  readonly paymentId?: string;
  readonly invoiceId?: string;
  readonly discrepancyId?: string;
  readonly amountMinor?: number;
  readonly note?: string;
}

export interface ProposalResult {
  readonly proposalId: string;
  readonly kind: ProposalType;
  readonly status: "pending_approval";
  readonly summary: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly nonce: string;
  readonly expiresAt: string;
  readonly approval: ApprovalEvaluation;
  readonly executed: false;
  readonly message: string;
}

function assertUuid(value: string | undefined, field: string): string {
  if (!value || !UUID_RE.test(value.trim())) {
    throw new DomainError("INVALID_ARGUMENT", `${field} must be a UUID`);
  }
  return value.trim();
}

/**
 * Creates a proposal. It never mutates invoices, payments or allocations: the
 * only rows written are the proposal itself and its audit-ledger entry. A human
 * has to approve it, and execution is a separate audited step.
 */
export async function proposeAction(
  handle: DatabaseHandle,
  workspace: { id: string; slug: string },
  input: ProposeInput,
): Promise<ProposalResult> {
  const createdAt = new Date().toISOString();

  return runAsTenant(handle, workspace.id, async (db) => {
    let amountMinor = 0;
    let currency = "USD";
    let summary = "";
    let payload: Record<string, unknown> = {};

    if (input.type === "allocate_payment") {
      const paymentId = assertUuid(input.paymentId, "paymentId");
      const invoiceId = assertUuid(input.invoiceId, "invoiceId");

      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, paymentId))
        .limit(1);
      if (!payment) throw new DomainError("PAYMENT_NOT_FOUND", `Payment ${paymentId} not found`);

      const [invoice] = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, invoiceId))
        .limit(1);
      if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", `Invoice ${invoiceId} not found`);

      if (payment.currency !== invoice.currency) {
        throw new DomainError(
          "CURRENCY_MISMATCH",
          `Payment is ${payment.currency} and invoice is ${invoice.currency}`,
        );
      }
      if (invoice.openMinor <= 0) {
        throw new DomainError("INVOICE_ALREADY_SETTLED", `Invoice ${invoice.number} has nothing open`);
      }

      const [existing] = await db
        .select({ id: schema.paymentAllocations.id })
        .from(schema.paymentAllocations)
        .where(
          and(
            eq(schema.paymentAllocations.paymentId, paymentId),
            eq(schema.paymentAllocations.invoiceId, invoiceId),
          ),
        )
        .limit(1);
      if (existing) {
        throw new DomainError(
          "ALLOCATION_EXISTS",
          `Payment ${payment.reference} is already allocated to invoice ${invoice.number}`,
        );
      }

      // Validate the amount before looking for duplicates: a request that is
      // invalid on its own terms should say why, not hide behind the fact that
      // an earlier valid proposal is still open.
      amountMinor = input.amountMinor ?? Math.min(payment.amountMinor, invoice.openMinor);
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        throw new DomainError("INVALID_AMOUNT", "amountMinor must be a positive integer");
      }
      if (amountMinor > payment.amountMinor) {
        throw new DomainError(
          "AMOUNT_EXCEEDS_PAYMENT",
          `Amount ${amountMinor} exceeds the payment amount ${payment.amountMinor}`,
        );
      }
      if (amountMinor > invoice.openMinor) {
        throw new DomainError(
          "AMOUNT_EXCEEDS_INVOICE",
          `Amount ${amountMinor} exceeds the open balance ${invoice.openMinor}`,
        );
      }

      // Two pending proposals for the same pair would race each other at
      // approval time. Refuse the duplicate while the first is still open.
      const [pending] = await db
        .select({ id: schema.proposals.id })
        .from(schema.proposals)
        .where(
          and(
            eq(schema.proposals.kind, "allocate_payment"),
            eq(schema.proposals.status, "pending_approval"),
            sql`${schema.proposals.payload}->>'paymentId' = ${paymentId}`,
            sql`${schema.proposals.payload}->>'invoiceId' = ${invoiceId}`,
          ),
        )
        .limit(1);
      if (pending) {
        throw new DomainError(
          "PROPOSAL_EXISTS",
          `A pending proposal already exists for payment ${payment.reference} and invoice ${invoice.number}`,
        );
      }

      currency = invoice.currency;
      summary = `Allocate ${format(money(amountMinor, currency))} from payment ${payment.reference} to invoice ${invoice.number}`;
      payload = {
        type: input.type,
        paymentId,
        paymentReference: payment.reference,
        invoiceId,
        invoiceNumber: invoice.number,
        amountMinor,
        currency,
        ...(input.note ? { note: input.note } : {}),
      };
    } else if (input.type === "flag_discrepancy") {
      const discrepancyId = assertUuid(input.discrepancyId, "discrepancyId");
      const [discrepancy] = await db
        .select()
        .from(schema.discrepancies)
        .where(eq(schema.discrepancies.id, discrepancyId))
        .limit(1);
      if (!discrepancy) {
        throw new DomainError("DISCREPANCY_NOT_FOUND", `Discrepancy ${discrepancyId} not found`);
      }
      if (discrepancy.status !== "open") {
        throw new DomainError(
          "DISCREPANCY_CLOSED",
          `Discrepancy ${discrepancyId} is already ${discrepancy.status}`,
        );
      }

      amountMinor = discrepancy.amountMinor ?? 0;
      currency = discrepancy.currency ?? "USD";
      summary = `Flag ${discrepancy.kind} for controller review`;
      payload = {
        type: input.type,
        discrepancyId,
        kind: discrepancy.kind,
        detail: discrepancy.detail,
        ...(input.note ? { note: input.note } : {}),
      };
    } else {
      const exhaustive: never = input.type;
      throw new DomainError("UNSUPPORTED_ACTION", `Unsupported proposal type: ${String(exhaustive)}`);
    }

    const proposal = createProposal({
      id: randomUUID(),
      tenantId: workspace.id,
      kind: input.type,
      payload,
      proposedBy: "mcp:agent",
      createdAt,
      summary,
    });

    // `agent_initiated` is not a blocked flag, but any risk flag forces a human
    // decision instead of auto-approval. An agent never self-approves.
    const riskFlags = ["agent_initiated"];
    const approval = evaluateApproval(
      {
        id: proposal.id,
        kind: proposal.kind,
        amount: money(amountMinor, currency),
        proposer: { id: proposal.proposedBy, roles: ["analyst"] },
        riskFlags,
      },
      defaultPolicy(currency),
    );

    await db.insert(schema.proposals).values({
      id: proposal.id,
      tenantId: workspace.id,
      kind: proposal.kind,
      summary: proposal.summary,
      payload: proposal.payload,
      payloadHash: proposal.payloadHash,
      nonce: proposal.nonce,
      status: proposal.status,
      riskFlags,
      proposedBy: proposal.proposedBy,
      createdAt: proposal.createdAt,
      expiresAt: proposal.expiresAt,
    });

    const [last] = await db
      .select()
      .from(schema.actionLedger)
      .orderBy(desc(schema.actionLedger.seq))
      .limit(1);

    const chain: LedgerEntry[] = last
      ? [
          {
            seq: last.seq,
            tenantId: last.tenantId,
            actorId: last.actorId,
            action: last.action,
            payload: last.payload,
            createdAt: last.createdAt,
            prevHash: last.prevHash,
            entryHash: last.entryHash,
          },
        ]
      : [];

    const ledgerPayload = {
      proposalId: proposal.id,
      kind: proposal.kind,
      payloadHash: proposal.payloadHash,
    };
    const entry = appendLedgerEntry(chain, {
      tenantId: workspace.id,
      actorId: proposal.proposedBy,
      action: "proposal.created",
      payload: ledgerPayload,
      createdAt,
    });

    await db.insert(schema.actionLedger).values({
      tenantId: workspace.id,
      seq: entry.seq,
      prevHash: entry.prevHash,
      entryHash: entry.entryHash,
      action: entry.action,
      actorId: entry.actorId,
      payload: ledgerPayload,
      createdAt: entry.createdAt,
    });

    return {
      proposalId: proposal.id,
      kind: input.type,
      status: "pending_approval",
      summary: proposal.summary,
      payload,
      payloadHash: proposal.payloadHash,
      nonce: proposal.nonce,
      expiresAt: proposal.expiresAt,
      approval,
      executed: false,
      message:
        "Proposal created. Nothing was executed: a human must approve it in LedgerPilot and execution is a separate, audited step.",
    };
  });
}
