import Link from "next/link";
import type { ReactNode } from "react";

const TONES: Record<string, string> = {
  emerald: "text-emerald-700",
  rose: "text-rose-600",
  amber: "text-amber-600",
  slate: "text-slate-900",
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "slate",
  href,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  tone?: keyof typeof TONES;
  href?: string;
}) {
  const body = (
    <>
      <p className="label">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${TONES[tone] ?? TONES.slate}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="card block p-5 transition hover:border-slate-300 hover:shadow-sm"
      >
        {body}
      </Link>
    );
  }

  return <div className="card p-5">{body}</div>;
}
