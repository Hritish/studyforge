/**
 * Generation orchestrator shared by demo and Claude modes:
 * notes → work items (chunks / native PDFs) → per-item generation → de-dup.
 */
import { chunkNotes, dedupeCards, DEFAULT_CHUNK_TOKENS, distributeCount, estimateTokens } from "./chunk";
import type { ParseResult } from "./ai/schema";
import { pdfFitsOneChunk } from "./ai/prompts";
import type { CardDraft, GenerationEvent, NoteInput, StudyContext } from "./types";

export interface WorkItem {
  label: string;
  text: string;
  pdfBase64?: string;
}

export interface ChunkGenerator {
  mode: "demo" | "claude";
  model?: string;
  /** Whether the generator accepts native PDF input. */
  supportsPdf: boolean;
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
 * Build work items. Small PDFs go as native documents (when supported); all
 * other text is concatenated with per-file headers and chunked at section
 * boundaries. Nothing is truncated.
 */
export function buildWorkItems(notes: NoteInput[], supportsPdf: boolean, maxTokens = DEFAULT_CHUNK_TOKENS): WorkItem[] {
  const items: WorkItem[] = [];
  const textParts: string[] = [];
  for (const n of notes) {
    if (!n.text.trim() && !n.pdfBase64) continue;
    // Native PDF input only when it fits one request (API limit ~32 MB request); else use extracted text chunks.
    if (supportsPdf && n.pdfBase64 && n.pdfBase64.length < 20_000_000 && pdfFitsOneChunk(n.text, maxTokens)) {
      items.push({ label: n.name, text: n.text, pdfBase64: n.pdfBase64 });
      continue;
    }
    textParts.push(notes.length > 1 ? `# ${n.name}\n\n${n.text.trim()}` : n.text.trim());
  }
  const combined = textParts.join("\n\n");
  const chunks = chunkNotes(combined, maxTokens);
  chunks.forEach((c, i) =>
    items.push({ label: chunks.length > 1 ? `Notes (part ${i + 1} of ${chunks.length})` : "Notes", text: c }),
  );
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
  const queue = buildWorkItems(opts.notes, gen.supportsPdf, maxTokens);
  if (queue.length === 0) {
    emit({ type: "error", message: "No notes text found. Paste notes or upload a file first." });
    return [];
  }
  const targets = opts.target ? distributeCount(queue.map((q) => q.text || "x".repeat(4000)), opts.target) : [];
  const work = queue.map((item, i) => ({ item, target: opts.target ? targets[i] : null, splits: 0 }));
  emit({ type: "start", mode: gen.mode, chunks: work.length, model: gen.model });

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
      if (res.reason === "max_tokens" && !w.item.pdfBase64 && w.splits < 2 && estimateTokens(w.item.text) > 1000) {
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
