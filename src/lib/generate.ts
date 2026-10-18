/**
 * Generation orchestrator shared by demo and Claude modes:
 * notes → work items (chunks / native PDFs) → per-item generation → de-dup.
 */
import { chunkNotes, dedupeCards, DEFAULT_CHUNK_TOKENS, distributeCount, estimateTokens } from "./chunk";
import type { ParseResult } from "./ai/schema";
import { batchImages, batchLabel, toSlideImages, type SlideImage } from "./ai/images";
import { splitPdf } from "./pdf";
import { IMAGES_NEED_KEY_MESSAGE, SCANNED_PDF_NEEDS_KEY_MESSAGE, type CardDraft, type GenerationEvent, type NoteInput, type StudyContext } from "./types";

export interface WorkItem {
  label: string;
  text: string;
  pdfBase64?: string;
  /** Page range of the original PDF that `pdfBase64` covers. */
  pdfPages?: { from: number; to: number; total: number };
  images?: SlideImage[];
}

export interface ChunkGenerator {
  mode: "demo" | "claude";
  model?: string;
  /** Whether the generator accepts native PDF input. */
  supportsPdf: boolean;
  /** Whether the generator can read images (vision). */
  supportsImages: boolean;
  generate(req: {
    item: WorkItem;
    index: number;
    count: number;
    target: number | null;
    context: StudyContext;
    existingFronts: string[];
    onDelta?: (chars: number) => void;
    /** Aborted when the time budget runs out while this part is in flight. */
    signal?: AbortSignal;
  }): Promise<ParseResult<CardDraft[]>>;
}

/**
 * Build work items. With a vision-capable generator every PDF goes as native
 * page ranges, so slide screenshots and handwriting on the pages are read, not
 * just the text layer. Other text is concatenated with per-file headers and
 * chunked at section boundaries. Nothing is truncated.
 */
export async function buildWorkItems(
  notes: NoteInput[],
  caps: { pdf: boolean; images: boolean },
  maxTokens = DEFAULT_CHUNK_TOKENS,
  warnings: string[] = [],
): Promise<WorkItem[]> {
  const supportsPdf = caps.pdf;
  const items: WorkItem[] = [];
  const textParts: string[] = [];
  for (const n of notes) {
    if (n.kind === "image") continue; // handled below

    if (!n.text.trim() && !n.pdfBase64) continue;
    if (supportsPdf && n.pdfBase64) {
      try {
        const parts = await splitPdf(n.pdfBase64);
        const total = parts.length ? parts[parts.length - 1].to : 0;
        for (const p of parts) {
          const label = parts.length > 1 ? `${n.name} (pages ${p.from}–${p.to} of ${total})` : n.name;
          items.push({ label, text: "", pdfBase64: p.base64, pdfPages: { from: p.from, to: p.to, total } });
        }
        continue;
      } catch (err) {
        const why = err instanceof Error ? err.message : "it could not be split into pages";
        if (!n.text.trim()) {
          warnings.push(`Skipped ${n.name}: ${why}`);
          continue;
        }
        warnings.push(`Couldn't send ${n.name} as pages (${why}); used its text only, so images on its pages were not read.`);
      }
    }
    if (!n.text.trim()) {
      warnings.push(`Skipped ${n.name}: ${SCANNED_PDF_NEEDS_KEY_MESSAGE}`);
      continue;
    }
    textParts.push(notes.length > 1 ? `# ${n.name}\n\n${n.text.trim()}` : n.text.trim());
  }
  const combined = textParts.join("\n\n");
  const chunks = chunkNotes(combined, maxTokens);
  chunks.forEach((c, i) =>
    items.push({ label: chunks.length > 1 ? `Notes (part ${i + 1} of ${chunks.length})` : "Notes", text: c }),
  );
  // Slide images: batched into several moderately sized requests.
  if (caps.images) {
    for (const batch of batchImages(toSlideImages(notes))) items.push({ label: batchLabel(batch), text: "", images: batch });
  }
  return items;
}

