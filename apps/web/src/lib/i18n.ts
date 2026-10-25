import { cookies } from "next/headers";

/**
 * Bilingual copy. Code and comments are English; everything a user reads is
 * translated, including dates and money. Adding a key to `en` makes the Spanish
 * file fail to typecheck until it is translated too.
 */

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const LANG_COOKIE = "lp_lang";

const en = {
  "app.name": "LedgerPilot",
  "app.tagline": "Accounts payable, under control",

  "nav.overview": "Overview",
  "nav.invoices": "Invoices",
  "nav.discrepancies": "Exceptions",
  "nav.proposals": "Proposals",
  "nav.assistant": "Assistant",

  "common.workspace": "Workspace",
  "common.switchWorkspace": "Switch workspace",
  "common.language": "Language",
  "common.asOf": "As of {date}",
  "common.viewAll": "View all",
  "common.view": "View",
  "common.back": "Back",
  "common.none": "None",
  "common.total": "Total",
  "common.open": "Open",
  "common.status": "Status",
  "common.vendor": "Vendor",
  "common.invoice": "Invoice",
  "common.due": "Due",
  "common.amount": "Amount",
  "common.currency": "Currency",
  "common.search": "Search",
  "common.searchPlaceholder": "Invoice number, vendor or document text…",
  "common.all": "All",
  "common.results": "{count} result(s)",
  "common.noResults": "Nothing matches this search.",
  "common.notFound": "Not found",
  "common.docs": "documents",
  "common.payments": "payments",
  "common.invoicesCount": "invoices",
  "common.refresh": "Refresh",

  "capability.heuristic": "Heuristic mode",
  "capability.local": "Local models",
  "capability.cloud": "Cloud models",
  "capability.heuristicHint":
    "No AI key and no local runtime. Heuristics, SQL and deterministic rules are doing the work.",
  "capability.localHint": "Ollama is running; text work is handled by a local model.",
  "capability.cloudHint": "A cloud key is configured; model-backed features are enabled.",
  "capability.details": "Capability report",

  "overview.title": "Overview",
  "overview.subtitle": "What needs attention in {workspace} today.",
  "overview.openAp": "Open payables",
  "overview.openApHint": "{count} invoices awaiting payment",
  "overview.overdue": "Overdue",
  "overview.overdueHint": "{count} past due",
  "overview.nothingOverdue": "Nothing is past due",
  "overview.exceptions": "Open exceptions",
  "overview.exceptionsHint": "Duplicates, mismatches and unmatched payments",
  "overview.proposals": "Pending proposals",
  "overview.proposalsHint": "Created by the agent, waiting for a human",
  "overview.aging": "Aging",
  "overview.agingHint": "Open balance by days past due, per currency",
  "overview.recent": "Invoices needing attention",
  "overview.recentHint": "Open, and sorted by due date",
  "overview.exceptionsTitle": "Latest exceptions",
  "overview.noExceptions": "No open exceptions. The ledger reconciles.",
  "overview.noOpenInvoices": "No open invoices to age.",
  "overview.ledger": "Audit ledger",
  "overview.ledgerEntries": "{count} entries",
  "overview.ledgerHead": "Head hash",
  "overview.ledgerVerified": "Chain verified",
  "overview.ledgerBroken": "Chain broken",
  "overview.ledgerHint": "Every action is appended; nothing is edited in place.",

  "invoices.title": "Invoices",
  "invoices.subtitle": "Every payable in this workspace, with its source document.",
  "invoices.number": "Number",
  "invoices.issueDate": "Issued",
  "invoices.openBalance": "Open balance",
  "invoices.empty": "No invoices yet. Run `pnpm db:seed` to load the demo data.",
  "invoices.filterAll": "All statuses",
  "invoices.filterOpen": "Open only",

  "invoice.back": "Back to invoices",
  "invoice.lines": "Line items",
  "invoice.description": "Description",
  "invoice.quantity": "Qty",
  "invoice.unitPrice": "Unit price",
  "invoice.lineTotal": "Line total",
  "invoice.allocations": "Payments applied",
  "invoice.reference": "Reference",
  "invoice.paidAt": "Paid",
  "invoice.strategy": "Match",
  "invoice.noAllocations": "No payment has been applied to this invoice.",
  "invoice.source": "Source document",
  "invoice.sourceHint": "Extraction evidence lives with the uploaded file.",
  "invoice.issues": "Exceptions on this invoice",
  "invoice.noIssues": "No exceptions recorded for this invoice.",
  "invoice.subtotal": "Subtotal",
  "invoice.tax": "Tax",
  "invoice.total": "Total",
  "invoice.issueDate": "Issue date",
  "invoice.dueDate": "Due date",

  "discrepancies.title": "Exceptions",
  "discrepancies.subtitle": "Reconciliation findings that need a human decision.",
  "discrepancies.kind": "Kind",
  "discrepancies.severity": "Severity",
  "discrepancies.detail": "Detail",
  "discrepancies.related": "Related record",
  "discrepancies.empty": "No exceptions in this view.",
  "discrepancies.openOnly": "Open",
  "discrepancies.allStatuses": "All",

  "kind.duplicate_invoice": "Duplicate invoice",
  "kind.duplicate_payment": "Duplicate payment",
  "kind.unmatched_payment": "Unmatched payment",
  "kind.partial_payment": "Partial payment",
  "kind.overpayment": "Overpayment",
  "kind.amount_mismatch": "Amount mismatch",
  "kind.currency_mismatch": "Currency mismatch",
  "kind.unknown": "Other",

  "severity.error": "High",
  "severity.warning": "Medium",
  "severity.info": "Low",

  "status.open": "Open",
  "status.partially_paid": "Partially paid",
  "status.paid": "Paid",
  "status.draft": "Draft",
  "status.void": "Void",
  "status.resolved": "Resolved",
  "status.ignored": "Ignored",
  "status.pending_approval": "Pending approval",
  "status.approved": "Approved",
  "status.rejected": "Rejected",
  "status.executed": "Executed",
  "status.expired": "Expired",

  "proposals.title": "Proposals",
  "proposals.subtitle":
    "The agent can only propose. A person approves, and execution is a separate audited step.",
  "proposals.empty": "No proposals yet. Ask the assistant or call the MCP tool to create one.",
  "proposals.current": "Pending approval ({count})",
  "proposals.summary": "Summary",
  "proposals.hash": "Payload hash",
  "proposals.nonce": "Nonce",
  "proposals.expires": "Expires",
  "proposals.proposedBy": "Proposed by",
  "proposals.notExecuted": "Not executed",
  "proposals.notExecutedHint":
    "A proposal is a request. Nothing has moved money, and nothing will until a human approves it.",
  "proposals.approval": "Approval required",
  "proposals.requiredRoles": "Required roles: {roles}",
  "proposals.approvers": "{count} approver(s)",
  "proposals.excluded": "The proposer cannot approve their own request.",
  "proposals.history": "Recent decisions",

  "assistant.title": "Assistant",
  "assistant.subtitle":
    "Answers grounded in this workspace. When the data does not contain an answer, it says so.",
  "assistant.placeholder": "Which invoices are overdue?",
  "assistant.ask": "Ask",
  "assistant.suggestions": "Try one of these",
  "assistant.suggestion1": "Which invoices are overdue?",
  "assistant.suggestion2": "Show me invoice INV-2026-1000",
  "assistant.suggestion3": "Are there duplicate payments?",
  "assistant.answerMode": "Answer mode",
  "assistant.citations": "Sources",
  "assistant.grounded": "Grounded in workspace data",
  "assistant.notGrounded": "Could not ground this answer",
  "assistant.empty": "Ask a question about invoices, overdue balances or exceptions.",
  "assistant.disclaimer":
    "This demo answers from SQL and deterministic rules. Add a cloud key or run Ollama to let a model write the prose; the numbers stay computed.",

  "footer.built": "Deterministic core, optional models.",
  "footer.note": "Demo data. No real money moves.",
  "footer.docs": "Docs",
} as const;

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const es: Dictionary = {
  "app.name": "LedgerPilot",
  "app.tagline": "Cuentas por pagar, bajo control",

  "nav.overview": "Resumen",
  "nav.invoices": "Facturas",
  "nav.discrepancies": "Excepciones",
  "nav.proposals": "Propuestas",
  "nav.assistant": "Asistente",

  "common.workspace": "Espacio de trabajo",
  "common.switchWorkspace": "Cambiar espacio",
  "common.language": "Idioma",
  "common.asOf": "Al {date}",
  "common.viewAll": "Ver todo",
  "common.view": "Ver",
  "common.back": "Volver",
  "common.none": "Ninguna",
  "common.total": "Total",
  "common.open": "Pendiente",
  "common.status": "Estado",
  "common.vendor": "Proveedor",
  "common.invoice": "Factura",
  "common.due": "Vence",
  "common.amount": "Importe",
  "common.currency": "Moneda",
  "common.search": "Buscar",
  "common.searchPlaceholder": "Número de factura, proveedor o texto del documento…",
  "common.all": "Todo",
  "common.results": "{count} resultado(s)",
  "common.noResults": "Nada coincide con esta búsqueda.",
  "common.notFound": "No encontrado",
  "common.docs": "documentos",
  "common.payments": "pagos",
  "common.invoicesCount": "facturas",
  "common.refresh": "Actualizar",

  "capability.heuristic": "Modo heurístico",
  "capability.local": "Modelos locales",
  "capability.cloud": "Modelos en la nube",
  "capability.heuristicHint":
    "Sin clave de IA y sin runtime local. Trabajan las heurísticas, SQL y reglas deterministas.",
  "capability.localHint": "Ollama está en marcha; el texto lo procesa un modelo local.",
  "capability.cloudHint": "Hay una clave en la nube configurada; las funciones con modelo están activas.",
  "capability.details": "Informe de capacidades",

  "overview.title": "Resumen",
  "overview.subtitle": "Lo que requiere atención hoy en {workspace}.",
  "overview.openAp": "Por pagar",
  "overview.openApHint": "{count} facturas pendientes de pago",
  "overview.overdue": "Vencido",
  "overview.overdueHint": "{count} fuera de plazo",
  "overview.nothingOverdue": "Nada está vencido",
  "overview.exceptions": "Excepciones abiertas",
  "overview.exceptionsHint": "Duplicados, diferencias y pagos sin conciliar",
  "overview.proposals": "Propuestas pendientes",
  "overview.proposalsHint": "Creadas por el agente, esperando a una persona",
  "overview.aging": "Antigüedad",
  "overview.agingHint": "Saldo pendiente por días de atraso y moneda",
  "overview.recent": "Facturas que requieren atención",
  "overview.recentHint": "Abiertas, ordenadas por vencimiento",
  "overview.exceptionsTitle": "Últimas excepciones",
  "overview.noExceptions": "No hay excepciones abiertas. El libro concilia.",
  "overview.noOpenInvoices": "No hay facturas abiertas para analizar antigüedad.",
  "overview.ledger": "Libro de auditoría",
  "overview.ledgerEntries": "{count} entradas",
  "overview.ledgerHead": "Hash de cabeza",
  "overview.ledgerVerified": "Cadena verificada",
  "overview.ledgerBroken": "Cadena rota",
  "overview.ledgerHint": "Cada acción se añade; nada se edita en su lugar.",

  "invoices.title": "Facturas",
  "invoices.subtitle": "Todas las cuentas por pagar del espacio, con su documento de origen.",
  "invoices.number": "Número",
  "invoices.issueDate": "Emitida",
  "invoices.openBalance": "Saldo pendiente",
  "invoices.empty": "Aún no hay facturas. Ejecuta `pnpm db:seed` para cargar los datos de demo.",
  "invoices.filterAll": "Todos los estados",
  "invoices.filterOpen": "Solo abiertas",

  "invoice.back": "Volver a facturas",
  "invoice.lines": "Líneas",
  "invoice.description": "Descripción",
  "invoice.quantity": "Cant.",
  "invoice.unitPrice": "Precio unitario",
  "invoice.lineTotal": "Total línea",
  "invoice.allocations": "Pagos aplicados",
  "invoice.reference": "Referencia",
  "invoice.paidAt": "Pagado",
  "invoice.strategy": "Coincidencia",
  "invoice.noAllocations": "Ningún pago se ha aplicado a esta factura.",
  "invoice.source": "Documento de origen",
  "invoice.sourceHint": "La evidencia de extracción vive junto al archivo subido.",
  "invoice.issues": "Excepciones de esta factura",
  "invoice.noIssues": "No hay excepciones registradas para esta factura.",
  "invoice.subtotal": "Subtotal",
  "invoice.tax": "Impuesto",
  "invoice.total": "Total",
  "invoice.issueDate": "Fecha de emisión",
  "invoice.dueDate": "Fecha de vencimiento",

  "discrepancies.title": "Excepciones",
  "discrepancies.subtitle": "Hallazgos de conciliación que necesitan una decisión humana.",
  "discrepancies.kind": "Tipo",
  "discrepancies.severity": "Severidad",
  "discrepancies.detail": "Detalle",
  "discrepancies.related": "Registro relacionado",
  "discrepancies.empty": "No hay excepciones en esta vista.",
  "discrepancies.openOnly": "Abiertas",
  "discrepancies.allStatuses": "Todas",

  "kind.duplicate_invoice": "Factura duplicada",
  "kind.duplicate_payment": "Pago duplicado",
  "kind.unmatched_payment": "Pago sin conciliar",
  "kind.partial_payment": "Pago parcial",
  "kind.overpayment": "Sobrepago",
  "kind.amount_mismatch": "Diferencia de importe",
  "kind.currency_mismatch": "Diferencia de moneda",
  "kind.unknown": "Otra",

  "severity.error": "Alta",
  "severity.warning": "Media",
  "severity.info": "Baja",

  "status.open": "Abierta",
  "status.partially_paid": "Pago parcial",
  "status.paid": "Pagada",
  "status.draft": "Borrador",
  "status.void": "Anulada",
  "status.resolved": "Resuelta",
  "status.ignored": "Ignorada",
  "status.pending_approval": "Pendiente de aprobación",
  "status.approved": "Aprobada",
  "status.rejected": "Rechazada",
  "status.executed": "Ejecutada",
  "status.expired": "Caducada",

  "proposals.title": "Propuestas",
  "proposals.subtitle":
    "El agente solo puede proponer. Una persona aprueba y la ejecución es un paso auditado aparte.",
  "proposals.empty":
    "Aún no hay propuestas. Pregunta al asistente o llama a la herramienta MCP para crear una.",
  "proposals.current": "Pendientes de aprobación ({count})",
  "proposals.summary": "Resumen",
  "proposals.hash": "Hash del contenido",
  "proposals.nonce": "Nonce",
  "proposals.expires": "Caduca",
  "proposals.proposedBy": "Propuesta por",
  "proposals.notExecuted": "No ejecutada",
  "proposals.notExecutedHint":
    "Una propuesta es una solicitud. No ha movido dinero y no lo hará hasta que una persona la apruebe.",
  "proposals.approval": "Aprobación requerida",
  "proposals.requiredRoles": "Roles requeridos: {roles}",
  "proposals.approvers": "{count} aprobador(es)",
  "proposals.excluded": "Quien propone no puede aprobar su propia solicitud.",
  "proposals.history": "Decisiones recientes",

  "assistant.title": "Asistente",
  "assistant.subtitle":
    "Respuestas respaldadas por este espacio. Cuando el dato no está, lo dice.",
  "assistant.placeholder": "¿Qué facturas están vencidas?",
  "assistant.ask": "Preguntar",
  "assistant.suggestions": "Prueba con una de estas",
  "assistant.suggestion1": "¿Qué facturas están vencidas?",
  "assistant.suggestion2": "Muéstrame la factura INV-2026-1000",
  "assistant.suggestion3": "¿Hay pagos duplicados?",
  "assistant.answerMode": "Modo de respuesta",
  "assistant.citations": "Fuentes",
  "assistant.grounded": "Respaldada por los datos del espacio",
  "assistant.notGrounded": "No se pudo respaldar esta respuesta",
  "assistant.empty": "Pregunta por facturas, saldos vencidos o excepciones.",
  "assistant.disclaimer":
    "Esta demo responde con SQL y reglas deterministas. Añade una clave en la nube o ejecuta Ollama para que un modelo redacte; los números se siguen calculando.",

  "footer.built": "Núcleo determinista, modelos opcionales.",
  "footer.note": "Datos de demo. No se mueve dinero real.",
  "footer.docs": "Documentación",
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, es };

