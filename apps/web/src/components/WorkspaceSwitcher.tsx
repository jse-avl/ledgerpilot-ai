"use client";

import { usePathname } from "next/navigation";

export interface WorkspaceOption {
  readonly slug: string;
  readonly name: string;
}

/**
 * Workspace switch. It is a set of links, not client state: selecting a
 * workspace sets a cookie and reloads the current page, so the server can
 * re-render under the new tenant and Row Level Security decides what exists.
 */
export function WorkspaceSwitcher({
  current,
  options,
  label,
  srLabel,
}: {
  current: WorkspaceOption;
  options: readonly WorkspaceOption[];
  label: string;
  srLabel: string;
}) {
  const pathname = usePathname() || "/";

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {label}
          </span>
          <span className="block truncate text-sm font-semibold text-slate-900">{current.name}</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
        {options.map((option) => {
          const active = option.slug === current.slug;
          return (
            <a
              key={option.slug}
              href={`/api/tenant?slug=${encodeURIComponent(option.slug)}&next=${encodeURIComponent(pathname)}`}
              aria-current={active ? "true" : undefined}
              className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${
                active
                  ? "bg-slate-50 font-semibold text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <span className="truncate">{option.name}</span>
              {active ? <span className="text-emerald-600">●</span> : null}
            </a>
          );
        })}
      </div>
      <span className="sr-only">{srLabel}</span>
    </details>
  );
}
