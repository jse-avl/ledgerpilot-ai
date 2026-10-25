import { relations } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * All monetary columns are `bigint` minor units paired with a currency column.
 * All tenant-scoped tables carry `tenant_id` and are protected by RLS (0002_rls.sql).
 */

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("tenants_slug_key").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Better Auth user id. No FK until the auth schema lands in week 1. */
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_tenant_user_key").on(table.tenantId, table.userId),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    pageCount: integer("page_count"),
    status: text("status").notNull().default("uploaded"),
    uploadedBy: text("uploaded_by").notNull(),
    searchText: text("search_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_tenant_idx").on(table.tenantId),
    index("documents_tenant_sha_idx").on(table.tenantId, table.sha256),
  ],
);

export const extractions = pgTable(
  "extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    /** heuristic | ocr | local | cloud */
    method: text("method").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    status: text("status").notNull().default("pending"),
    raw: jsonb("raw"),
    confidenceBp: integer("confidence_bp").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("extractions_document_version_key").on(table.documentId, table.version)],
);

export const extractionFields = pgTable(
  "extraction_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    extractionId: uuid("extraction_id")
      .notNull()
      .references(() => extractions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    valueText: text("value_text"),
    valueNumber: bigint("value_number", { mode: "number" }),
    page: integer("page"),
    bbox: jsonb("bbox"),
    snippet: text("snippet"),
    confidenceBp: integer("confidence_bp").notNull().default(0),
    method: text("method").notNull(),
  },
  (table) => [index("extraction_fields_extraction_idx").on(table.extractionId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vendorId: text("vendor_id").notNull(),
    vendorName: text("vendor_name").notNull(),
    number: text("number").notNull(),
    normalizedNumber: text("normalized_number").notNull(),
    currency: text("currency").notNull(),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    openMinor: bigint("open_minor", { mode: "number" }).notNull(),
    status: text("status").notNull().default("open"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    extractionId: uuid("extraction_id").references(() => extractions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("invoices_tenant_vendor_number_idx").on(
      table.tenantId,
      table.vendorId,
      table.normalizedNumber,
    ),
    index("invoices_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    accountCode: text("account_code"),
  },
  (table) => [uniqueIndex("invoice_lines_invoice_line_key").on(table.invoiceId, table.lineNo)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    vendorId: text("vendor_id"),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    paidAt: date("paid_at", { mode: "string" }).notNull(),
    method: text("method").notNull().default("transfer"),
    fingerprint: text("fingerprint").notNull(),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("payments_tenant_date_idx").on(table.tenantId, table.paidAt),
    index("payments_tenant_fingerprint_idx").on(table.tenantId, table.fingerprint),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    strategy: text("strategy").notNull(),
    confidenceBp: integer("confidence_bp").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_allocations_payment_invoice_key").on(table.paymentId, table.invoiceId),
  ],
);

export const discrepancies = pgTable(
  "discrepancies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    currency: text("currency"),
    detail: text("detail").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("discrepancies_tenant_status_idx").on(table.tenantId, table.status)],
);

export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    /** Exact decimal string, e.g. "0.9237". Never a float. */
    rate: text("rate").notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    source: text("source").notNull().default("manual"),
  },
  (table) => [uniqueIndex("fx_rates_pair_date_key").on(table.base, table.quote, table.asOf)],
);

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    nonce: text("nonce").notNull(),
    status: text("status").notNull().default("pending_approval"),
    riskFlags: jsonb("risk_flags").notNull().default([]),
    proposedBy: text("proposed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("proposals_nonce_key").on(table.nonce),
    index("proposals_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    approverId: text("approver_id").notNull(),
    decision: text("decision").notNull(),
    payloadHash: text("payload_hash").notNull(),
    nonce: text("nonce").notNull(),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("approvals_proposal_approver_key").on(table.proposalId, table.approverId)],
);

export const actionLedger = pgTable(
  "action_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    prevHash: text("prev_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_ledger_tenant_seq_key").on(table.tenantId, table.seq),
    uniqueIndex("action_ledger_tenant_hash_key").on(table.tenantId, table.entryHash),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflow: text("workflow").notNull(),
    status: text("status").notNull().default("running"),
    /** heuristic | local | cloud */
    mode: text("mode").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    traceId: text("trace_id"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("agent_runs_tenant_started_idx").on(table.tenantId, table.startedAt)],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    suite: text("suite").notNull(),
    mode: text("mode").notNull(),
    model: text("model"),
    datasetVersion: text("dataset_version").notNull(),
    promptVersion: text("prompt_version"),
    metrics: jsonb("metrics").notNull(),
    passed: integer("passed").notNull(),
    failed: integer("failed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("eval_runs_suite_idx").on(table.suite, table.createdAt)],
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  documents: many(documents),
  invoices: many(invoices),
  payments: many(payments),
}));

export const invoiceRelations = relations(invoices, ({ one, many }) => ({
  tenant: one(tenants, { fields: [invoices.tenantId], references: [tenants.id] }),
  lines: many(invoiceLines),
  allocations: many(paymentAllocations),
}));

export const invoiceLineRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
}));

export const paymentRelations = relations(payments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [payments.tenantId], references: [tenants.id] }),
  allocations: many(paymentAllocations),
}));

export const schema = {
  tenants,
  memberships,
  documents,
  extractions,
  extractionFields,
  invoices,
  invoiceLines,
  payments,
  paymentAllocations,
  discrepancies,
  fxRates,
  proposals,
  approvals,
  actionLedger,
  agentRuns,
  evalRuns,
};
