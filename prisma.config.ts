import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prisma Migrate only handles local SQLite files (it rejects libsql:// with P1013). For Turso (libsql://)
    // use `npm run db:deploy`. The fallback keeps `prisma generate` (postinstall,
    // Vercel builds) working when DATABASE_URL isn't set.
    url: process.env.DATABASE_URL?.trim() || "file:./dev.db",
  },
});
