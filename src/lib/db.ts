import "server-only";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { resolveDbConfig } from "./db-config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function makeClient() {
  const { url, authToken, remote } = resolveDbConfig();
  if (!remote && process.env.VERCEL) {
    // Vercel's filesystem is read-only and ephemeral: a SQLite file can't work there.
    console.error("StudyForge: no remote database configured. Set DATABASE_URL (libsql://…) and DATABASE_AUTH_TOKEN, or add Turso from the Vercel Marketplace. See docs/DEPLOY.md.");
  }
  const adapter = new PrismaLibSql(authToken ? { url, authToken } : { url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
