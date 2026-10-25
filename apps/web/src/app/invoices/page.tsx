import Link from "next/link";
import { StatusChip } from "@/components/Chips";
import { formatDate, formatMinor } from "@/lib/format";
import { currentLocale, translator } from "@/lib/i18n";
import { listInvoices } from "@/lib/queries";
import { demoAsOf, currentWorkspace } from "@/lib/workspace";
import { daysPastDue } from "@ledgerpilot/core";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? "").trim();
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const openOnly = rawStatus === "open";

  const [locale, workspace] = await Promise.all([currentLocale(), currentWorkspace()]);
  const t = translator(locale);
  const all = await listInvoices(workspace, query);
  const invoices = openOnly ? all.filter((invoice) => invoice.openMinor > 0) : all;
  const asOf = demoAsOf();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("invoices.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("invoices.subtitle")}</p>
      </header>

      <section className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <form action="/invoices" method="get" className="flex min-w-64 flex-1 items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("common.searchPlaceholder")}
              className="input"
              aria-label={t("common.search")}
            />
            {openOnly ? <input type="hidden" name="status" value="open" /> : null}
            <button type="submit" className="btn">
              {t("common.search")}
            </button>
          </form>

          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <Link
              href={query ? `/invoices?q=${encodeURIComponent(query)}` : "/invoices"}
              className={`rounded-md px-2.5 py-1.5 ${
                openOnly ? "text-slate-500 hover:text-slate-900" : "bg-white text-slate-900 shadow-xs"
              }`}
            >
              {t("invoices.filterAll")}
            </Link>
            <Link
              href={`/invoices?status=open${query ? `&q=${encodeURIComponent(query)}` : ""}`}
              className={`rounded-md px-2.5 py-1.5 ${
                openOnly ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {t("invoices.filterOpen")}
            </Link>
          </div>
        </div>

        <p className="border-b border-slate-100 px-5 py-2 text-[11px] font-medium text-slate-500">
          {t("common.results", { count: invoices.length })}
        </p>

        {invoices.length === 0 ? (
          <p className="card-body text-sm text-slate-500">
            {query === "" ? t("invoices.empty") : t("common.noResults")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("invoices.number")}</th>
                  <th>{t("common.vendor")}</th>
                  <th>{t("invoices.issueDate")}</th>
                  <th>{t("common.due")}</th>
                  <th className="text-right">{t("common.total")}</th>
                  <th className="text-right">{t("invoices.openBalance")}</th>
                  <th>{t("common.status")}</th>
                  <th className="text-right">{t("common.view")}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const overdue =
                    invoice.openMinor > 0 &&
                    invoice.dueDate !== null &&
                    daysPastDue(invoice.dueDate, asOf) > 0;
                  return (
                    <tr key={invoice.id}>
                      <td className="whitespace-nowrap font-mono text-xs font-semibold text-slate-900">
                        {invoice.number}
                      </td>
                      <td className="max-w-56 truncate">{invoice.vendorName}</td>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDate(invoice.issueDate, locale)}
                      </td>
                      <td
                        className={`whitespace-nowrap text-xs ${
                          overdue ? "font-semibold text-rose-600" : "text-slate-500"
                        }`}
                      >
                        {formatDate(invoice.dueDate, locale)}
                      </td>
                      <td className="num">{formatMinor(invoice.totalMinor, invoice.currency, locale)}</td>
                      <td className="num font-semibold">
                        {formatMinor(invoice.openMinor, invoice.currency, locale)}
                      </td>
                      <td>
                        <StatusChip status={invoice.status} locale={locale} />
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/invoices/${encodeURIComponent(invoice.number)}`}
                          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                          {t("common.view")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
