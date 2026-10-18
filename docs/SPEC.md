# StudyForge — Spec (MVP)

StudyForge reads a student's notes and generates flashcards **in the context of what they are studying** (e.g. CFA Level II), then offers Quizlet-style study modes. Single user, no auth, local SQLite.

## Stack
Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · Prisma 7 (SQLite via `@prisma/adapter-libsql`) · `@anthropic-ai/sdk` · zod · mammoth (DOCX) · unpdf (PDF text) · vitest.

## Modes
- **Claude mode** — when `ANTHROPIC_API_KEY` is set. Model from `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
- **Demo mode** — no key. Offline heuristic generator, clearly labeled in the UI.

## Study context
`StudyContext = { name, domain, level, topicAreas[], conventions, source, confidence }`.
Inputs: exam/course name, syllabus file (PDF/DOCX/TXT/MD), and/or notes.
- Claude: `beta.messages.create`, `thinking: adaptive`, `output_config.effort: "low"`, structured output (JSON schema from zod), server-side fallbacks (`server-side-fallback-2026-07-01`, `fallbacks: "default"`). Syllabus PDFs go as native `document` blocks.
- Demo: name → built-in catalogue (`src/lib/contexts.ts`); otherwise keyword scoring of notes; syllabus headings → topic areas.
- When inferred (no name given), the UI asks "Looks like you're studying X — correct?" and lets the user edit every field. Context is saved on the set (`contextJson`) and injected into every generation prompt.

## Generation
- Card: front, back, type (definition | concept | formula | calculation | compare), topic (a context topic area), difficulty 1–3, source excerpt.
- Count: auto / 10 / 25 / 50.
- Notes → work items: small PDFs (≤ ~30k tokens of text, < 20 MB base64) go as native base64 `document` blocks; all other text is concatenated with per-file headers and chunked at headings → paragraphs → lines (~30k tokens per chunk). Nothing is truncated.
- Per item: `beta.messages.stream(...)` + `.finalMessage()`, effort `"medium"`, adaptive thinking, structured outputs, fallbacks. `stop_reason` is checked before reading content: `refusal` → warning, `max_tokens` → split the chunk in half and retry (up to 2 levels), invalid JSON → warning.
- De-dup across chunks and against existing set cards (token-Jaccard on fronts, plus front+back similarity).
- API `/api/generate` streams NDJSON events (`start`, `progress`, `cards`, `warning`, `done`, `error`) for the progress UI.
- Review screen: edit / delete / add cards before saving. Existing sets can "Add notes" and generate more (de-duped against existing cards).
- Errors: SDK typed errors mapped most-specific-first (auth → permission → rate limit → API status → connection) to friendly messages.

## Study modes
- **Flashcards**: 3D flip, Space = flip, ←/→ = move, shuffle, Know it (K / ↑) / Still learning (L / ↓), filter by topic or still-learning.
- **Match**: 6 term + 6 definition tiles, shuffled; select a term then its definition (either order). Matches vanish, wrong pairs flash red and add +1 s. Timer, per-set best time (saved on the set), Play again with a new random selection. Tap-friendly; long definitions are truncated with an expand button.
- **Learn / Test**: multiple-choice (distractors = other cards' definitions, same topic first) or written answers with lenient matching (normalization, Levenshtein, keyword coverage; "almost" verdict with "I was right" override). Score summary with missed cards.
- **Mastery**: per-card level 0–5 (mastered ≥ 3). Set progress bar + per-topic progress.

## Library
Home page lists sets with context badge, card count, mastery bar. Rename, delete, export CSV (Quizlet import: comma between term/definition, newline between cards).

## Data model
`StudySet (title, contextName, contextJson, contextConfirmed, bestMatchMs)` → `Card[]`, `NoteSource[]`.

## Seed / sample
`npm run db:seed` creates a "CFA Level II" set with 22 cards from `samples/cfa-level-2-notes.md`.
