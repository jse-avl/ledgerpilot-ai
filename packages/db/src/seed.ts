import {
  appendLedgerEntry,
  type LedgerEntry,
  type IncomingPayment,
  type OpenInvoice,
  money,
  normalizeInvoiceNumber,
  paymentFingerprint,
  reconcile,
} from "@ledgerpilot/core";
import { eq } from "drizzle-orm";
import { createDatabase, runAsTenant, type DatabaseHandle } from "./client";
import { type DemoTenant, generateDemoData } from "./demo-data";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

export interface SeedResult {
  readonly tenants: number;
  readonly invoices: number;
  readonly payments: number;
  readonly allocations: number;
  readonly discrepancies: number;
  readonly skippedTenants: string[];
}

export interface SeedOptions {
  readonly reset?: boolean;
  readonly migrate?: boolean;
  readonly silent?: boolean;
}

const SEED_TIMESTAMP = "2026-06-15T09:00:00.000Z";

const TRUNCATE_ORDER = [
  "action_ledger",
  "agent_runs",
  "approvals",
  "proposals",
  "discrepancies",
  "payment_allocations",
  "payments",
  "invoice_lines",
  "invoices",
  "extraction_fields",
  "extractions",
  "documents",
  "memberships",
  "tenants",
  "eval_runs",
  "fx_rates",
] as const;

export async function resetDemoData(handle: DatabaseHandle): Promise<void> {
  await handle.exec(`truncate table ${TRUNCATE_ORDER.map((name) => `"${name}"`).join(", ")} cascade`);
}

function toOpenInvoice(tenant: DemoTenant): OpenInvoice[] {
  return tenant.invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    vendorId: invoice.vendorId,
    currency: invoice.currency,
    openBalance: money(invoice.totalMinor, invoice.currency),
    dueDate: invoice.dueDate,
    issueDate: invoice.issueDate,
  }));
}

function toIncomingPayment(tenant: DemoTenant): IncomingPayment[] {
  return tenant.payments.map((payment) => ({
    id: payment.id,
    reference: payment.reference,
    currency: payment.currency,
    amount: money(payment.amountMinor, payment.currency),
    paidAt: payment.paidAt,
    ...(payment.vendorId ? { vendorId: payment.vendorId } : {}),
  }));
}

