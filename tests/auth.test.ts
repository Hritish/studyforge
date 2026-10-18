import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import {
  getAuthConfig,
  isAuthorized,
  isPublicPath,
  passwordMatches,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/auth/session";

const DAY = 24 * 60 * 60 * 1000;

describe("auth config", () => {
  it("is disabled when APP_PASSWORD is unset or blank", () => {
    expect(getAuthConfig({})).toBeNull();
    expect(getAuthConfig({ APP_PASSWORD: "  " })).toBeNull();
  });

  it("derives the key from APP_PASSWORD, or uses APP_SECRET when set", () => {
    const a = getAuthConfig({ APP_PASSWORD: "hunter2" })!;
    const b = getAuthConfig({ APP_PASSWORD: "hunter3" })!;
    const s1 = getAuthConfig({ APP_PASSWORD: "hunter2", APP_SECRET: "s3cret" })!;
    const s2 = getAuthConfig({ APP_PASSWORD: "other", APP_SECRET: "s3cret" })!;
    expect(a.key.equals(b.key)).toBe(false);
    expect(a.key.equals(s1.key)).toBe(false);
    expect(s1.key.equals(s2.key)).toBe(true); // APP_SECRET alone determines the key
  });
});

describe("session cookie signing", () => {
  const key = getAuthConfig({ APP_PASSWORD: "correct horse" })!.key;
  const t0 = Date.UTC(2026, 9, 18);

  it("never contains the password and verifies with the same key", () => {
    const token = signSession(key, t0);
    expect(token).not.toContain("correct");
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifySession(token, key, t0 + DAY)).toBe(true);
  });

  it("expires after 30 days", () => {
    const token = signSession(key, t0);
    expect(SESSION_MAX_AGE_S).toBe(30 * 24 * 60 * 60);
    expect(verifySession(token, key, t0 + 29 * DAY)).toBe(true);
    expect(verifySession(token, key, t0 + 30 * DAY + 1000)).toBe(false);
  });

  it("rejects tampered, foreign-key, empty and malformed tokens", () => {
    const token = signSession(key, t0);
    const [v, exp, mac] = token.split(".");
    expect(verifySession(`${v}.${Number(exp) + 9999}.${mac}`, key, t0)).toBe(false); // extended expiry
    expect(verifySession(`${v}.${exp}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`, key, t0)).toBe(false);
    expect(verifySession(token, getAuthConfig({ APP_PASSWORD: "changed" })!.key, t0)).toBe(false); // password change logs out
    for (const bad of [undefined, null, "", "v1", "v1.abc.def", "correct horse", `${token}x`]) expect(verifySession(bad, key, t0)).toBe(false);
  });

  it("compares passwords correctly", () => {
    expect(passwordMatches("correct horse", "correct horse")).toBe(true);
    expect(passwordMatches("correct hors", "correct horse")).toBe(false);
    expect(passwordMatches("", "correct horse")).toBe(false);
    expect(passwordMatches("Correct horse", "correct horse")).toBe(false);
  });

  it("uses httpOnly, SameSite=Lax, Secure in production, 30-day cookies", () => {
    expect(sessionCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it("authorizes requests by cookie only when the gate is on", () => {
    const env = { APP_PASSWORD: "pw" };
    const token = signSession(getAuthConfig(env)!.key);
    const req = (cookie?: string) => new Request("http://x/api/sets", { headers: cookie ? { cookie } : {} });
    expect(isAuthorized(req(), {})).toBe(true);
    expect(isAuthorized(req(), env)).toBe(false);
    expect(isAuthorized(req(`a=1; ${SESSION_COOKIE}=${token}; b=2`), env)).toBe(true);
    expect(isAuthorized(req(`${SESSION_COOKIE}=nope`), env)).toBe(false);
  });
});

describe("gate path matching", () => {
  it("leaves only login and static assets public", () => {
    for (const p of ["/login", "/api/login", "/api/logout", "/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/robots.txt", "/icon.png"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of ["/", "/new", "/sets/abc", "/sets/abc/flashcards", "/api/sets", "/api/generate", "/api/context", "/api/upload", "/api/files", "/api/files/ingest", "/api/status", "/login/extra", "/api/login2", "/sets/x/notes.png"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("only redirects to same-site paths after login", () => {
    expect(safeNextPath("/sets/abc?x=1")).toBe("/sets/abc?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "", undefined, 5, "/login", "/api/sets"]) expect(safeNextPath(bad)).toBe("/");
  });
});

describe("login rate limiter", () => {
  it("blocks after max failures per key until the window passes", () => {
    const rl = createRateLimiter({ max: 3, windowMs: 1000 });
    for (let i = 0; i < 3; i++) {
      expect(rl.allowed("1.2.3.4", 0)).toBe(true);
      rl.fail("1.2.3.4", 0);
    }
    expect(rl.allowed("1.2.3.4", 10)).toBe(false);
    expect(rl.retryAfter("1.2.3.4", 10)).toBe(1);
    expect(rl.allowed("5.6.7.8", 10)).toBe(true); // other IPs unaffected
    expect(rl.allowed("1.2.3.4", 1001)).toBe(true);
    rl.fail("9.9.9.9", 0);
    rl.reset("9.9.9.9");
    expect(rl.retryAfter("9.9.9.9", 0)).toBe(0);
  });

  it("applies a global cap across keys", () => {
    const rl = createRateLimiter({ max: 100, windowMs: 1000, globalMax: 4 });
    for (let i = 0; i < 4; i++) rl.fail(`ip${i}`, 0);
    expect(rl.allowed("fresh-ip", 1)).toBe(false);
  });
});
