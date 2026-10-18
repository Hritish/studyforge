# StudyForge

StudyForge turns a student's notes into **exam-ready flashcards in the context of what they're studying** (e.g. *CFA Level II*), then drills them with Quizlet-style study modes.

- **Study context**: type an exam/course, upload a syllabus, or let StudyForge infer it from your notes ("Looks like you're studying CFA Level II — correct?"). Cards use that exam's terminology, emphasize what's testable, include formulas, and are tagged by syllabus topic area.
- **Notes in any form**: paste text, or upload `.txt`, `.md`, `.pdf`, `.docx` and **slide screenshots** (`.png`, `.jpg`, `.webp`, `.gif`) — several at once, drag-and-drop, or Ctrl+V a screenshot. Long notes are chunked by section, never truncated.
- **Review before saving**: edit, delete or add cards. Add more notes to a set later; duplicates are skipped.
- **Study modes**: Flashcards (flip, keyboard shortcuts, shuffle, know-it/still-learning, topic filters), Match (timed 6×2 grid, +1s penalties, best time per set, touch-friendly), Learn/Test (multiple choice + written answers with lenient matching, score summary with missed cards).
- **Progress**: per-card mastery, per-set and per-topic progress bars.
- **Library**: rename, delete, export to CSV (Quizlet-importable).

Single user, no auth, local SQLite.

## Setup

Requires Node 24+ and npm 11.

```bash
npm install          # install scripts for prisma/esbuild are pre-approved in package.json "allowScripts"
cp .env.example .env # DATABASE_URL="file:./dev.db"
npm run db:setup     # apply migrations, generate Prisma client, seed the CFA Level II demo set
```

## Run

```bash
npm run dev          # http://localhost:3100 (dev)
# or production:
npm run build && npm start   # http://localhost:3100
```

## Demo mode vs. Claude

Without an API key the app runs fully in **Demo mode** (labeled in the header and on the create page): cards are extracted offline from lines such as `Term: definition`, `Term - definition`, `Term = formula` and markdown headings with bullets, and the study context is detected by keyword matching against a small built-in catalogue. Images can be uploaded but **can't be read in Demo mode**: you'll see *"Reading screenshots requires an Anthropic API key — add ANTHROPIC_API_KEY to .env"*, and any text notes are still used.

To use Claude, add your key to `.env` and restart:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# optional, defaults to claude-opus-5-5
ANTHROPIC_MODEL=claude-opus-5-5
```

The Claude path uses the official `@anthropic-ai/sdk`: adaptive thinking, explicit effort (`medium` for cards, `low` for context detection), structured outputs (JSON schema from zod), streaming with `.finalMessage()`, server-side refusal fallbacks (`fallbacks: "default"`), native PDF `document` blocks, and base64 `image` blocks for slide screenshots (downscaled to ≤1568px with sharp and batched 8 per request).

## Try the sample

1. Open http://localhost:3100 and click **Try the CFA Level II demo** to study the seeded 22-card set.
2. Click **+ New set** → **Use sample CFA notes** (or upload `samples/cfa-level-2-notes.md`) → **Continue**. StudyForge asks *"Looks like you're studying CFA Level II — correct?"* → **Yes, generate cards** → review → **Save study set**.
3. Try uploading `tests/fixtures/cfa-slide.png` or pasting a screenshot (needs an API key to be read).

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Vitest unit tests (demo generator, prompt building & response parsing with mocked SDK, chunking/de-dup, image blocks & batching, match game, answer matching, mastery, CSV) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run smoke` | End-to-end demo-mode flow against a running server (`BASE_URL`, default `http://localhost:3100`) |
| `npm run db:seed` / `npm run db:reset` | Re-seed the demo set / reset the database |

## Project layout

```
src/lib/ai/        Claude request building, prompts, image blocks, response parsing
src/lib/demo/      offline demo generator + keyword context detection
src/lib/study/     match game, learn/MCQ, answer matching, mastery
src/lib/generate.ts  chunking → work items (text chunks, PDFs, image batches) → de-dup
src/app/api/       route handlers (extract, context, generate [NDJSON stream], sets, cards, export)
src/components/    create flow, set overview, study modes
docs/SPEC.md, docs/PROGRESS.md
```