export interface RunOptions {
  notes: NoteInput[];
  context: StudyContext;
  target: number | null;
  existing: { front: string; back: string }[];
  maxChunkTokens?: number;
  /** Parts generated at the same time (default 3). */
  concurrency?: number;
  /**
   * Absolute time (ms) by which generation must have finished, e.g. the
   * function's start + maxDuration minus a safety margin. In-flight parts still
   * running at the deadline are aborted and reported as skipped.
   */
  deadline?: number;
  /** No new part is started when less than this much time is left before `deadline` (default 100 s). */
  reserveMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_RESERVE_MS = 100_000;

type SlotState = "pending" | "running" | "done" | "failed" | "skipped";
interface Slot {
  item: WorkItem;
  target: number | null;
  splits: number;
  state: SlotState;
  cards?: CardDraft[];
}

const TIMED_OUT = Symbol("timed-out");

/**
 * Run every work item through the generator, up to `concurrency` at a time.
 * Results are committed strictly in work-item order: a finished part waits
 * until every part before it has finished, then its cards are de-duplicated
 * against the existing cards and everything committed so far. The output (and
 * the de-dup) is therefore the same as a sequential run, whatever order the
 * requests finish in.
 */
export async function runGeneration(
  opts: RunOptions,
  gen: ChunkGenerator,
  emit: (e: GenerationEvent) => void,
): Promise<CardDraft[]> {
  const maxTokens = opts.maxChunkTokens ?? DEFAULT_CHUNK_TOKENS;
  const now = opts.now ?? Date.now;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const reserveMs = opts.reserveMs ?? DEFAULT_RESERVE_MS;
  const buildWarnings: string[] = [];
  const queue = await buildWorkItems(opts.notes, { pdf: gen.supportsPdf, images: gen.supportsImages }, maxTokens, buildWarnings);
  const skippedImages = gen.supportsImages ? 0 : opts.notes.filter((n) => n.kind === "image").length;
  if (queue.length === 0) {
    const reason = buildWarnings[0] ?? (skippedImages ? `${IMAGES_NEED_KEY_MESSAGE}.` : "No notes text found. Paste notes or upload a file first.");
    emit({ type: "error", message: reason });
    return [];
  }
  // Images and PDF pages count as ~1 page of text each when splitting the target count.
  const weight = (q: WorkItem) =>
    q.text || "x".repeat(4000 * Math.max(1, q.images?.length ?? (q.pdfPages ? q.pdfPages.to - q.pdfPages.from + 1 : 1)));
  const targets = opts.target ? distributeCount(queue.map(weight), opts.target) : [];
  const slots: Slot[] = queue.map((item, i) => ({ item, target: opts.target ? targets[i] : null, splits: 0, state: "pending" }));
  emit({ type: "start", mode: gen.mode, chunks: slots.length, model: gen.model });
  for (const message of buildWarnings) emit({ type: "warning", message });
  if (skippedImages) {
    emit({ type: "warning", message: `${IMAGES_NEED_KEY_MESSAGE}. Skipped ${skippedImages} image${skippedImages === 1 ? "" : "s"}; generated from your text notes only.` });
  }

  const all: CardDraft[] = [];
  let removed = 0;
  let failures = 0;
  let committed = 0;
  let finished = 0;
  const skipped: string[] = [];
  const isTerminal = (s: Slot) => s.state === "done" || s.state === "failed" || s.state === "skipped";

  /** Commit finished slots at the front of the list, in order. */
  const commitReady = () => {
    while (committed < slots.length && isTerminal(slots[committed])) {
      const s = slots[committed];
      if (s.state === "done" && s.cards) {
        const d = dedupeCards(s.cards, [...opts.existing, ...all]);
        removed += d.removed;
        all.push(...d.cards);
        emit({ type: "cards", chunk: committed + 1, cards: d.cards });
      }
      committed++;
    }
  };

  const timeLow = () => opts.deadline !== undefined && now() >= opts.deadline - reserveMs;

  async function runSlot(slot: Slot): Promise<void> {
    const pos = () => slots.indexOf(slot) + 1;
    emit({ type: "progress", chunk: pos(), chunks: slots.length, done: finished, message: `Reading ${slot.item.label}…` });
    // Fronts known so far: existing cards, committed cards, and finished-but-uncommitted parts.
    const existingFronts = [
      ...opts.existing.map((e) => e.front),
      ...all.map((c) => c.front),
      ...slots.slice(committed).flatMap((s) => (s.state === "done" && s.cards ? s.cards.map((c) => c.front) : [])),
    ];
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = gen.generate({
      item: slot.item,
      index: pos() - 1,
      count: slots.length,
      target: slot.target,
      context: opts.context,
      existingFronts,
      signal: abort.signal,
      onDelta: (chars) =>
        emit({ type: "progress", chunk: pos(), chunks: slots.length, done: finished, message: `Writing cards for ${slot.item.label}… (${Math.round(chars / 1000)}k chars)` }),
    });
    const res =
      opts.deadline === undefined
        ? await work
        : await Promise.race([
            work,
            new Promise<typeof TIMED_OUT>((resolve) => {
              timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, opts.deadline! - now()));
            }),
          ]);
    if (timer) clearTimeout(timer);

