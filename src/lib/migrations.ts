/**
 * Applies prisma/migrations/<name>/migration.sql to a libsql database (Turso
 * or a local file) with @libsql/client. Prisma 7's `migrate deploy` rejects
 * libsql:// URLs (P1013), so the hosted database is migrated with this instead.
 *
 * Applied migrations are recorded in `_studyforge_migrations` (name, sha256
 * checksum, time). Each migration runs in one write transaction together with
 * its record, so a failure leaves nothing half-applied and re-running is safe.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "@libsql/client";

export const MIGRATIONS_TABLE = "_studyforge_migrations";

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const out: Migration[] = [];
  for (const name of names) {
    const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8").catch(() => null);
    if (sql === null) continue;
    out.push({ name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return out;
}

/** Split Prisma-generated SQL into statements (drops `--` comments and blank statements). */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((l) => l.replace(/^\s*--.*$/, ""))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface DeployResult {
  applied: string[];
  skipped: string[];
  /** Migrations whose file changed after being applied (not re-run). */
  changed: string[];
}

export async function applyMigrations(client: Client, migrations: Migration[], log: (m: string) => void = () => {}): Promise<DeployResult> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "applied_at" TEXT NOT NULL)`,
  );
  const rows = await client.execute(`SELECT "name", "checksum" FROM "${MIGRATIONS_TABLE}"`);
  const done = new Map(rows.rows.map((r) => [String(r.name), String(r.checksum)]));
  const result: DeployResult = { applied: [], skipped: [], changed: [] };
  for (const m of migrations) {
    const prev = done.get(m.name);
    if (prev !== undefined) {
      result.skipped.push(m.name);
      if (prev !== m.checksum) {
        result.changed.push(m.name);
        log(`! ${m.name} was already applied but its migration.sql has changed since; not re-running it.`);
      } else log(`= ${m.name} (already applied)`);
      continue;
    }
    const stmts = splitStatements(m.sql);
    await client.batch(
      [
        ...stmts,
        { sql: `INSERT INTO "${MIGRATIONS_TABLE}" ("name", "checksum", "applied_at") VALUES (?, ?, ?)`, args: [m.name, m.checksum, new Date().toISOString()] },
      ],
      "write",
    );
    result.applied.push(m.name);
    log(`+ ${m.name} (${stmts.length} statements)`);
  }
  return result;
}
