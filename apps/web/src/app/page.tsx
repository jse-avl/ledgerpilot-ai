import Link from "next/link";
import { AgingChart } from "@/components/AgingChart";
import { KindChip, StatusChip } from "@/components/Chips";
import { KpiCard } from "@/components/KpiCard";
import { formatDate, formatMinor, shortHash } from "@/lib/format";
import { currentLocale, translator } from "@/lib/i18n";
import { loadOverview, type CurrencyTotal } from "@/lib/queries";
import { currentWorkspace } from "@/lib/workspace";

function totalsLabel(
  totals: readonly CurrencyTotal[],
  locale: "en" | "es",
  fallbackCurrency: string,
): string {
  if (totals.length === 0) return formatMinor(0, fallbackCurrency, locale);
  return totals.map((total) => formatMinor(total.amountMinor, total.currency, locale)).join(" + ");
}

export default async function OverviewPage() {
  const [locale, workspace] = await Promise.all([currentLocale(), currentWorkspace()]);
  const data = await loadOverview(workspace);
  const t = translator(locale);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("overview.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("overview.subtitle", { workspace: workspace.name })}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t("overview.openAp")}
          value={totalsLabel(data.openTotals, locale, workspace.currency)}
          hint={t("overview.openApHint", { count: data.counts.openInvoices })}
          href="/invoices"
          tone="slate"
        />
        <KpiCard
          label={t("overview.overdue")}
          value={
            data.counts.overdueInvoices === 0
              ? t("overview.nothingOverdue")
              : totalsLabel(data.overdueTotals, locale, workspace.currency)
          }
          hint={
            data.counts.overdueInvoices === 0
              ? t("overview.agingHint")
              : t("overview.overdueHint", { count: data.counts.overdueInvoices })
          }
          href="/invoices"
          tone={data.counts.overdueInvoices === 0 ? "emerald" : "rose"}
        />
        <KpiCard
          label={t("overview.exceptions")}
          value={data.counts.openDiscrepancies}
          hint={t("overview.exceptionsHint")}
          href="/discrepancies"
          tone={data.counts.openDiscrepancies === 0 ? "emerald" : "amber"}
        />
        <KpiCard
          label={t("overview.proposals")}
          value={data.counts.pendingProposals}
          hint={t("overview.proposalsHint")}
          href="/proposals"
          tone="slate"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-1">
          <div className="card-header">
            <div>
              <h2 className="card-title">{t("overview.aging")}</h2>
              <p className="card-subtitle">{t("overview.agingHint")}</p>
            </div>
            <span className="chip chip-slate">{workspace.currency}</span>
          </div>
          <div className="card-body">
            <AgingChart rows={data.aging} locale={locale} />
          </div>
        </section>

        <section className="card lg:col-span-2">
          <div className="card-header">
            <div>
              <h2 className="card-title">{t("overview.recent")}</h2>
              <p className="card-subtitle">{t("overview.recentHint")}</p>
            </div>
            <Link href="/invoices" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800">
              {t("common.viewAll")} →
            </Link>
          </div>
          {data.recentInvoices.length === 0 ? (
            <p className="card-body text-sm text-slate-500">{t("invoices.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("common.invoice")}</th>
                    <th>{t("common.vendor")}</th>
                    <th>{t("common.due")}</th>
                    <th className="text-right">{t("invoices.openBalance")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <Link
                          href={`/invoices/${encodeURIComponent(invoice.number)}`}
                          className="font-mono text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                          {invoice.number}
                        </Link>
                      </td>
                      <td className="max-w-48 truncate">{invoice.vendorName}</td>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDate(invoice.dueDate, locale)}
                      </td>
                      <td className="num">{formatMinor(invoice.openMinor, invoice.currency, locale)}</td>
                      <td>
                        <StatusChip status={invoice.status} locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="card-header">
            <div>
              <h2 className="card-title">{t("overview.exceptionsTitle")}</h2>
              <p className="card-subtitle">{t("overview.exceptionsHint")}</p>
            </div>
            <Link
              href="/discrepancies"
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              {t("common.viewAll")} →
            </Link>
          </div>
          {data.exceptions.length === 0 ? (
            <p className="card-body text-sm text-slate-500">{t("overview.noExceptions")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.exceptions.map((issue) => (
                <li key={issue.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <KindChip kind={issue.kind} locale={locale} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700">{issue.detail}</p>
                    {issue.invoiceNumber ? (
                      <Link
                        href={`/invoices/${encodeURIComponent(issue.invoiceNumber)}`}
                        className="mt-0.5 inline-block font-mono text-[11px] text-emerald-700 hover:text-emerald-800"
                      >
                        {issue.invoiceNumber}
                      </Link>
                    ) : null}
                  </div>
                  {issue.amountMinor !== null ? (
                    <span className="num text-xs text-slate-500">
                      {formatMinor(issue.amountMinor, issue.currency ?? workspace.currency, locale)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">{t("overview.ledger")}</h2>
              <p className="card-subtitle">{t("overview.ledgerHint")}</p>
            </div>
          </div>
          <div className="card-body space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {t("overview.ledgerEntries", { count: data.ledger.entries })}
              </span>
              <span className={`chip ${data.ledger.verified ? "chip-emerald" : "chip-rose"}`}>
                {data.ledger.verified ? t("overview.ledgerVerified") : t("overview.ledgerBroken")}
              </span>
            </div>
            <div>
              <p className="label">{t("overview.ledgerHead")}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                {shortHash(data.ledger.head, 24)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
              <div>
                <p className="text-lg font-semibold">{data.counts.documents}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  {t("common.docs")}
                </p>
              </div>
              <div>
                <p className="text-lg font-semibold">{data.counts.invoices}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  {t("common.invoicesCount")}
                </p>
              </div>
              <div>
                <p className="text-lg font-semibold">{data.counts.payments}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  {t("common.payments")}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
