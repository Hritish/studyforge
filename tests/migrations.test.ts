import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDbConfig } from "@/lib/db-config";
import { applyMigrations, loadMigrations, MIGRATIONS_TABLE, splitStatements } from "@/lib/migrations";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("db:deploy migration runner", () => {
  it("splits Prisma SQL into statements", () => {
    expect(splitStatements("-- CreateTable\nCREATE TABLE a (x INT);\n\n-- CreateIndex\nCREATE INDEX i ON a(x);\n")).toEqual(["CREATE TABLE a (x INT)", "CREATE INDEX i ON a(x)"]);
  });

  it("applies the repo's migrations once and is safe to re-run", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "sf-mig-"));
    const client = createClient({ url: `file:${path.join(dir, "t.db")}` });
    const migrations = await loadMigrations(path.join(process.cwd(), "prisma", "migrations"));
    expect(migrations.length).toBeGreaterThan(0);
    const first = await applyMigrations(client, migrations);
    expect(first.applied).toEqual(migrations.map((m) => m.name));
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.rows.map((r) => r.name)).toEqual(expect.arrayContaining(["StudySet", "Card", "NoteSource", MIGRATIONS_TABLE]));
    const second = await applyMigrations(client, migrations);
    expect(second).toEqual({ applied: [], skipped: migrations.map((m) => m.name), changed: [] });
    // A failing migration is rolled back with its record.
    const bad = { name: "99999999_bad", sql: "CREATE TABLE ok_part (x INT);\nCREATE TABLE StudySet (x INT);", checksum: "x" };
    await expect(applyMigrations(client, [...migrations, bad])).rejects.toThrow();
    const after = await client.execute("SELECT name FROM sqlite_master WHERE name = 'ok_part'");
    expect(after.rows).toHaveLength(0);
    client.close();
  });
});

describe("database config", () => {
  it("defaults to the local file and accepts Turso integration names as fallbacks", () => {
    expect(resolveDbConfig({})).toEqual({ url: "file:./dev.db", authToken: undefined, remote: false });
    expect(resolveDbConfig({ DATABASE_URL: "libsql://a.turso.io", DATABASE_AUTH_TOKEN: "t1", TURSO_AUTH_TOKEN: "t2" })).toEqual({ url: "libsql://a.turso.io", authToken: "t1", remote: true });
    expect(resolveDbConfig({ TURSO_DATABASE_URL: "libsql://b.turso.io", TURSO_AUTH_TOKEN: "t2" })).toEqual({ url: "libsql://b.turso.io", authToken: "t2", remote: true });
    // local file never gets a token; remote scripts skip a local DATABASE_URL from .env
    expect(resolveDbConfig({ DATABASE_URL: "file:./dev.db", TURSO_DATABASE_URL: "libsql://b.turso.io", TURSO_AUTH_TOKEN: "t" }).remote).toBe(false);
    expect(resolveDbConfig({ DATABASE_URL: "file:./dev.db", TURSO_DATABASE_URL: "libsql://b.turso.io", TURSO_AUTH_TOKEN: "t" }, { preferRemote: true }).url).toBe("libsql://b.turso.io");
  });
});
