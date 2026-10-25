import { NextResponse, type NextRequest } from "next/server";
import { nextPath, sameHostUrl } from "@/lib/redirects";
import { WORKSPACE_COOKIE, workspaceSlugs } from "@/lib/workspace";

export function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const response = NextResponse.redirect(sameHostUrl(request, nextPath(request)));

  // Only known workspaces can be selected. The database enforces the rest.
  if (workspaceSlugs().includes(slug)) {
    response.cookies.set(WORKSPACE_COOKIE, slug, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}
