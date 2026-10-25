import { kindKey, statusKey, translator, type Locale } from "@/lib/i18n";

const STATUS_TONE: Record<string, string> = {
  open: "chip-sky",
  partially_paid: "chip-amber",
  paid: "chip-emerald",
  draft: "chip-slate",
  void: "chip-slate",
  resolved: "chip-emerald",
  ignored: "chip-slate",
  pending_approval: "chip-amber",
  approved: "chip-emerald",
  rejected: "chip-rose",
  executed: "chip-emerald",
  expired: "chip-slate",
};

export function StatusChip({ status, locale }: { status: string; locale: Locale }) {
  const t = translator(locale);
  return <span className={`chip ${STATUS_TONE[status] ?? "chip-slate"}`}>{t(statusKey(status))}</span>;
}

const SEVERITY_TONE: Record<string, string> = {
  error: "chip-rose",
  warning: "chip-amber",
  info: "chip-sky",
};

export function SeverityChip({ severity, locale }: { severity: string; locale: Locale }) {
  const t = translator(locale);
  const key =
    severity === "error"
      ? "severity.error"
      : severity === "warning"
        ? "severity.warning"
        : "severity.info";
  return <span className={`chip ${SEVERITY_TONE[severity] ?? "chip-slate"}`}>{t(key)}</span>;
}

export function KindChip({ kind, locale }: { kind: string; locale: Locale }) {
  const t = translator(locale);
  return <span className="chip chip-slate font-mono text-[11px]">{t(kindKey(kind))}</span>;
}
