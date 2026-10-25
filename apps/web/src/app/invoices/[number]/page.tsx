import Link from "next/link";
import { notFound } from "next/navigation";
import { KindChip, SeverityChip, StatusChip } from "@/components/Chips";
import { formatDate, formatMinor, formatQuantity, shortHash } from "@/lib/format";
import { currentLocale, translator } from "@/lib/i18n";
import { loadInvoice } from "@/lib/queries";
import { currentWorkspace } from "@/lib/workspace";

export default async function InvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const [locale, workspace] = await Promise.all([currentLocale(), currentWorkspace()]);
  const t = translator(locale);
  const detail = await loadInvoice(workspace, decodeURIComponent(number));
  if (!detail) notFound();

  const { invoice, lines, allocations, issues, document } = detail;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/invoices"
          className="text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          ← {t("invoice.back")}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-900">
              {invoice.number}
            </h1>
            <StatusChip status={invoice.status} locale={locale} />
          </div>
          <p className="mt-1 text-sm text-slate-600">{invoice.vendorName}</p>
          <p className="mt-1 text-xs text-slate-400">
            {t("invoice.issueDate")}: {formatDate(invoice.issueDate, locale)} · {t("invoice.dueDate")}:{" "}
            {formatDate(invoice.dueDate, locale)}
          </p>
        </div>
        <div className="card min-w-64 p-4">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-8">
              <dt className="text-slate-500">{t("invoice.subtotal")}</dt>
              <dd className="num">{formatMinor(invoice.subtotalMinor, invoice.currency, locale)}</dd>
            </div>
            <div className="flex justify-between gap-8">
              <dt className="text-slate-500">{t("invoice.tax")}</dt>
              <dd className="num">{formatMinor(invoice.taxMinor, invoice.currency, locale)}</dd>
            </div>
            <div className="flex justify-between gap-8 border-t border-slate-100 pt-2 font-semibold">
              <dt>{t("invoice.total")}</dt>
              <dd className="num">{formatMinor(invoice.totalMinor, invoice.currency, locale)}</dd>
            </div>
            <div className="flex justify-between gap-8 text-emerald-700">
              <dt>{t("invoices.openBalance")}</dt>
              <dd className="num font-semibold">
                {formatMinor(invoice.openMinor, invoice.currency, locale)}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">{t("invoice.lines")}</h2>
          <span className="chip chip-slate">{invoice.currency}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>{t("invoice.description")}</th>
                <th className="text-right">{t("invoice.quantity")}</th>
                <th className="text-right">{t("invoice.unitPrice")}</th>
                <th className="text-right">{t("invoice.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.lineNo}>
                  <td className="text-xs text-slate-400">{line.lineNo}</td>
                  <td>
                    <span className="text-slate-800">{line.description}</span>
                    {line.accountCode ? (
                      <span className="ml-2 font-mono text-[10px] text-slate-400">
                        {line.accountCode}
                      </span>
                    ) : null}
                  </td>
                  <td className="num text-slate-500">{formatQuantity(line.quantityMilli, locale)}</td>
                  <td className="num text-slate-500">
                    {formatMinor(line.unitPriceMinor, invoice.currency, locale)}
                  </td>
                  <td className="num">{formatMinor(line.totalMinor, invoice.currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t("invoice.allocations")}</h2>
            <span className="chip chip-slate">{allocations.length}</span>
          </div>
          {allocations.length === 0 ? (
            <p className="card-body text-sm text-slate-500">{t("invoice.noAllocations")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("invoice.reference")}</th>
                    <th>{t("invoice.paidAt")}</th>
                    <th className="text-right">{t("common.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((allocation) => (
                    <tr key={`${allocation.paymentId}-${allocation.amountMinor}`}>
                      <td className="font-mono text-xs">{allocation.reference}</td>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDate(allocation.paidAt, locale)}
                      </td>
                      <td className="num">
                        {formatMinor(allocation.amountMinor, allocation.currency, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t("invoice.issues")}</h2>
            <span className="chip chip-slate">{issues.length}</span>
          </div>
          {issues.length === 0 ? (
            <p className="card-body text-sm text-slate-500">{t("invoice.noIssues")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {issues.map((issue) => (
                <li key={issue.id} className="space-y-1 px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityChip severity={issue.severity} locale={locale} />
                    <KindChip kind={issue.kind} locale={locale} />
                    <StatusChip status={issue.status} locale={locale} />
                  </div>
                  <p className="text-sm text-slate-700">{issue.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">{t("invoice.source")}</h2>
            <p className="card-subtitle">{t("invoice.sourceHint")}</p>
          </div>
        </div>
        {document ? (
          <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="label">Filename</dt>
              <dd className="mt-1 break-all font-mono text-xs text-slate-700">{document.filename}</dd>
            </div>
            <div>
              <dt className="label">SHA-256</dt>
              <dd className="mt-1 break-all font-mono text-xs text-slate-500">
                {shortHash(document.sha256, 20)}
              </dd>
            </div>
            <div>
              <dt className="label">ID</dt>
              <dd className="mt-1 break-all font-mono text-xs text-slate-500">{document.id}</dd>
            </div>
          </dl>
        ) : (
          <p className="card-body text-sm text-slate-500">{t("common.none")}</p>
        )}
      </section>
    </div>
  );
}
