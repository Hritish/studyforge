/**
 * Apply prisma/migrations to the hosted (Turso / libsql) database.
 *   npm run db:deploy                          # uses TURSO_DATABASE_URL / DATABASE_URL (+ auth token) from the env
 *   npm run db:deploy -- --env-file=.env.vercel
 * Safe to re-run: applied migrations are recorded and skipped.
 */
import path from "node:path";
import { createClient } from "@libsql/client";
import { resolveDbConfig } from "../src/lib/db-config";
import { applyMigrations, loadMigrations } from "../src/lib/migrations";
import { loadScriptEnv } from "./env";

async function main() {
  loadScriptEnv();
  const allowLocal = process.argv.includes("--allow-local");
  const db = resolveDbConfig(process.env, { preferRemote: true });
  if (!db.remote && !allowLocal) {
    console.error(
      "No remote database URL found. Set TURSO_DATABASE_URL (or DATABASE_URL=libsql://…) and TURSO_AUTH_TOKEN / DATABASE_AUTH_TOKEN, or pass --env-file=<file>.\n" +
        "For the local SQLite file use `npm run db:setup` instead (or pass --allow-local).",
    );
    process.exit(1);
  }
  if (db.remote && !db.authToken) console.warn("Warning: no DATABASE_AUTH_TOKEN / TURSO_AUTH_TOKEN set; Turso will likely reject the connection.");
  const host = db.remote ? new URL(db.url).host : db.url;
  console.log(`Applying migrations to ${host}`);
  const client = createClient(db.authToken ? { url: db.url, authToken: db.authToken } : { url: db.url });
  try {
    const migrations = await loadMigrations(path.join(process.cwd(), "prisma", "migrations"));
    const r = await applyMigrations(client, migrations, (m) => console.log(`  ${m}`));
    console.log(`Done: ${r.applied.length} applied, ${r.skipped.length} already up to date.`);
    if (r.changed.length) process.exitCode = 2;
  } finally {
    client.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
