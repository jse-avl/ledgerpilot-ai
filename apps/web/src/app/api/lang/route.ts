import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE, normalizeLocale } from "@/lib/i18n";
import { nextPath, sameHostUrl } from "@/lib/redirects";

export function GET(request: NextRequest) {
  const locale = normalizeLocale(request.nextUrl.searchParams.get("locale"));
  const response = NextResponse.redirect(sameHostUrl(request, nextPath(request)));
  response.cookies.set(LANG_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