async function seedTenant(
  handle: DatabaseHandle,
  tenant: DemoTenant,
  ledgerCursor: { entries: LedgerEntry[] },
): Promise<Omit<SeedResult, "skippedTenants" | "tenants">> {
  const openInvoices = toOpenInvoice(tenant);
  const incomingPayments = toIncomingPayment(tenant);
  const reconciliation = reconcile(openInvoices, incomingPayments);

  const openById = new Map(
    reconciliation.remainingInvoices.map((invoice) => [invoice.id, invoice.openBalance.amount]),
  );

  await runAsTenant(handle, tenant.id, async (db) => {
    await db.insert(schema.tenants).values({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
    });

    await db.insert(schema.memberships).values([
      { tenantId: tenant.id, userId: `demo-owner-${tenant.slug}`, role: "controller" },
      { tenantId: tenant.id, userId: `demo-manager-${tenant.slug}`, role: "finance_manager" },
      { tenantId: tenant.id, userId: `demo-analyst-${tenant.slug}`, role: "analyst" },
    ]);

    await db.insert(schema.documents).values(
      tenant.documents.map((document) => ({
        id: document.id,
        tenantId: tenant.id,
        kind: document.kind,
        filename: document.filename,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
        storageKey: document.storageKey,
        pageCount: document.pageCount,
        status: "processed",
        uploadedBy: document.uploadedBy,
        searchText: document.searchText,
        createdAt: SEED_TIMESTAMP,
      })),
    );

    const invoiceRows = tenant.invoices.map((invoice) => {
      const open = openById.get(invoice.id) ?? invoice.totalMinor;
      return {
        id: invoice.id,
        tenantId: tenant.id,
        vendorId: invoice.vendorId,
        vendorName: invoice.vendorName,
        number: invoice.number,
        normalizedNumber: normalizeInvoiceNumber(invoice.number),
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotalMinor: invoice.subtotalMinor,
        taxMinor: invoice.taxMinor,
        totalMinor: invoice.totalMinor,
        openMinor: open,
        status: open === 0 ? "paid" : open === invoice.totalMinor ? "open" : "partial",
        sourceDocumentId: invoice.sourceDocumentId,
        createdAt: SEED_TIMESTAMP,
      };
    });
    await db.insert(schema.invoices).values(invoiceRows);

    const lineRows = tenant.invoices.flatMap((invoice) =>
      invoice.lines.map((line, index) => ({
        tenantId: tenant.id,
        invoiceId: invoice.id,
        lineNo: index + 1,
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBp: line.taxRateBp,
        taxMinor: line.taxMinor,
        totalMinor: line.totalMinor,
        accountCode: line.accountCode,
      })),
    );
    if (lineRows.length > 0) await db.insert(schema.invoiceLines).values(lineRows);

    await db.insert(schema.payments).values(
      tenant.payments.map((payment) => ({
        id: payment.id,
        tenantId: tenant.id,
        reference: payment.reference,
        vendorId: payment.vendorId,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        paidAt: payment.paidAt,
        method: payment.method,
        fingerprint: paymentFingerprint({
          id: payment.id,
          reference: payment.reference,
          currency: payment.currency,
          amount: money(payment.amountMinor, payment.currency),
          paidAt: payment.paidAt,
          ...(payment.vendorId ? { vendorId: payment.vendorId } : {}),
        }),
        createdAt: SEED_TIMESTAMP,
      })),
    );

    if (reconciliation.allocations.length > 0) {
      await db.insert(schema.paymentAllocations).values(
        reconciliation.allocations.map((allocation) => ({
          tenantId: tenant.id,
          paymentId: allocation.paymentId,
          invoiceId: allocation.invoiceId,
          amountMinor: allocation.amount.amount,
          currency: allocation.amount.currency,
          strategy: allocation.strategy,
          confidenceBp: Math.round(allocation.confidence * 10_000),
          createdAt: SEED_TIMESTAMP,
        })),
      );
    }

    if (reconciliation.discrepancies.length > 0) {
      await db.insert(schema.discrepancies).values(
        reconciliation.discrepancies.map((discrepancy) => ({
          tenantId: tenant.id,
          kind: discrepancy.kind,
          severity: discrepancy.severity,
          invoiceId: discrepancy.invoiceId ?? null,
          paymentId: discrepancy.paymentId ?? null,
          amountMinor: discrepancy.amount?.amount ?? null,
          currency: discrepancy.amount?.currency ?? null,
          detail: discrepancy.detail,
          status: "open",
          createdAt: SEED_TIMESTAMP,
        })),
      );
    }

    // Seed a small audit chain so the verification command has something real.
    const actions: { action: string; payload: unknown }[] = [
      {
        action: "invoice.imported",
        payload: { count: tenant.invoices.length, source: "demo-seed" },
      },
      ...(reconciliation.allocations[0]
        ? [
            {
              action: "payment.matched",
              payload: {
                paymentId: reconciliation.allocations[0].paymentId,
                invoiceId: reconciliation.allocations[0].invoiceId,
                amountMinor: reconciliation.allocations[0].amount.amount,
                strategy: reconciliation.allocations[0].strategy,
              },
            },
          ]
        : []),
      ...(reconciliation.discrepancies[0]
        ? [
            {
              action: "discrepancy.detected",
              payload: {
                kind: reconciliation.discrepancies[0].kind,
                detail: reconciliation.discrepancies[0].detail,
              },
            },
          ]
        : []),
    ];

    for (const item of actions) {
      const entry = appendLedgerEntry(ledgerCursor.entries, {
        tenantId: tenant.id,
        actorId: "system",
        action: item.action,
        payload: item.payload,
        createdAt: SEED_TIMESTAMP,
      });
      ledgerCursor.entries = [...ledgerCursor.entries, entry];
      await db.insert(schema.actionLedger).values({
        tenantId: tenant.id,
        seq: entry.seq,
        prevHash: entry.prevHash,
        entryHash: entry.entryHash,
        action: entry.action,
        actorId: entry.actorId,
        payload: item.payload,
        createdAt: entry.createdAt,
      });
    }

    await db.insert(schema.agentRuns).values([
      {
        tenantId: tenant.id,
        workflow: "ingest.extract",
        status: "completed",
        mode: "heuristic",
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        traceId: `demo-${tenant.slug}-1`,
        startedAt: SEED_TIMESTAMP,
        finishedAt: SEED_TIMESTAMP,
      },
      {
        tenantId: tenant.id,
        workflow: "reconcile.batch",
        status: "completed",
        mode: "heuristic",
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        traceId: `demo-${tenant.slug}-2`,
        startedAt: SEED_TIMESTAMP,
        finishedAt: SEED_TIMESTAMP,
      },
    ]);
  });

  return {
    invoices: tenant.invoices.length,
    payments: tenant.payments.length,
    allocations: reconciliation.allocations.length,
    discrepancies: reconciliation.discrepancies.length,
  };
}