export function normalizeLocale(value: string | undefined | null): Locale {
  return value === "es" || value?.startsWith("es-") ? "es" : "en";
}

export function intlLocale(locale: Locale): string {
  return locale === "es" ? "es-ES" : "en-US";
}

export async function currentLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LANG_COOKIE)?.value);
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale];
  return (key, values) => {
    const template = dictionary[key] ?? en[key] ?? key;
    if (!values) return template;
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template,
    );
  };
}

/** Statuses are stored in English in the database; translate for display. */
export function statusKey(status: string): MessageKey {
  const known: Record<string, MessageKey> = {
    open: "status.open",
    partially_paid: "status.partially_paid",
    paid: "status.paid",
    draft: "status.draft",
    void: "status.void",
    resolved: "status.resolved",
    ignored: "status.ignored",
    pending_approval: "status.pending_approval",
    approved: "status.approved",
    rejected: "status.rejected",
    executed: "status.executed",
    expired: "status.expired",
  };
  return known[status] ?? "status.open";
}

export function kindKey(kind: string): MessageKey {
  const known: Record<string, MessageKey> = {
    duplicate_invoice: "kind.duplicate_invoice",
    duplicate_payment: "kind.duplicate_payment",
    unmatched_payment: "kind.unmatched_payment",
    partial_payment: "kind.partial_payment",
    overpayment: "kind.overpayment",
    amount_mismatch: "kind.amount_mismatch",
    currency_mismatch: "kind.currency_mismatch",
  };
  return known[kind] ?? "kind.unknown";
}
