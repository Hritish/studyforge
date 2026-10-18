/**
 * Offline "Demo mode" generator. Used when ANTHROPIC_API_KEY is not set.
 * It is purely heuristic: it extracts cards from explicit structures in the
 * notes ("Term: definition", "Term - definition", "Term = formula", markdown
 * headings with bullets) and detects context by keyword matching.
 */
import { findKnownContextByName, KNOWN_CONTEXTS, knownToStudyContext } from "../contexts";
import type { CardDraft, CardType, StudyContext } from "../types";
import { EMPTY_CONTEXT } from "../types";

const FORMULA_HINT = /[=×÷^√∑]|\b(formula|equation)\b|\/\s*\(|\(1\s*\+/i;
const CALC_HINT = /\b(calculate|compute|example|worked|solve)\b|\d+(\.\d+)?\s*%/i;
const COMPARE_HINT = /\b(vs\.?|versus|compared (to|with)|difference between|unlike|whereas)\b/i;

export function classifyCard(front: string, back: string): CardType {
  const both = `${front} ${back}`;
  if (COMPARE_HINT.test(front) || /\bvs\.?\b|versus/i.test(front)) return "compare";
  if (FORMULA_HINT.test(back) && /[=]/.test(back)) return "formula";
  if (CALC_HINT.test(front)) return "calculation";
  if (COMPARE_HINT.test(back)) return "compare";
  if (back.split(/\s+/).length > 28 || /\b(why|how|explain)\b/i.test(both)) return "concept";
  return "definition";
}

export function estimateDifficulty(front: string, back: string, type: CardType): 1 | 2 | 3 {
  let score = 0;
  if (type === "formula" || type === "calculation") score += 1;
  if (type === "compare" || type === "concept") score += 0.5;
  const words = back.split(/\s+/).length;
  if (words > 25) score += 1;
  else if (words > 12) score += 0.5;
  if (/[=^√∑]/.test(back)) score += 0.5;
  if (front.split(/\s+/).length > 6) score += 0.25;
  return score >= 1.75 ? 3 : score >= 0.75 ? 2 : 1;
}

function cleanInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Pair {
  front: string;
  back: string;
  line: string;
  heading: string;
}

// "Term: definition" | "Term - definition" | "Term – definition" | "Term = formula"
const PAIR_RE = /^(.{2,90}?)\s*(?::|\s[-–—]\s|=)\s*(.{3,})$/;

function isLikelyTerm(term: string): boolean {
  const words = term.split(/\s+/);
  if (words.length > 10) return false;
  if (/[.!?]$/.test(term)) return false;
  if (/^(note|e\.g|i\.e|example|tip|see|source|date|page|http)/i.test(term)) return false;
  return /[a-z]/i.test(term);
}

/** Pull term/definition pairs out of the notes. */
export function extractPairs(text: string): Pair[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const pairs: Pair[] = [];
  let heading = "";
  let headingBullets: string[] = [];
  let headingLine = "";

  const flushHeading = () => {
    // A heading followed only by plain bullets (no "term: def" structure) → one card.
    if (heading && headingBullets.length > 0) {
      pairs.push({
        front: heading,
        back: headingBullets.slice(0, 6).join("; "),
        line: `${headingLine}\n${headingBullets.slice(0, 3).join("\n")}`,
        heading,
      });
    }
    headingBullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    if (h) {
      flushHeading();
      heading = cleanInline(h[1]).replace(/:$/, "");
      headingLine = line;
      continue;
    }
    const isBullet = /^\s*([-*+•]|\d+[.)])\s+/.test(raw);
    const content = cleanInline(line);
    // Bold term at start: "**Term** definition"
    const bold = /^(?:[-*+•]\s+)?\*\*(.{2,80}?)\*\*\s*[:\-–—]?\s*(.{3,})$/.exec(line);
    const m = bold ? [line, cleanInline(bold[1]), cleanInline(bold[2])] : PAIR_RE.exec(content);
    if (m && isLikelyTerm(m[1].trim()) && m[2].trim().length >= 3) {
      const front = m[1].trim().replace(/[:\-–—=]\s*$/, "");
      // "x = formula" lines (where "=" is the separator) keep the whole equation on the back.
      const eq = content.indexOf("=");
      const otherSep = content.search(/:|\s[-–—]\s/);
      const isFormula = !bold && eq > 0 && (otherSep < 0 || eq < otherSep);
      const back = isFormula ? content : m[2].trim();
      pairs.push({ front, back, line: content, heading });
      continue;
    }
    if (isBullet && heading) headingBullets.push(content);
  }
  flushHeading();
  return pairs;
}

/** Map a heading/term to one of the context's topic areas (keyword overlap), else the heading. */
export function pickTopic(heading: string, front: string, back: string, ctx: StudyContext): string {
  const hay = `${heading} ${front} ${back}`.toLowerCase();
  let best = "";
  let bestScore = 0;
  for (const t of ctx.topicAreas) {
    const words = t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    let score = words.filter((w) => hay.includes(w)).length;
    if (heading && heading.toLowerCase().includes(t.toLowerCase())) score += 3;
    const kws = TOPIC_KEYWORDS[t];
    if (kws) score += kws.filter((k) => hay.includes(k)).length * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best) return best;
  return heading ? heading.slice(0, 60) : ctx.topicAreas[0] ?? "General";
}

/** Extra keyword hints for common topic areas (used only by the demo generator). */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  "Ethical and Professional Standards": ["standard", "ethic", "mosaic", "nonpublic", "fiduciary", "disclos", "conflict", "loyalty"],
  "Equity Valuation": ["dividend", "ddm", "fcff", "fcfe", "residual income", "p/e", "gordon", "equity", "ev/ebitda"],
  "Fixed Income": ["bond", "spread", "duration", "convexity", "yield", "spot rate", "forward rate", "credit", "oas", "term structure"],
  Derivatives: ["swap", "option", "forward", "futures", "binomial", "black-scholes", "delta", "put", "call", "fra"],
  "Quantitative Methods": ["regression", "r-squared", "heteroskedasticity", "multicollinearity", "time series", "t-stat"],
  "Portfolio Management": ["portfolio", "factor", "var", "active return", "information ratio"],
  "Financial Statement Analysis": ["intercorporate", "pension", "goodwill", "consolidation", "inventory"],
};

