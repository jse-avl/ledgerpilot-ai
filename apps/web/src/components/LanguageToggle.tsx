"use client";

import { usePathname } from "next/navigation";

/**
 * Language switch as real links, so it works before hydration and the URL keeps
 * the current page. The route validates `next`; nothing here is trusted.
 */
export function LanguageToggle({ locale }: { locale: "en" | "es" }) {
  const pathname = usePathname() || "/";
  const options = [
    { code: "en" as const, label: "EN" },
    { code: "es" as const, label: "ES" },
  ];

  return (
    <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-bold">
      {options.map((option) => (
        <a
          key={option.code}
          href={`/api/lang?locale=${option.code}&next=${encodeURIComponent(pathname)}`}
          aria-current={locale === option.code ? "true" : undefined}
          className={`rounded-md px-2 py-1 transition ${
            locale === option.code
              ? "bg-slate-900 text-white"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {option.label}
        </a>
      ))}
    </div>
  );
}
