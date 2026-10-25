import Link from "next/link";
import { StatusChip } from "@/components/Chips";
import { formatDateTime, formatMinor, shortHash } from "@/lib/format";
import { currentLocale, translator } from "@/lib/i18n";
import { listProposals, type ProposalRow } from "@/lib/queries";
import { currentWorkspace } from "@/lib/workspace";

export default async function ProposalsPage() {
  const [locale, workspace] = await Promise.all([currentLocale(), currentWorkspace()]);
  const t = translator(locale);
  const proposals = await listProposals(workspace);
  const pending = proposals.filter((proposal) => proposal.status === "pending_approval");

  const card = (proposal: ProposalRow) => (
    <li key={proposal.id} className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={proposal.status} locale={locale} />
            <span className="font-mono text-[11px] text-slate-400">{proposal.kind}</span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800">{proposal.summary}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            {t("proposals.proposedBy")} {proposal.proposedBy} ·{" "}
            {formatDateTime(proposal.createdAt, locale)}
          </p>
        </div>
        <div className="text-right">
          <p className="label">{t("common.amount")}</p>
          <p className="num mt-1 text-sm font-semibold text-slate-900">
            {formatMinor(proposal.amountMinor, proposal.currency, locale)}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="label">{t("proposals.hash")}</dt>
          <dd className="mt-0.5 break-all font-mono text-slate-500">
            {shortHash(proposal.payloadHash, 32)}
          </dd>
        </div>
        <div>
          <dt className="label">{t("proposals.nonce")}</dt>
          <dd className="mt-0.5 break-all font-mono text-slate-500">
            {shortHash(proposal.nonce, 20)}
          </dd>
        </div>
      </dl>

      {proposal.status === "pending_approval" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="chip chip-amber">{t("proposals.approval")}</span>
          {proposal.requiredRoles.length > 0 ? (
            <span>{t("proposals.requiredRoles", { roles: proposal.requiredRoles.join(", ") })}</span>
          ) : null}
          {proposal.minApprovals > 0 ? (
            <span>· {t("proposals.approvers", { count: proposal.minApprovals })}</span>
          ) : null}
          <span>· {t("proposals.excluded")}</span>
        </div>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("proposals.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{t("proposals.subtitle")}</p>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
          !
        </span>
        <div>
          <p className="text-sm font-semibold text-amber-900">{t("proposals.notExecuted")}</p>
          <p className="text-xs text-amber-800">{t("proposals.notExecutedHint")}</p>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">{t("proposals.current", { count: pending.length })}</h2>
          <Link
            href="/assistant"
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
          >
            {t("nav.assistant")} →
          </Link>
        </div>
        {pending.length === 0 ? (
          <p className="card-body text-sm text-slate-500">{t("proposals.empty")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">{pending.map(card)}</ul>
        )}
      </section>

      {proposals.length > pending.length ? (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{t("proposals.history")}</h2>
            <span className="chip chip-slate">{proposals.length - pending.length}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {proposals
              .filter((proposal) => proposal.status !== "pending_approval")
              .map(card)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
