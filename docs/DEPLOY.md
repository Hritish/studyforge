# Deploying StudyForge to Vercel (free Hobby plan)

This gives you a private StudyForge at `https://<project>.vercel.app`:

- **Vercel** (Hobby) runs the Next.js app.
- **Turso** (hosted libSQL/SQLite, free tier) holds the database.
- **Vercel Blob** (free tier, about 1 GB) holds uploads while cards are generated. They are deleted when you save a set, and anything left over is swept after 24 hours.
- **APP_PASSWORD** locks the whole site so nobody else can spend your Anthropic credits.

Local dev doesn't change. Without these variables the app uses `file:./dev.db`, the `.uploads/` folder and no password.

> Vercel's Hobby plan is for personal, non-commercial use.

## 1. Import the repo

1. Push this repo to GitHub (it is already public, and no secrets are committed).
2. Go to <https://vercel.com/new>, then **Import** the GitHub repo.
3. Leave the defaults: Framework **Next.js**, Build Command `npm run build` (it runs `prisma generate && next build`), Install Command `npm install` (`postinstall` also runs `prisma generate`). Node is pinned to 24.x by `engines` in package.json.
4. Click **Deploy**. The first deploy builds, but the app won't work until steps 2–5 are done. That's expected.

No `vercel.json` is needed. The route files set their own `maxDuration` (see [Function limits](#function-limits)), and sharp and libsql ship prebuilt Linux binaries that Next's file tracing bundles into the functions.

## 2. Add the database (Turso)

**Option A: Vercel Marketplace (recommended).**
Open the project, then **Storage → Create Database → Turso Cloud** (or go to <https://vercel.com/marketplace/tursocloud>). Create a database in a region near your functions (the default is `iad1`, US East), and connect it to the project for **Production** (and Preview if you want). This injects:

| Variable | Used as |
|---|---|
| `TURSO_DATABASE_URL` | database URL (fallback for `DATABASE_URL`) |
| `TURSO_AUTH_TOKEN` | auth token (fallback for `DATABASE_AUTH_TOKEN`) |

**Option B: turso CLI.**

```bash
turso db create studyforge
turso db show studyforge --url        # libsql://studyforge-<org>.turso.io
turso db tokens create studyforge     # long-lived auth token
```

Then add `DATABASE_URL` (the `libsql://…` URL) and `DATABASE_AUTH_TOKEN` in **Settings → Environment Variables**.

## 3. Add file storage (Vercel Blob)

Open the project, then **Storage → Create Database → Blob**. Choose **Private** access (your notes aren't public), and connect it to the project. This injects `BLOB_READ_WRITE_TOKEN`.

If you created the store as **Public**, also set `BLOB_ACCESS=public`.

Files go straight from the browser to Blob (client uploads, up to 25 MB per file, and only `.pdf .docx .txt .md` and images). The app's functions only ever receive small references, so Vercel's 4.5 MB request-body limit never applies.

## 4. Set the remaining environment variables

**Settings → Environment Variables** (Production, and Preview if you use it):

| Variable | Required on Vercel? | Value |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** (otherwise Demo mode) | `sk-ant-…` |
| `APP_PASSWORD` | **yes** | the password you'll type at `/login` |
| `APP_SECRET` | recommended | `openssl rand -base64 32`. It signs the session cookie; if unset, a key is derived from `APP_PASSWORD` |
| `ANTHROPIC_WORKSPACE_ID` | only if your key isn't workspace-scoped | `wrkspc_…` |
| `ANTHROPIC_MODEL` | no | defaults to `claude-opus-5-5` |
| `DATABASE_URL` + `DATABASE_AUTH_TOKEN` | only with Option B | from step 2 |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | injected by Option A | — |
| `BLOB_READ_WRITE_TOKEN` | **yes**, injected by step 3 | — |
| `BLOB_ACCESS` | only for a Public store | `public` |

Mark `ANTHROPIC_API_KEY`, `APP_PASSWORD`, `APP_SECRET` and the tokens as **Sensitive**.

## 5. Create the tables and seed the demo set

Prisma 7's `prisma migrate deploy` refuses `libsql://` URLs (error P1013), so the repo ships `npm run db:deploy`. It applies `prisma/migrations/*/migration.sql` to Turso with `@libsql/client`, one transaction per migration, and records each one in a `_studyforge_migrations` table. It is safe to run again.

Run these from your machine, in the repo, with the Turso URL and token in the environment:

```bash
# either export them…
export TURSO_DATABASE_URL="libsql://studyforge-<org>.turso.io"
export TURSO_AUTH_TOKEN="…"
npm run db:deploy
npm run db:seed:remote        # adds the "CFA Level II" demo set (idempotent)

# …or put them in a git-ignored env file and point the scripts at it
vercel env pull .env.vercel --environment=production   # sensitive values may come back empty; then use the Turso dashboard/CLI values
npm run db:deploy -- --env-file=.env.vercel
npm run db:seed:remote -- --env-file=.env.vercel
```

`DATABASE_URL=libsql://…` with `DATABASE_AUTH_TOKEN` works too. The remote scripts ignore a local `file:` `DATABASE_URL` from `.env`, and they refuse to run without a remote URL. `.env*` files are git-ignored. Never commit them.

Re-run `npm run db:deploy` whenever a new folder appears in `prisma/migrations`.

## 6. Redeploy and log in

**Deployments → ⋯ → Redeploy**, so the new environment variables take effect. Then open `https://<project>.vercel.app`, which redirects to `/login`. Enter `APP_PASSWORD`. The session cookie (httpOnly, Secure, SameSite=Lax) lasts 30 days, and **Log out** is in the header.

## Function limits

- `/api/generate` and `/api/context` export `maxDuration = 300`, the Hobby maximum with Fluid compute (on by default for new projects; Pro allows up to 800 s).
- Generation runs up to 3 parts at once (10-page PDF ranges, 8-image batches, text chunks). It stops starting new parts when about 100 s of the 280 s budget remain, and aborts anything still running at 280 s. You keep the cards generated so far, plus a warning listing the pages that were skipped. Save the set, then use **Add notes** to upload those pages.
- A 60-page slide deck is 6 parts, which is 2 rounds of 3 and normally finishes well inside the limit.

## Troubleshooting

| Symptom | Fix |
|---|---|
| 500s on every page, and the logs say "no remote database configured" | Steps 2 and 6: set the Turso variables, then redeploy |
| `no such table: StudySet` | Step 5: `npm run db:deploy` |
| "File uploads need a Vercel Blob store" | Step 3, then redeploy |
| Upload fails with an access error | The store's access doesn't match `BLOB_ACCESS` (default `private`) |
| "Too many attempts" at login | 5 wrong passwords per IP in 15 min (100 across all IPs). Wait 15 min, or redeploy to reset |
| Everyone was logged out | `APP_PASSWORD` or `APP_SECRET` changed. That's expected |
