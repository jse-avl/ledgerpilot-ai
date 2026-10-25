import type { AgingBucket } from "@ledgerpilot/core";
import { formatMinor } from "@/lib/format";
import { type Locale, translator } from "@/lib/i18n";
import type { AgingRow } from "@/lib/queries";

const BUCKET_LABEL: Record<AgingBucket, string> = {
  current: "0",
  "1-30": "1–30",
  "31-60": "31–60",
  "61-90": "61–90",
  "90+": "90+",
};

const BUCKET_ORDER: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

const BUCKET_TONE: Record<AgingBucket, string> = {
  current: "bg-emerald-500",
  "1-30": "bg-lime-500",
  "31-60": "bg-amber-500",
  "61-90": "bg-orange-500",
  "90+": "bg-rose-500",
};

/**
 * A stacked view per currency. Amounts are never summed across currencies,
 * because that would require an FX rate the page has not chosen.
 */
export function AgingChart({ rows, locale }: { rows: readonly AgingRow[]; locale: Locale }) {
  const t = translator(locale);
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">{t("overview.noOpenInvoices")}</p>;
  }

  return (
    <div className="space-y-6">
      {rows.map((row) => {
        const max = Math.max(...Object.values(row.buckets), 1);
        return (
          <div key={row.currency}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {row.currency}
              </span>
              <span className="font-mono text-xs text-slate-500">
                {formatMinor(row.totalMinor, row.currency, locale)}
              </span>
            </div>
            <dl className="space-y-1.5">
              {BUCKET_ORDER.map((bucket) => {
                const value = row.buckets[bucket];
                const width = value === 0 ? 0 : Math.max(3, Math.round((value / max) * 100));
                return (
                  <div key={bucket} className="flex items-center gap-3">
                    <dt className="w-12 shrink-0 text-right font-mono text-[11px] text-slate-500">
                      {BUCKET_LABEL[bucket]}
                    </dt>
                    <dd className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${BUCKET_TONE[bucket]}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="w-28 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-600">
                        {value === 0 ? "—" : formatMinor(value, row.currency, locale)}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