    if (res === TIMED_OUT) {
      abort.abort();
      work.catch(() => undefined);
      slot.state = "skipped";
      skipped.push(slot.item.label);
      finished++;
      return;
    }

    if (!res.ok) {
      const at = slots.indexOf(slot);
      if (res.reason === "max_tokens" && slot.item.images && slot.item.images.length > 1 && slot.splits < 2) {
        // Too much output for this image batch: halve it.
        const mid = Math.ceil(slot.item.images.length / 2);
        const halves = [slot.item.images.slice(0, mid), slot.item.images.slice(mid)];
        slots.splice(
          at,
          1,
          ...halves.map((h): Slot => ({ item: { label: batchLabel(h), text: "", images: h }, target: slot.target ? Math.ceil(slot.target / 2) : null, splits: slot.splits + 1, state: "pending" })),
        );
        emit({ type: "warning", message: `${slot.item.label} produced too much output; splitting it into smaller batches.` });
        return;
      }
      if (res.reason === "max_tokens" && !slot.item.pdfBase64 && !slot.item.images && slot.splits < 2 && estimateTokens(slot.item.text) > 1000) {
        // Too much output for one request: split this chunk in half and retry both halves.
        const halves = chunkNotes(slot.item.text, Math.ceil(estimateTokens(slot.item.text) / 2));
        const t = slot.target ? distributeCount(halves, slot.target) : [];
        slots.splice(
          at,
          1,
          ...halves.map((h, k): Slot => ({
            item: { label: `${slot.item.label} (${k + 1}/${halves.length})`, text: h },
            target: slot.target ? t[k] : null,
            splits: slot.splits + 1,
            state: "pending",
          })),
        );
        emit({ type: "warning", message: `${slot.item.label} produced too much output; splitting it into smaller parts.` });
        return;
      }
      failures++;
      slot.state = "failed";
      finished++;
      emit({ type: "warning", message: `${slot.item.label}: ${res.message}` });
      return;
    }
    slot.state = "done";
    slot.cards = res.data;
    finished++;
  }

  const running = new Map<Slot, Promise<void>>();
  for (;;) {
    while (running.size < concurrency) {
      const next = slots.find((s) => s.state === "pending");
      if (!next) break;
      if (timeLow()) {
        for (const s of slots) {
          if (s.state !== "pending") continue;
          s.state = "skipped";
          skipped.push(s.item.label);
          finished++;
        }
        break;
      }
      next.state = "running";
      const p = runSlot(next)
        .catch((err) => {
          next.state = "failed";
          failures++;
          finished++;
          emit({ type: "warning", message: `${next.item.label}: ${err instanceof Error ? err.message : "failed"}` });
        })
        .finally(() => {
          running.delete(next);
          commitReady();
        });
      running.set(next, p);
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  commitReady();

  if (skipped.length) {
    const done = slots.length - skipped.length;
    emit({
      type: "warning",
      message: `Ran out of time after ${done} of ${slots.length} parts, so these were not generated: ${skipped.join("; ")}. Save these cards, then use "Add notes" on the set to add the remaining pages separately.`,
    });
  }

  let final = all;
  if (opts.target && final.length > Math.ceil(opts.target * 1.2)) final = final.slice(0, Math.ceil(opts.target * 1.2));
  if (final.length === 0 && (failures > 0 || skipped.length > 0)) {
    emit({ type: "error", message: skipped.length ? "Ran out of time before any cards were generated. Try fewer pages at once." : "No cards could be generated. See the warnings above." });
    return [];
  }
  emit({ type: "done", cards: final, removedDuplicates: removed, ...(skipped.length ? { skipped } : {}) });
  return final;
}