export async function seed(
  handle: DatabaseHandle,
  options: SeedOptions = {},
): Promise<SeedResult> {
  if (options.migrate ?? true) {
    await runMigrations(handle, { silent: options.silent });
  }
  if (options.reset) {
    await resetDemoData(handle);
  }

  const tenants = generateDemoData();
  const result = {
    tenants: 0,
    invoices: 0,
    payments: 0,
    allocations: 0,
    discrepancies: 0,
    skippedTenants: [] as string[],
  };

  for (const tenant of tenants) {
    const alreadyExists = await runAsTenant(handle, tenant.id, async (db) => {
      const rows = await db
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenant.id))
        .limit(1);
      return rows.length > 0;
    });
    if (alreadyExists) {
      result.skippedTenants.push(tenant.slug);
      if (!options.silent) console.log(`  skipped ${tenant.slug} (already seeded)`);
      continue;
    }

    const counts = await seedTenant(handle, tenant, { entries: [] });
    result.tenants += 1;
    result.invoices += counts.invoices;
    result.payments += counts.payments;
    result.allocations += counts.allocations;
    result.discrepancies += counts.discrepancies;
    if (!options.silent) {
      console.log(
        `  seeded ${tenant.slug}: ${counts.invoices} invoices, ${counts.payments} payments, ` +
          `${counts.allocations} allocations, ${counts.discrepancies} discrepancies`,
      );
    }
  }

  // Global FX rates (not tenant-scoped, pegged/indicative for the demo).
  await handle.exec(`
    insert into fx_rates (base, quote, rate, as_of, source) values
      ('USD', 'EUR', '0.9200', '2026-02-01', 'demo'),
      ('USD', 'EUR', '0.9500', '2026-06-01', 'demo'),
      ('USD', 'MXN', '17.1500', '2026-02-01', 'demo'),
      ('USD', 'PAB', '1.0000', '2026-02-01', 'demo')
    on conflict (base, quote, as_of) do nothing;
  `);

  return result;
}

const isMain =
  process.argv[1] !== undefined && process.argv[1].endsWith("seed.ts");

if (isMain) {
  const handle = await createDatabase();
  const reset = process.argv.includes("--reset");
  try {
    console.log(`Seeding demo data (${handle.driver})${reset ? " with reset" : ""}...`);
    const result = await seed(handle, { reset });
    console.log(
      `Done. ${result.tenants} tenants, ${result.invoices} invoices, ${result.payments} payments, ` +
        `${result.allocations} allocations, ${result.discrepancies} discrepancies.`,
    );
    if (result.skippedTenants.length > 0) {
      console.log(`Re-run with --reset to rebuild: ${result.skippedTenants.join(", ")}`);
    }
  } finally {
    await handle.close();
  }
}