export interface DemoOptions {
  target?: number; // undefined = auto
}

/** Generate cards from notes with simple heuristics. Deterministic. */
export function generateDemoCards(text: string, ctx: StudyContext, opts: DemoOptions = {}): CardDraft[] {
  const pairs = extractPairs(text);
  const cards: CardDraft[] = pairs.map((p) => {
    const type = classifyCard(p.front, p.back);
    return {
      front: p.front,
      back: p.back,
      type,
      topic: pickTopic(p.heading, p.front, p.back, ctx),
      difficulty: estimateDifficulty(p.front, p.back, type),
      source: p.line.slice(0, 200),
    };
  });
  if (opts.target && cards.length > opts.target) {
    return spreadSelect(cards, opts.target);
  }
  return cards;
}

/** Pick `n` cards spread evenly across the list (so all topics stay represented). */
function spreadSelect<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return arr;
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/**
 * Demo context detection: explicit exam name → catalogue lookup; otherwise
 * keyword scoring against the built-in list. Syllabus headings become topics.
 */
export function detectDemoContext(input: { examName?: string; syllabusText?: string; notesText?: string }): StudyContext {
  const examName = input.examName?.trim() ?? "";
  const syllabusTopics = input.syllabusText ? extractSyllabusTopics(input.syllabusText) : [];

  if (examName) {
    const kc = findKnownContextByName(examName);
    if (kc) {
      const ctx = knownToStudyContext(kc, syllabusTopics.length ? "syllabus" : "user", 1);
      if (syllabusTopics.length) ctx.topicAreas = syllabusTopics;
      ctx.name = examName.length > kc.name.length ? examName : kc.name;
      return ctx;
    }
    return {
      ...EMPTY_CONTEXT,
      name: examName,
      domain: "",
      topicAreas: syllabusTopics,
      source: syllabusTopics.length ? "syllabus" : "user",
      confidence: 1,
    };
  }

  const hay = `${input.syllabusText ?? ""}\n${input.notesText ?? ""}`.toLowerCase();
  let best: { kc: (typeof KNOWN_CONTEXTS)[number]; score: number } | undefined;
  for (const kc of KNOWN_CONTEXTS) {
    let score = 0;
    for (const k of kc.keywords) if (hay.includes(k)) score++;
    for (const a of kc.aliases) if (hay.includes(a)) score += 3;
    if (!best || score > best.score) best = { kc, score };
  }
  if (best && best.score >= 3) {
    const confidence = Math.min(0.95, 0.4 + best.score * 0.05);
    const ctx = knownToStudyContext(best.kc, syllabusTopics.length ? "syllabus" : "inferred", confidence);
    if (syllabusTopics.length) ctx.topicAreas = syllabusTopics;
    return ctx;
  }
  if (syllabusTopics.length) {
    return { ...EMPTY_CONTEXT, topicAreas: syllabusTopics, source: "syllabus", confidence: 0.5 };
  }
  // Fall back to the notes' own headings as topic areas.
  const headingTopics = input.notesText ? extractSyllabusTopics(input.notesText) : [];
  return { ...EMPTY_CONTEXT, topicAreas: headingTopics.slice(0, 10), source: "inferred", confidence: 0.2 };
}

/** Top-level headings / numbered lines in a syllabus become topic areas. */
export function extractSyllabusTopics(text: string): string[] {
  const out: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const hasH2 = lines.some((l) => /^##\s+/.test(l.trim()));
  for (const raw of lines) {
    const l = raw.trim();
    let m = hasH2 ? /^##\s+(.+)$/.exec(l) : /^#{1,2}\s+(.+)$/.exec(l);
    if (!m) m = /^(?:topic|unit|module|section|week)\s*\d*[:.)-]\s*(.+)$/i.exec(l);
    if (!m) m = /^\d{1,2}[.)]\s+([A-Z].{2,70})$/.exec(l);
    if (m) {
      const t = cleanInline(m[1]).replace(/^(topic|unit|module)\s*\d+[:.)-]\s*/i, "").replace(/[:.]$/, "");
      if (t && t.length <= 80 && !out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 15);
}
