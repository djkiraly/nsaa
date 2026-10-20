/**
 * Guards the hidden /analytics page (Next 16 "proxy", formerly middleware; runs on Node).
 *  - /analytics?key=<ANALYTICS_KEY> → sets the access cookie and redirects to /analytics (key out of the URL)
 *  - valid cookie → through
 *  - anything else → the site's normal 404, so the page looks like it doesn't exist
 */
import { NextResponse, type NextRequest } from "next/server";
import { ANALYTICS_COOKIE, analyticsCookieValue, isAnalyticsCookie, isAnalyticsKey } from "@/lib/analytics/auth";

const notFound = (req: NextRequest) => NextResponse.rewrite(new URL("/__not-found", req.url));

export function proxy(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== null) {
    if (!isAnalyticsKey(key)) return notFound(req);
    // Behind nginx the app sees http://127.0.0.1; rebuild the public URL from the forwarded headers.
    const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
    const res = NextResponse.redirect(new URL("/analytics", `${proto}://${host}`));
    res.cookies.set(ANALYTICS_COOKIE, analyticsCookieValue()!, {
      httpOnly: true,
      secure: proto === "https",
      sameSite: "strict",
      path: "/analytics",
      maxAge: 60 * 60 * 24 * 180,
    });
    return res;
  }
  if (!isAnalyticsCookie(req.cookies.get(ANALYTICS_COOKIE)?.value)) return notFound(req);
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = { matcher: ["/analytics", "/analytics/:path*"] };
