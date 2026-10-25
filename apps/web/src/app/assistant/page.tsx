import { answer } from "@ledgerpilot/agent";
import { currentLocale, translator } from "@/lib/i18n";
import { capabilityReport } from "@/lib/capabilities";
import { loadAssistantFacts } from "@/lib/queries";
import { currentWorkspace, demoAsOf } from "@/lib/workspace";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const question = (raw ?? "").trim();

  const [locale, workspace, report] = await Promise.all([
    currentLocale(),
    currentWorkspace(),
    capabilityReport(),
  ]);
  const t = translator(locale);

  const result =
    question === ""
      ? null
      : answer(
          question,
          { ...(await loadAssistantFacts(workspace)), asOf: demoAsOf() },
          { locale, mode: report.resolvedMode },
        );

  const suggestions = [
    t("assistant.suggestion1"),
    t("assistant.suggestion2"),
    t("assistant.suggestion3"),
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("assistant.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{t("assistant.subtitle")}</p>
      </header>

      <section className="card">
        <form action="/assistant" method="get" className="flex flex-wrap gap-2 p-4">
          <input
            type="search"
            name="q"
            defaultValue={question}
            placeholder={t("assistant.placeholder")}
            className="input flex-1"
            aria-label={t("assistant.placeholder")}
          />
          <button type="submit" className="btn btn-primary">
            {t("assistant.ask")}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t("assistant.suggestions")}
          </span>
          {suggestions.map((suggestion) => (
            <a
              key={suggestion}
              href={`/assistant?q=${encodeURIComponent(suggestion)}`}
              className="chip chip-slate hover:bg-slate-100"
            >
              {suggestion}
            </a>
          ))}
        </div>
      </section>

      {result === null ? (
        <section className="card card-body">
          <p className="text-sm text-slate-500">{t("assistant.empty")}</p>
          <p className="mt-4 text-xs leading-relaxed text-slate-400">{t("assistant.disclaimer")}</p>
        </section>
      ) : (
        <section className="card">
          <div className="card-header">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {t("assistant.answerMode")} · {result.mode}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                {result.headline}
              </h2>
            </div>
            <span className={`chip ${result.grounded ? "chip-emerald" : "chip-amber"}`}>
              {result.grounded ? t("assistant.grounded") : t("assistant.notGrounded")}
            </span>
          </div>

          <div className="card-body space-y-4">
            <ul className="space-y-1.5">
              {result.bullets.map((bullet, index) => (
                // Two identical invoices are a legitimate finding, so the text is
                // not unique. Position is the only stable identity a bullet has.
                <li key={`${index}-${bullet}`} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            {result.citations.length > 0 ? (
              <div className="border-t border-slate-100 pt-3">
                <p className="label">{t("assistant.citations")}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {result.citations.map((citation) => (
                    <li key={`${citation.ref}-${citation.label}`} className="chip chip-slate">
                      {citation.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <p className="text-xs leading-relaxed text-slate-400">{t("assistant.disclaimer")}</p>
    </div>
  );
}
