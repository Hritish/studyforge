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
}

export async function runGeneration(
  opts: RunOptions,
  gen: ChunkGenerator,
  emit: (e: GenerationEvent) => void,
): Promise<CardDraft[]> {
  const maxTokens = opts.maxChunkTokens ?? DEFAULT_CHUNK_TOKENS;
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
  const work = queue.map((item, i) => ({ item, target: opts.target ? targets[i] : null, splits: 0 }));
  emit({ type: "start", mode: gen.mode, chunks: work.length, model: gen.model });
  for (const message of buildWarnings) emit({ type: "warning", message });
  if (skippedImages) {
    emit({ type: "warning", message: `${IMAGES_NEED_KEY_MESSAGE}. Skipped ${skippedImages} image${skippedImages === 1 ? "" : "s"}; generated from your text notes only.` });
  }

  const all: CardDraft[] = [];
  let removed = 0;
  let failures = 0;
  let total = work.length;
  for (let i = 0; i < work.length; i++) {
    const w = work[i];
    emit({ type: "progress", chunk: i + 1, chunks: total, message: `Reading ${w.item.label}…` });
    const existingFronts = [...opts.existing.map((e) => e.front), ...all.map((c) => c.front)];
    const res = await gen.generate({
      item: w.item,
      index: i,
      count: total,
      target: w.target,
      context: opts.context,
      existingFronts,
      onDelta: (chars) =>
        emit({ type: "progress", chunk: i + 1, chunks: total, message: `Writing cards for ${w.item.label}… (${Math.round(chars / 1000)}k chars)` }),
    });

    if (!res.ok) {
      if (res.reason === "max_tokens" && w.item.images && w.item.images.length > 1 && w.splits < 2) {
        // Too much output for this image batch: halve it.
        const mid = Math.ceil(w.item.images.length / 2);
        const halves = [w.item.images.slice(0, mid), w.item.images.slice(mid)];
        work.splice(
          i + 1,
          0,
          ...halves.map((h) => ({ item: { label: batchLabel(h), text: "", images: h }, target: w.target ? Math.ceil(w.target / 2) : null, splits: w.splits + 1 })),
        );
        total = work.length;
        emit({ type: "warning", message: `${w.item.label} produced too much output; splitting it into smaller batches.` });
        continue;
      }
      if (res.reason === "max_tokens" && !w.item.pdfBase64 && !w.item.images && w.splits < 2 && estimateTokens(w.item.text) > 1000) {
        // Too much output for one request: split this chunk in half and retry both halves.
        const halves = chunkNotes(w.item.text, Math.ceil(estimateTokens(w.item.text) / 2));
        const t = w.target ? distributeCount(halves, w.target) : [];
        work.splice(
          i + 1,
          0,
          ...halves.map((h, k) => ({
            item: { label: `${w.item.label} (${k + 1}/${halves.length})`, text: h },
            target: w.target ? t[k] : null,
            splits: w.splits + 1,
          })),
        );
        total = work.length;
        emit({ type: "warning", message: `${w.item.label} produced too much output; splitting it into smaller parts.` });
        continue;
      }
      failures++;
      emit({ type: "warning", message: `${w.item.label}: ${res.message}` });
      continue;
    }

    const d = dedupeCards(res.data, [...opts.existing, ...all]);
    removed += d.removed;
    all.push(...d.cards);
    emit({ type: "cards", chunk: i + 1, cards: d.cards });
  }

  let final = all;
  if (opts.target && final.length > Math.ceil(opts.target * 1.2)) final = final.slice(0, Math.ceil(opts.target * 1.2));
  if (final.length === 0 && failures > 0) {
    emit({ type: "error", message: "No cards could be generated. See the warnings above." });
    return [];
  }
  emit({ type: "done", cards: final, removedDuplicates: removed });
  return final;
}
