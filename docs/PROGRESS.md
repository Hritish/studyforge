# Progress

## Milestone 1 — Core library (done)
- Next.js 16 + Tailwind + Prisma 7/SQLite scaffold; schema + initial migration.
- Study context catalogue, demo generator, chunking/de-dup, generation orchestrator.
- Claude integration: request builders, streaming, structured-output parsing, refusal/max_tokens handling, fallbacks, friendly errors.
- Study logic: match game reducer, MCQ builder, lenient answer matching, mastery, CSV export.
- Seed (CFA Level II, 22 cards) + `samples/cfa-level-2-notes.md`.
- 65 vitest unit tests passing.

## Milestone 2 — App (done)
- API routes (extract, context, NDJSON-streamed generate, sets, cards, progress, export, sample).
- UI: landing + library, create flow (context confirm, progress, review/edit), set overview (progress per topic, context editing, card CRUD), Flashcards, Match, Learn/Test.
- Smoke test (`npm run smoke`) covering the full demo-mode flow; visual check with headless Chromium (desktop + mobile).

## Milestone 3 — Slide screenshots (done)
- Image upload (multi, drag-and-drop, clipboard paste) with thumbnails/preview, sharp downscaling (≤1568px, ≤3.75 MB JPEG).
- Claude vision: base64 image blocks before the instruction, batched 8/request, de-duped across batches; context detection from images.
- Demo mode notice for images; text notes still generate.
- Tests: image prep with fixture `tests/fixtures/cfa-slide.png`, block building, batching, mocked-SDK generation across batches, demo behavior. 77 unit tests, 42 smoke checks.

## Milestone 4 — Deployable to Vercel Hobby (done)
- Password gate (`APP_PASSWORD`, `APP_SECRET`): `src/proxy.ts`, HMAC session cookie, login page, rate limit, logout in the header. Off when unset.
- Turso: `authToken` support, `TURSO_*` fallbacks, `npm run db:deploy` (Prisma migrate can't target libsql://), `npm run db:seed:remote`; `prisma generate` no longer needs `DATABASE_URL`.
- Uploads re-architected around a file store: Vercel Blob client uploads (25 MB, typed) when hosted, `.uploads/` locally. Requests carry references + text only; the server fetches bytes for Claude. Files are deleted on save, and swept after 24 h.
- Generation: 3 concurrent parts with ordered commit and de-dup, `maxDuration = 300`, and a time budget that returns partial results with a warning.
- `.env.example` documents every variable; `docs/DEPLOY.md` has the step-by-step guide.
- Tests: 118 unit tests (auth cookie/gate paths/rate limit, local store + ingest, runner ordering/de-dup/time budget/abort, reference-only payload size, migrations on a temp DB, DB config). Smoke test updated for the new upload flow: 49 checks without a password, 64 with `APP_PASSWORD` (demo mode), and a Claude-mode run with one small real generation.

## Known limitations
- The real Claude path is mostly unit-tested with mocked SDK responses; the smoke test makes one small real generation when the server has a key.
- Demo mode only understands explicit structures (term/definition lines, headings with bullets) and can't read images or scanned PDFs.
- Single user (one shared password, no accounts); mastery is a simple 0–5 counter, not spaced repetition.
- The Vercel Blob path (client upload → ingest) can't be exercised without a Blob token; the local store behind the same interface is what the tests and smoke test cover.
- The login rate limit and the sweep throttle are per server instance (in memory).
- Generation is capped by the 300 s function limit on Hobby; very large uploads may return partial results, and the rest must be added with "Add notes".
