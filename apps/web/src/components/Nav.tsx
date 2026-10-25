"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: IconName };

export type IconName = "overview" | "invoices" | "exceptions" | "proposals" | "assistant";

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "invoices":
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v4h4" />
          <path d="M9 12h7M9 16h7" />
        </svg>
      );
    case "exceptions":
      return (
        <svg {...common}>
          <path d="M12 3 2.8 19h18.4L12 3Z" />
          <path d="M12 9v5M12 17.2v.1" />
        </svg>
      );
    case "proposals":
      return (
        <svg {...common}>
          <path d="M9 11l2 2 4-4" />
          <path d="M5 4h14v16H5z" />
        </svg>
      );
    case "assistant":
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
          <path d="M9 11h.1M12.5 11h.1M16 11h.1" />
        </svg>
      );
  }
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav({ items, compact = false }: { items: NavItem[]; compact?: boolean }) {
  const pathname = usePathname();

  if (compact) {
    return (
      <nav className="flex gap-1 overflow-x-auto pb-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              isActive(pathname, item.href)
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`nav-link ${isActive(pathname, item.href) ? "nav-link-active" : ""}`}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
