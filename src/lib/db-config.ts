/**
 * Database connection settings, shared by the app, the seed and db:deploy.
 *
 * URL:   DATABASE_URL, else TURSO_DATABASE_URL (what the Vercel Marketplace
 *        Turso integration injects), else file:./dev.db.
 * Token: DATABASE_AUTH_TOKEN, else TURSO_AUTH_TOKEN.
 */
type Env = Record<string, string | undefined>;

export interface DbConfig {
  url: string;
  authToken?: string;
  remote: boolean;
}

const val = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

export function resolveDbConfig(env: Env = process.env, opts: { preferRemote?: boolean } = {}): DbConfig {
  const candidates = [val(env.DATABASE_URL), val(env.TURSO_DATABASE_URL)].filter((u): u is string => Boolean(u));
  // For remote-only scripts, a local DATABASE_URL in .env must not shadow the Turso URL.
  const url = (opts.preferRemote ? candidates.find((u) => !u.startsWith("file:")) : undefined) ?? candidates[0] ?? "file:./dev.db";
  const remote = !url.startsWith("file:");
  const authToken = remote ? (val(env.DATABASE_AUTH_TOKEN) ?? val(env.TURSO_AUTH_TOKEN)) : undefined;
  return { url, authToken, remote };
}

export function isLocalDatabase(env: Env = process.env): boolean {
  return !resolveDbConfig(env).remote;
}
