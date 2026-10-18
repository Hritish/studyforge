/** Lenient answer matching for the written-answer mode. */

const ARTICLES = /\b(a|an|the)\b/g;

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/+\-=*^.%\s]/g, " ")
    .replace(ARTICLES, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

const STOP = new Set(["of", "and", "or", "to", "in", "on", "for", "is", "are", "by", "with", "as", "at", "its", "it", "be", "that", "this"]);

function keywords(s: string): string[] {
  return normalizeAnswer(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export type AnswerVerdict = "correct" | "close" | "incorrect";

/**
 * Compare a typed answer to the expected one.
 * - exact after normalization, or ≥ 85% character similarity → correct
 * - for long expected answers: ≥ 50% of expected keywords present → correct
 * - ≥ 70% similarity or ≥ 25% keywords → close (shown as "almost", counted wrong
 *   unless the user overrides)
 */
export function checkAnswer(given: string, expected: string): { verdict: AnswerVerdict; score: number } {
  const g = normalizeAnswer(given);
  const e = normalizeAnswer(expected);
  if (!g) return { verdict: "incorrect", score: 0 };
  if (g === e) return { verdict: "correct", score: 1 };

  const sim = similarity(g, e);
  const ek = keywords(expected);
  const gk = new Set(keywords(given));
  const fuzzyHas = (w: string) => gk.has(w) || [...gk].some((x) => x.length > 3 && similarity(x, w) >= 0.8);
  const coverage = ek.length ? ek.filter(fuzzyHas).length / ek.length : 0;
  const longAnswer = ek.length >= 4;

  if (sim >= 0.85) return { verdict: "correct", score: sim };
  if (longAnswer && coverage >= 0.5) return { verdict: "correct", score: coverage };
  // Short expected answers: the given answer contains the expected one entirely.
  if (!longAnswer && e.length >= 3 && g.includes(e)) return { verdict: "correct", score: 0.9 };
  if (sim >= 0.7 || (longAnswer && coverage >= 0.25)) return { verdict: "close", score: Math.max(sim, coverage) };
  return { verdict: "incorrect", score: Math.max(sim, coverage) };
}
