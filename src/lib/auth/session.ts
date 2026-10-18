/**
 * Optional password gate. When APP_PASSWORD is set every page and API route
 * requires a session cookie; when it's unset (local dev) there is no gate.
 *
 * The cookie never contains the password. It is `v1.<expiry>.<mac>` where
 * mac = HMAC-SHA256(key, "v1.<expiry>") and key = APP_SECRET, or (if unset) a
 * key derived from APP_PASSWORD — so changing either logs everyone out.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sf_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface AuthConfig {
  password: string;
  key: Buffer;
}

/** null when the gate is disabled (APP_PASSWORD unset or blank). */
export function getAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const password = env.APP_PASSWORD ?? "";
  if (!password.trim()) return null;
  const secret = env.APP_SECRET?.trim();
  const key = secret
    ? createHash("sha256").update(`studyforge-app-secret:${secret}`).digest()
    : createHmac("sha256", "studyforge-session-key-v1").update(password).digest();
  return { password, key };
}

function mac(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function signSession(key: Buffer, nowMs = Date.now(), maxAgeS = SESSION_MAX_AGE_S): string {
  const payload = `v1.${Math.floor(nowMs / 1000) + maxAgeS}`;
  return `${payload}.${mac(key, payload)}`;
}

export function verifySession(token: string | undefined | null, key: Buffer, nowMs = Date.now()): boolean {
  if (!token) return false;
  const m = /^(v1\.(\d{1,12}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const expected = Buffer.from(mac(key, m[1]));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(m[2]) * 1000 > nowMs;
}

/** Constant-time comparison (both sides hashed first so lengths match). */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function sessionCookieOptions(production = process.env.NODE_ENV === "production") {
  return { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/", maxAge: SESSION_MAX_AGE_S };
}

/** Root-level files from /public (favicon, robots.txt, icons…). */
const STATIC_FILE_RE = /^\/[^/]+\.(?:ico|png|svg|jpg|jpeg|webp|gif|txt|xml|webmanifest)$/i;

/**
 * Paths reachable without a session: the login page and its endpoints, and
 * framework/static assets. Everything else (pages and /api/*) is gated.
 * No Blob upload callback is exempted: uploads don't use onUploadCompleted, so
 * Vercel Blob never calls back into the app.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/api/login" || pathname === "/api/logout") return true;
  if (pathname.startsWith("/_next/")) return true;
  return STATIC_FILE_RE.test(pathname);
}

/** Only same-site relative paths are allowed as post-login redirects. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login") || next.startsWith("/api/")) return "/";
  return next;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** True if the gate is off, or the request carries a valid session cookie. */
export function isAuthorized(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  const cfg = getAuthConfig(env);
  if (!cfg) return true;
  return verifySession(readCookie(req.headers.get("cookie"), SESSION_COOKIE), cfg.key);
}

/** For route handlers: a 401 response when not signed in (defense in depth behind the proxy). */
export function unauthorized(req: Request): Response | null {
  return isAuthorized(req) ? null : Response.json({ error: "Not signed in. Reload the page and log in." }, { status: 401 });
}
