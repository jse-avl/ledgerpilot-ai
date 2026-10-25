import type { NextRequest } from "next/server";

/**
 * Redirect target for the cookie routes.
 *
 * A `next` value comes from the URL, so it is validated here instead of trusted:
 * same origin only, no protocol-relative URLs, no API routes (which would make a
 * redirect loop), no backslashes.
 */
export function isSafeNext(value: string | null): value is string {
  if (!value) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.startsWith("/api")) return false;
  return !value.includes("\\");
}

/**
 * The host the browser actually used.
 *
 * `request.url` is not reliable for this in development: Next normalises it to
 * `localhost`, so a page opened on `127.0.0.1` would be redirected to another
 * origin and the cookie just set would not apply. The Host header is the truth.
 */
function requestHost(request: NextRequest): string {
  return request.headers.get("host") ?? new URL(request.url).host;
}

export function sameHostUrl(request: NextRequest, path: string): URL {
  const url = new URL(path, request.url);
  url.host = requestHost(request);

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto === "http" || forwardedProto === "https") {
    url.protocol = `${forwardedProto}:`;
  }

  return url;
}

export function nextPath(request: NextRequest): string {
  const explicit = request.nextUrl.searchParams.get("next");
  if (isSafeNext(explicit)) return explicit;

  const referer = request.headers.get("referer");
  if (!referer) return "/";
  try {
    const target = new URL(referer);
    if (target.host !== requestHost(request)) return "/";
    const path = `${target.pathname}${target.search}`;
    return isSafeNext(path) ? path : "/";
  } catch {
    return "/";
  }
}
