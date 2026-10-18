import { NextResponse } from "next/server";
import { clientIp, loginLimiter } from "@/lib/auth/rate-limit";
import { getAuthConfig, passwordMatches, safeNextPath, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";

/** Login form submit (application/x-www-form-urlencoded: password, next). Redirects with 303. */
export async function POST(req: Request) {
  const cfg = getAuthConfig();
  const form = await req.formData().catch(() => null);
  const next = safeNextPath(form?.get("next"));
  const back = (error: string) => {
    const u = new URL("/login", req.url);
    u.searchParams.set("error", error);
    if (next !== "/") u.searchParams.set("next", next);
    return NextResponse.redirect(u, 303);
  };
  if (!cfg) return NextResponse.redirect(new URL(next, req.url), 303);

  const ip = clientIp(req);
  if (!loginLimiter.allowed(ip)) {
    const res = back("rate");
    res.headers.set("Retry-After", String(loginLimiter.retryAfter(ip)));
    return res;
  }
  const given = form?.get("password");
  if (typeof given !== "string" || !passwordMatches(given, cfg.password)) {
    loginLimiter.fail(ip);
    return back("invalid");
  }
  loginLimiter.reset(ip);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, signSession(cfg.key), sessionCookieOptions());
  return res;
}
