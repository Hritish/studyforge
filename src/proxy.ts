/**
 * Password gate (Next.js 16 "proxy", formerly middleware; runs on Node.js).
 * Disabled when APP_PASSWORD is unset, so local dev is unchanged.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig, isPublicPath, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export function proxy(req: NextRequest) {
  const cfg = getAuthConfig();
  if (!cfg) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (verifySession(req.cookies.get(SESSION_COOKIE)?.value, cfg.key)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in. Reload the page and log in." }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except framework assets; isPublicPath() handles the rest.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
