/**
 * Guards the hidden /analytics page (Next 16 "proxy", formerly middleware; runs on Node).
 *  - /analytics?key=<ANALYTICS_KEY> → sets the access cookie and redirects to /analytics (key out of the URL)
 *  - valid cookie → through (the page checks the cookie again)
 *  - anything else → the site's own 404 page for a URL that really doesn't exist, so nothing — status, title,
 *    page source — gives away that /analytics is there.
 *
 * The 404 is fetched from the app over its local plain-HTTP port. Don't NextResponse.rewrite() to it instead:
 * behind nginx/Cloudflare the request URL is https://localhost:<port>, so Next treats the rewrite as external and
 * tries TLS against the app's own HTTP port (500 "wrong version number").
 */
import { NextResponse, type NextRequest } from "next/server";
import { ANALYTICS_COOKIE, analyticsCookieValue, isAnalyticsCookie, isAnalyticsKey } from "@/lib/analytics/auth";

async function notFound(req: NextRequest): Promise<NextResponse> {
  const host = !process.env.HOST || process.env.HOST === "0.0.0.0" ? "127.0.0.1" : process.env.HOST;
  const port = req.nextUrl.port || process.env.PORT || "3000";
  try {
    const page = await fetch(`http://${host}:${port}/__not-found`, { signal: AbortSignal.timeout(5000) });
    return new NextResponse(page.body, {
      status: 404,
      headers: { "content-type": page.headers.get("content-type") ?? "text/html; charset=utf-8", "cache-control": "private, no-store" },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

export async function proxy(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== null && isAnalyticsKey(key)) {
    // Redirect to the public URL, rebuilt from the forwarded headers (the app itself sees localhost).
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
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  if (!isAnalyticsCookie(req.cookies.get(ANALYTICS_COOKIE)?.value)) return notFound(req);
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = { matcher: ["/analytics", "/analytics/:path*"] };
