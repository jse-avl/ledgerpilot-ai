import Link from "next/link";
import type { ReactNode } from "react";
import { CapabilityBadge } from "./CapabilityBadge";
import { LanguageToggle } from "./LanguageToggle";
import { Nav, type NavItem } from "./Nav";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { formatDate } from "@/lib/format";
import { currentLocale, translator } from "@/lib/i18n";
import { currentWorkspace, demoAsOf, workspaceOptions } from "@/lib/workspace";

export async function Shell({ children }: { children: ReactNode }) {
  const [locale, workspace] = await Promise.all([currentLocale(), currentWorkspace()]);
  const t = translator(locale);

  const items: NavItem[] = [
    { href: "/", label: t("nav.overview"), icon: "overview" },
    { href: "/invoices", label: t("nav.invoices"), icon: "invoices" },
    { href: "/discrepancies", label: t("nav.discrepancies"), icon: "exceptions" },
    { href: "/proposals", label: t("nav.proposals"), icon: "proposals" },
    { href: "/assistant", label: t("nav.assistant"), icon: "assistant" },
  ];

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-sm font-black text-white shadow-sm">
            LP
          </span>
          <span>
            <span className="block text-sm font-bold tracking-tight text-slate-900">
              {t("app.name")}
            </span>
            <span className="block text-[11px] text-slate-500">{t("app.tagline")}</span>
          </span>
        </Link>

        <div className="mt-6">
          <WorkspaceSwitcher
            current={{ slug: workspace.slug, name: workspace.name }}
            options={workspaceOptions()}
            label={t("common.workspace")}
            srLabel={t("common.switchWorkspace")}
          />
        </div>

        <div className="mt-6">
          <Nav items={items} />
        </div>

        <div className="mt-auto space-y-3 pt-6">
          <p className="px-1 text-[11px] leading-relaxed text-slate-400">
            {t("common.asOf", { date: formatDate(demoAsOf(), locale) })}
          </p>
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-semibold text-slate-400">v0.1</span>
            <LanguageToggle locale={locale} />
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 text-xs font-black text-white">
                LP
              </span>
              <span className="text-sm font-bold tracking-tight">{t("app.name")}</span>
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-[11px] text-slate-400 sm:inline">
                {t("common.asOf", { date: formatDate(demoAsOf(), locale) })}
              </span>
              <CapabilityBadge locale={locale} />
              <div className="lg:hidden">
                <LanguageToggle locale={locale} />
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-6xl px-4 pb-2 lg:hidden">
            <Nav items={items} compact />
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>

        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-6 text-[11px] text-slate-400 sm:px-6 lg:px-8">
          <span>
            {t("app.name")} · {t("footer.built")}
          </span>
          <span>{t("footer.note")}</span>
        </footer>
      </div>
    </div>
  );
}
