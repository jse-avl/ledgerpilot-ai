import Link from "next/link";
import { KindChip, SeverityChip, StatusChip } from "@/components/Chips";
import { formatDate, formatMinor } from "@/lib/format";
import { currentLocale, translator } from "@/lib/i18n";
import { listDiscrepancies } from "@/lib/queries";
import { currentWorkspace } from "@/lib/workspace";

export default async function DiscrepanciesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const showAll = raw === "all";

  const [locale, workspace] = await Promise.all([currentLocale(), currentWorkspace()]);
  const t = translator(locale);
  const rows = await listDiscrepancies(workspace, showAll ? "all" : "open");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("discrepancies.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("discrepancies.subtitle")}</p>
      </header>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <Link
              href="/discrepancies"
              className={`rounded-md px-2.5 py-1.5 ${
                showAll ? "text-slate-500 hover:text-slate-900" : "bg-white text-slate-900 shadow-xs"
              }`}
            >
              {t("discrepancies.openOnly")}
            </Link>
            <Link
              href="/discrepancies?status=all"
              className={`rounded-md px-2.5 py-1.5 ${
                showAll ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {t("discrepancies.allStatuses")}
            </Link>
          </div>
          <span className="text-[11px] font-medium text-slate-500">
            {t("common.results", { count: rows.length })}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="card-body text-sm text-slate-500">{t("discrepancies.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("discrepancies.severity")}</th>
                  <th>{t("discrepancies.kind")}</th>
                  <th>{t("discrepancies.detail")}</th>
                  <th>{t("discrepancies.related")}</th>
                  <th className="text-right">{t("common.amount")}</th>
                  <th>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <SeverityChip severity={row.severity} locale={locale} />
                    </td>
                    <td>
                      <KindChip kind={row.kind} locale={locale} />
                    </td>
                    <td className="max-w-md">
                      <span className="text-sm text-slate-700">{row.detail}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        {formatDate(row.createdAt.slice(0, 10), locale)}
                      </span>
                    </td>
                    <td>
                      {row.invoiceNumber ? (
                        <Link
                          href={`/invoices/${encodeURIComponent(row.invoiceNumber)}`}
                          className="font-mono text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                          {row.invoiceNumber}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="num">
                      {row.amountMinor === null
                        ? "—"
                        : formatMinor(row.amountMinor, row.currency ?? workspace.currency, locale)}
                    </td>
                    <td>
                      <StatusChip status={row.status} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
