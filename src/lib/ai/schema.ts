/**
 * Zod schemas for Claude's structured outputs, plus parsing/validation of the
 * final message. Kept free of network code so it can be unit-tested with
 * mocked SDK responses.
 */
import { z } from "zod";
import { classifyCard } from "../demo/generator";
import { CARD_TYPES, type CardDraft, type CardType, type StudyContext } from "../types";

export const CardSchema = z.object({
  front: z.string().describe("Term or question. Uses the exam's terminology."),
  back: z.string().describe("Definition / answer, grounded in the notes. Include the formula when relevant."),
  type: z.enum(CARD_TYPES),
  topic: z.string().describe("One of the study context's topic areas."),
  difficulty: z.number().int().describe("1 = recall, 2 = understanding, 3 = application"),
  source: z.string().describe("Short verbatim excerpt from the notes this card is based on."),
});

export const CardsOutputSchema = z.object({
  cards: z.array(CardSchema),
});

export const ContextOutputSchema = z.object({
  name: z.string().describe("Exam or course name, e.g. 'CFA Level II'. Empty string if it cannot be determined."),
  domain: z.string(),
  level: z.string(),
  topicAreas: z.array(z.string()),
  conventions: z.string().describe("Terminology and notation conventions cards should follow."),
  confidence: z.number().describe("0 to 1"),
});

export type CardsOutput = z.infer<typeof CardsOutputSchema>;
export type ContextOutput = z.infer<typeof ContextOutputSchema>;

/** Minimal shape of an SDK (beta) Message that we read. */
export interface MessageLike {
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content: Array<{ type: string; text?: string }>;
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "refusal" | "max_tokens" | "invalid" | "empty"; message: string };

/** Check stop_reason first, then gather text blocks (thinking/fallback blocks are skipped). */
export function readTextOutput(msg: MessageLike): ParseResult<string> {
  if (msg.stop_reason === "refusal") {
    const cat = msg.stop_details?.category;
    return {
      ok: false,
      reason: "refusal",
      message: `Claude declined this request${cat ? ` (${cat})` : ""}. Try rephrasing or removing unrelated material from the notes.`,
    };
  }
  if (msg.stop_reason === "max_tokens") {
    return { ok: false, reason: "max_tokens", message: "The response hit the output limit before finishing." };
  }
  const text = msg.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) return { ok: false, reason: "empty", message: "Claude returned an empty response." };
  return { ok: true, data: text };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Defensive: strip code fences / leading prose if present.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("not JSON");
  }
}

export function parseStructured<T>(msg: MessageLike, schema: z.ZodType<T>): ParseResult<T> {
  const text = readTextOutput(msg);
  if (!text.ok) return text;
  let json: unknown;
  try {
    json = parseJson(text.data);
  } catch {
    return { ok: false, reason: "invalid", message: "Claude's response was not valid JSON." };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", message: `Claude's response did not match the expected format: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  return { ok: true, data: parsed.data };
}

/** Pick the context topic area that best matches a free-text topic. */
export function matchTopic(topic: string, ctx: StudyContext): string {
  const t = topic.trim();
  if (!ctx.topicAreas.length) return t || "General";
  const exact = ctx.topicAreas.find((a) => a.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const words = new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  let best = "";
  let bestScore = 0;
  for (const a of ctx.topicAreas) {
    const aw = a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const score = aw.filter((w) => words.has(w)).length / Math.max(1, aw.length);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return bestScore >= 0.5 ? best : t || ctx.topicAreas[0];
}

/** Normalize raw cards from Claude into safe CardDrafts. Drops empty cards. */
export function normalizeCards(raw: CardsOutput["cards"], ctx: StudyContext): CardDraft[] {
  const out: CardDraft[] = [];
  for (const c of raw) {
    const front = c.front?.trim();
    const back = c.back?.trim();
    if (!front || !back) continue;
    const type: CardType = (CARD_TYPES as readonly string[]).includes(c.type) ? c.type : classifyCard(front, back);
    const d = Math.round(Number(c.difficulty));
    out.push({
      front: front.slice(0, 500),
      back: back.slice(0, 2000),
      type,
      topic: matchTopic(c.topic ?? "", ctx),
      difficulty: (d >= 3 ? 3 : d <= 1 ? 1 : 2) as 1 | 2 | 3,
      source: (c.source ?? "").trim().slice(0, 300),
    });
  }
  return out;
}

export function parseCardsMessage(msg: MessageLike, ctx: StudyContext): ParseResult<CardDraft[]> {
  const r = parseStructured(msg, CardsOutputSchema);
  if (!r.ok) return r;
  return { ok: true, data: normalizeCards(r.data.cards, ctx) };
}

export function parseContextMessage(msg: MessageLike, source: StudyContext["source"]): ParseResult<StudyContext> {
  const r = parseStructured(msg, ContextOutputSchema);
  if (!r.ok) return r;
  const d = r.data;
  const topicAreas = [...new Set(d.topicAreas.map((t) => t.trim()).filter(Boolean))].slice(0, 20);
  return {
    ok: true,
    data: {
      name: d.name.trim(),
      domain: d.domain.trim(),
      level: d.level.trim(),
      topicAreas,
      conventions: d.conventions.trim(),
      source,
      confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)),
    },
  };
}
