# StudyForge — Spec (MVP)

StudyForge reads a student's notes and generates flashcards **in the context of what they are studying** (e.g. CFA Level II), then offers Quizlet-style study modes. Single user. Local dev: SQLite file, no auth. Hosted: Vercel Hobby + Turso + Vercel Blob behind a password gate (docs/DEPLOY.md).

## Stack
Next.js 16 (App Router, Turbopack, `proxy.ts`) · TypeScript · Tailwind v4 · Prisma 7 (SQLite/Turso via `@prisma/adapter-libsql`) · `@vercel/blob` · `@anthropic-ai/sdk` · zod · mammoth (DOCX) · unpdf (PDF text) · sharp (image downscaling) · vitest.

## Modes
- **Claude mode** — when `ANTHROPIC_API_KEY` is set. Model from `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
- **Demo mode** — no key. Offline heuristic generator, clearly labeled in the UI.

## Study context
`StudyContext = { name, domain, level, topicAreas[], conventions, source, confidence }`.
Inputs: exam/course name, syllabus file (PDF/DOCX/TXT/MD/image), and/or notes (text and/or slide images).
- Claude: `beta.messages.create`, `thinking: adaptive`, `output_config.effort: "low"`, structured output (JSON schema from zod), server-side fallbacks (`server-side-fallback-2026-07-01`, `fallbacks: "default"`). Syllabus PDFs go as native `document` blocks; up to 6 slide images (syllabus image first) go as `image` blocks before the text, so e.g. a CFA slide deck is recognized.
- Demo: images are ignored (with the API-key notice); name → built-in catalogue (`src/lib/contexts.ts`); otherwise keyword scoring of notes; syllabus headings → topic areas.
- When inferred (no name given), the UI asks "Looks like you're studying X — correct?" and lets the user edit every field. Context is saved on the set (`contextJson`) and injected into every generation prompt.

## Generation
- Card: front, back, type (definition | concept | formula | calculation | compare), topic (a context topic area), difficulty 1–3, source excerpt.
- Count: auto / 10 / 25 / 50.
- Notes → work items: small PDFs (≤ ~30k tokens of text, < 20 MB base64) go as native base64 `document` blocks; all other text is concatenated with per-file headers and chunked at headings → paragraphs → lines (~30k tokens per chunk). Nothing is truncated.
- Per item: `beta.messages.stream(...)` + `.finalMessage()`, effort `"medium"`, adaptive thinking, structured outputs, fallbacks. `stop_reason` is checked before reading content: `refusal` → warning, `max_tokens` → split the chunk in half and retry (up to 2 levels), invalid JSON → warning.
- Work items run **3 at a time**. Results are committed strictly in work-item order: a finished item waits for all earlier items, then its cards are de-duped against existing cards and everything committed so far. Output and de-dup therefore match a sequential run, whatever order requests finish in. Each item's prompt lists the existing cards plus all cards finished so far. A `max_tokens` split replaces the item in place.
- **Time budget** (on Vercel, or with `GENERATION_TIME_BUDGET_SECONDS`): the routes export `maxDuration = 300` (Hobby max). Generation stops at 280 s; no new item starts in the last ~100 s (35 % of the budget, at most 100 s), and items still running at 280 s are aborted (the SDK request is cancelled). Cards so far are returned (`done.skipped` lists the skipped parts) with a warning to add the remaining pages separately. Locally there is no budget.
- De-dup across chunks and against existing set cards (token-Jaccard on fronts, plus front+back similarity).
- API `/api/generate` streams NDJSON events (`start`, `progress` {chunk, chunks, done}, `cards` (in order), `warning`, `done` {skipped?}, `error`) for the progress UI ("N of M parts done").
- Review screen: edit / delete / add cards before saving. Existing sets can "Add notes" and generate more (de-duped against existing cards).
- Errors: SDK typed errors mapped most-specific-first (auth → permission → rate limit → API status → connection) to friendly messages.

## Images (slide screenshots)
- Upload `.png/.jpg/.jpeg/.webp/.gif` in notes and syllabus inputs (multiple, drag-and-drop) or Ctrl+V a screenshot into the notes box. Thumbnails + full preview are shown.
- Server: sharp downscales so the longest side ≤ 1568px, re-encodes as JPEG (flattened, first GIF frame) and steps quality/size down until ≤ 3.75 MB (≈ 5 MB base64, the per-image API limit).
- Claude: images become `{type: "image", source: {type: "base64", media_type, data}}` blocks, each preceded by a label text block ("Slide image N (file: …)"), all **before** the instruction text. Images are numbered globally and batched (≤ 8 images and ≤ 16 MB base64 per request); a batch that hits `max_tokens` is halved and retried. Cards are de-duped across batches and text chunks.
- Prompt: images are lecture slides/screenshots; read text, formulas, tables and diagrams; ignore UI chrome, slide numbers and footers; ground only in what's visible; `source` starts with the image label ("Slide image 3: …").
- Demo mode: images are accepted but skipped with "Reading screenshots requires an Anthropic API key — add ANTHROPIC_API_KEY to .env"; text notes still generate. Images only → that message as the error.
- Image binaries are not stored in the DB (only a NoteSource row with kind `image`).

## Uploads and file store
- `FileStore` interface (`src/lib/files/store.ts`): **Vercel Blob** when `BLOB_READ_WRITE_TOKEN` is set (access `BLOB_ACCESS`, default private), otherwise a **local directory** (`.uploads/`, git-ignored). Keys are `uploads/<random id>/<sanitized name>`; anything else is rejected (no traversal, no other blobs).
- Hosted: the browser calls `upload()` from `@vercel/blob/client`. `/api/upload` (`handleUpload`) issues a 10-minute token restricted to the supported content types and 25 MB, and refuses non-`uploads/` paths. No `onUploadCompleted` callback is registered, so Vercel Blob never calls the app and nothing has to bypass the password gate. The browser then calls `/api/files/ingest {key, name}`.
- Local: the browser posts the file to `/api/files` (multipart), which stores and ingests it.
- Ingest (server): `.txt/.md/.docx` → text (unpdf/mammoth), stored copy deleted. PDF → text + page count, kept in the store. Image → sharp downscale to JPEG, which replaces the original. Returns a `FileRef` {fileId?, name, kind, text, chars, mediaType, pages, width, height}. Thumbnails use a local `blob:` URL of the original file.
- `/api/context` and `/api/generate` take notes as `{name, kind, text, fileId?, mediaType?}`; inline base64 is stripped by the schema. The server fetches PDF and image bytes from the store only when the engine can use them (not in demo mode). The browser refuses to send any JSON body over 4 MB (`jsonBody`). A 60-page scanned PDF plus 30 screenshots is a few KB.
- Cleanup: saving a set (`files: [...]` on `/api/sets` and `/api/sets/:id/cards`) deletes its stored files after the response. Removing a file in the UI calls `DELETE /api/files`. Uploads older than 24 h are swept at most every 10 min per instance (triggered by uploads).

## Password gate
- Enabled only when `APP_PASSWORD` is set. `src/proxy.ts` (Next 16 proxy, Node runtime) gates every path except `/login`, `/api/login`, `/api/logout`, `/_next/*` and root-level static files: pages redirect to `/login?next=…`, API routes return 401. The upload, files, context and generate routes re-check the cookie.
- Cookie `sf_session` = `v1.<expiry>.<base64url HMAC-SHA256(key, "v1.<expiry>")>`; key = SHA-256 of `APP_SECRET`, or HMAC of `APP_PASSWORD` when no secret is set. Settings: httpOnly, `Secure` in production, `SameSite=Lax`, `Path=/`, 30 days. Verification uses `timingSafeEqual`.
- Login: form POST → constant-time compare (SHA-256 digests + `timingSafeEqual`) → 303 to a same-site `next`. Rate limit (in memory, per instance): 5 failures per IP per 15 min, 100 across all IPs. Log out from the header.

## Study modes
- **Flashcards**: 3D flip, Space = flip, ←/→ = move, shuffle, Know it (K / ↑) / Still learning (L / ↓), filter by topic or still-learning.
- **Match**: 6 term + 6 definition tiles, shuffled; select a term then its definition (either order). Matches vanish, wrong pairs flash red and add +1 s. Timer, per-set best time (saved on the set), Play again with a new random selection. Tap-friendly; long definitions are truncated with an expand button.
- **Learn / Test**: multiple-choice (distractors = other cards' definitions, same topic first) or written answers with lenient matching (normalization, Levenshtein, keyword coverage; "almost" verdict with "I was right" override). Score summary with missed cards.
- **Mastery**: per-card level 0–5 (mastered ≥ 3). Set progress bar + per-topic progress.

## Library
Home page lists sets with context badge, card count, mastery bar. Rename, delete, export CSV (Quizlet import: comma between term/definition, newline between cards).

## Database
- `DATABASE_URL` (else `TURSO_DATABASE_URL`, else `file:./dev.db`) + `DATABASE_AUTH_TOKEN` (else `TURSO_AUTH_TOKEN`) → `PrismaLibSql({ url, authToken })`.
- Prisma 7 `migrate deploy` rejects `libsql://` (P1013), so `npm run db:deploy` (`src/lib/migrations.ts`) applies `prisma/migrations/*/migration.sql` with `@libsql/client`, one batch transaction per migration together with its row in `_studyforge_migrations` (name, sha256, time). It is idempotent and warns if an applied file changed. `npm run db:seed:remote` seeds Turso.

## Data model
`StudySet (title, contextName, contextJson, contextConfirmed, bestMatchMs)` → `Card[]`, `NoteSource[]`.

## Seed / sample
`npm run db:seed` creates a "CFA Level II" set with 22 cards from `samples/cfa-level-2-notes.md`.
