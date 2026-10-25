import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { currentLocale, type Locale } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  return {
    title: {
      default: "LedgerPilot — accounts payable, under control",
      template: "%s · LedgerPilot",
    },
    description:
      locale === "es"
        ? "Back office de cuentas por pagar con un núcleo determinista y modelos opcionales."
        : "An accounts-payable back office with a deterministic core and optional models.",
    applicationName: "LedgerPilot",
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale: Locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
