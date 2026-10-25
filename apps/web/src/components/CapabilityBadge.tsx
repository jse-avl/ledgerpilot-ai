import { strings } from "@ledgerpilot/agent";
import { capabilityReport } from "@/lib/capabilities";
import { type Locale, translator } from "@/lib/i18n";

/**
 * The honesty badge. It states what is actually running instead of implying a
 * model is always in the loop, and expands to the per-capability decision.
 */
export async function CapabilityBadge({ locale }: { locale: Locale }) {
  const report = await capabilityReport();
  const t = translator(locale);
  const doctor = strings(locale).doctor;
  const mode = report.resolvedMode;

  const tone =
    mode === "cloud"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : mode === "local"
        ? "bg-sky-50 text-sky-800 ring-sky-200"
        : "bg-amber-50 text-amber-800 ring-amber-200";

  const dot =
    mode === "cloud" ? "bg-emerald-500" : mode === "local" ? "bg-sky-500" : "bg-amber-500";

  const label = t(`capability.${mode}`);

  return (
    <details className="group relative">
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition [&::-webkit-details-marker]:hidden ${tone}`}
        title={t(`capability.${mode}Hint`)}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className="transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
        <p className="text-xs leading-relaxed text-slate-600">{t(`capability.${mode}Hint`)}</p>
        <dl className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {report.capabilities.map((item) => (
            <div key={item.capability} className="flex items-start justify-between gap-3 py-2">
              <dt className="text-xs font-medium text-slate-700">
                {doctor.capabilities[item.capability]}
              </dt>
              <dd className="text-right text-[11px] text-slate-500">
                <span className="font-semibold text-slate-800">{doctor.modes[item.mode]}</span>
                <br />
                {item.provider}
                {item.model ? ` · ${item.model}` : ""}
              </dd>
            </div>
          ))}
        </dl>
        <a
          href="/api/health"
          className="mt-3 inline-block text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
        >
          {t("capability.details")} →
        </a>
      </div>
    </details>
  );
}
