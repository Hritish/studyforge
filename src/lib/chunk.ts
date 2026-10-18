import type { CardDraft } from "./types";

/** Rough token estimate (~4 chars/token for English prose). Good enough for chunk sizing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const DEFAULT_CHUNK_TOKENS = 30_000;

/**
 * Split long notes into chunks of at most `maxTokens` (estimated), preferring
 * section boundaries (markdown headings), then paragraphs, then lines, and only
 * as a last resort hard-splitting a giant paragraph. Nothing is dropped:
 * joining the chunks reproduces every non-blank line of the input.
 */
export function chunkNotes(text: string, maxTokens = DEFAULT_CHUNK_TOKENS): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (estimateTokens(clean) <= maxTokens) return [clean];

  const maxChars = maxTokens * 4;
  // 1) Split into sections at headings (keep heading with its body).
  const sections = splitKeep(clean, /^(?=#{1,6}\s)/m);
  // 2) Any section still too big → paragraphs → lines → hard split.
  const pieces: string[] = [];
  for (const s of sections) pieces.push(...splitToFit(s, maxChars));
  // 3) Greedily pack pieces into chunks.
  const chunks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    const candidate = cur ? `${cur}\n\n${p}` : p;
    if (candidate.length > maxChars && cur) {
      chunks.push(cur.trim());
      cur = p;
    } else {
      cur = candidate;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function splitKeep(text: string, re: RegExp): string[] {
  return text
    .split(re)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitToFit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 1) return paras.flatMap((p) => splitToFit(p, maxChars));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines.flatMap((l) => splitToFit(l, maxChars));
  // A single enormous line: split on sentence boundaries, then hard split.
  const out: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > maxChars && cur) {
      out.push(cur.trim());
      cur = "";
    }
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars).trim());
    } else {
      cur += s;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Distribute a target card count across chunks proportionally to their size (min 1 each). */
export function distributeCount(chunks: string[], total: number): number[] {
  if (chunks.length === 0) return [];
  const sizes = chunks.map((c) => Math.max(1, c.length));
  const sum = sizes.reduce((a, b) => a + b, 0);
  const raw = sizes.map((s) => (s / sum) * total);
  const out = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  // Hand out the remainder to the chunks with the largest fractional part.
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; diff > 0 && k < order.length * 4; k++, diff--) out[order[k % order.length].i]++;
  return out;
}

// ---------- de-duplication ----------

const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "to", "in", "on", "for", "is", "are", "what",
  "which", "how", "does", "do", "define", "explain", "describe", "with", "by", "its", "it",
  "be", "as", "at", "that", "this", "vs", "versus",
]);

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9/+\-=().\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .replace(/[().?]/g, " ")
      .split(" ")
      .filter((t) => t && !STOPWORDS.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** True when two cards test the same thing. */
export function isDuplicate(a: Pick<CardDraft, "front" | "back">, b: Pick<CardDraft, "front" | "back">): boolean {
  const fa = tokens(a.front);
  const fb = tokens(b.front);
  if (fa.size === 0 || fb.size === 0) return normalizeText(a.front) === normalizeText(b.front);
  const frontSim = jaccard(fa, fb);
  if (frontSim >= 0.8) return true;
  if (frontSim >= 0.5 && jaccard(tokens(a.back), tokens(b.back)) >= 0.5) return true;
  return false;
}

/**
 * Remove cards that duplicate each other or any of `existing`. Keeps the first
 * occurrence (so earlier chunks win). Returns kept cards + number removed.
 */
export function dedupeCards<T extends Pick<CardDraft, "front" | "back">>(
  cards: T[],
  existing: Pick<CardDraft, "front" | "back">[] = [],
): { cards: T[]; removed: number } {
  const kept: T[] = [];
  let removed = 0;
  for (const c of cards) {
    if (existing.some((e) => isDuplicate(c, e)) || kept.some((k) => isDuplicate(c, k))) {
      removed++;
      continue;
    }
    kept.push(c);
  }
  return { cards: kept, removed };
}
