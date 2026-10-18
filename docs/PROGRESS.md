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

## Known limitations
- The real Claude path is unit-tested with mocked SDK responses only (no API key in the build environment).
- Demo mode only understands explicit structures (term/definition lines, headings with bullets) and can't read images or scanned PDFs.
- Single user, no auth; mastery is a simple 0–5 counter, not spaced repetition.
