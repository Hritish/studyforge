import { describe, expect, it } from "vitest";
import { checkAnswer, normalizeAnswer } from "@/lib/study/answer";
import { cardsToCsv, csvField } from "@/lib/csv";
import { buildMcQuestion, buildQuiz } from "@/lib/study/learn";
import { applyResult, isMastered, summarize, summarizeByTopic } from "@/lib/study/mastery";
import {
  clearWrong,
  elapsedMs,
  isComplete,
  isNewBest,
  newRound,
  PENALTY_MS,
  pickRoundCards,
  selectTile,
  truncate,
  type MatchState,
} from "@/lib/study/match";
import { seededRng, shuffle } from "@/lib/study/random";

const cards = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, front: `Term ${i}`, back: `Definition number ${i}`, topic: i < 5 ? "A" : "B" }));

function tileOf(s: MatchState, cardId: string, kind: "term" | "def") {
  return s.tiles.find((t) => t.cardId === cardId && t.kind === kind)!.id;
}

describe("match game", () => {
  it("creates 6 pairs (12 tiles), shuffled", () => {
    const s = newRound(cards, 0, seededRng(1));
    expect(s.tiles).toHaveLength(12);
    expect(new Set(s.tiles.map((t) => t.cardId)).size).toBe(6);
    expect(s.tiles.filter((t) => t.kind === "term")).toHaveLength(6);
    const kinds = s.tiles.map((t) => t.kind).join("");
    expect(kinds).not.toBe("termdef".repeat(6)); // not in trivial order
  });

  it("uses fewer pairs when the set is small, and skips duplicate terms", () => {
    const small = [cards[0], cards[1], { ...cards[2], front: "Term 0" }];
    expect(pickRoundCards(small, seededRng(2))).toHaveLength(2);
  });

  it("different seeds give a new random selection", () => {
    const a = newRound(cards, 0, seededRng(1)).tiles.map((t) => t.cardId).sort().join();
    const b = newRound(cards, 0, seededRng(99)).tiles.map((t) => t.cardId).sort().join();
    expect(a).not.toBe(b);
  });

  it("matches a correct pair and removes it", () => {
    let s = newRound(cards, 0, seededRng(3));
    const id = s.tiles[0].cardId;
    s = selectTile(s, tileOf(s, id, "term"), 100);
    expect(s.selected).toBe(tileOf(s, id, "term"));
    s = selectTile(s, tileOf(s, id, "def"), 200);
    expect(s.matchedCardIds).toEqual([id]);
    expect(s.selected).toBeNull();
    // clicking a matched tile does nothing
    expect(selectTile(s, tileOf(s, id, "term"), 300)).toBe(s);
  });

  it("flashes wrong pairs and adds a 1s penalty", () => {
    let s = newRound(cards, 0, seededRng(4));
    const [a, b] = [...new Set(s.tiles.map((t) => t.cardId))];
    s = selectTile(s, tileOf(s, a, "term"), 10);
    s = selectTile(s, tileOf(s, b, "def"), 20);
    expect(s.wrong).toEqual([tileOf(s, a, "term"), tileOf(s, b, "def")]);
    expect(s.mistakes).toBe(1);
    expect(s.penaltyMs).toBe(PENALTY_MS);
    expect(elapsedMs(s, 5000)).toBe(6000);
    expect(clearWrong(s).wrong).toBeNull();
  });

  it("switches selection when two tiles of the same kind are clicked, and toggles off", () => {
    let s = newRound(cards, 0, seededRng(5));
    const [a, b] = [...new Set(s.tiles.map((t) => t.cardId))];
    s = selectTile(s, tileOf(s, a, "term"), 1);
    s = selectTile(s, tileOf(s, b, "term"), 2);
    expect(s.selected).toBe(tileOf(s, b, "term"));
    s = selectTile(s, tileOf(s, b, "term"), 3);
    expect(s.selected).toBeNull();
  });

  it("finishes when all pairs match (either click order) and freezes the timer", () => {
    let s = newRound(cards, 1000, seededRng(6));
    const ids = [...new Set(s.tiles.map((t) => t.cardId))];
    ids.forEach((id, i) => {
      const order = i % 2 === 0 ? (["def", "term"] as const) : (["term", "def"] as const);
      s = selectTile(s, tileOf(s, id, order[0]), 2000);
      s = selectTile(s, tileOf(s, id, order[1]), 4000);
    });
    expect(isComplete(s)).toBe(true);
    expect(s.finishedAt).toBe(4000);
    expect(elapsedMs(s, 999999)).toBe(3000);
  });

  it("best time and truncation helpers", () => {
    expect(isNewBest(5000, null)).toBe(true);
    expect(isNewBest(5000, 4000)).toBe(false);
    expect(isNewBest(3000, 4000)).toBe(true);
    const t = truncate("word ".repeat(40), 50);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBeLessThanOrEqual(51);
    expect(truncate("short").truncated).toBe(false);
  });
});

describe("answer matching", () => {
  it("normalizes case, punctuation and articles", () => {
    expect(normalizeAnswer("The Z-Spread.")).toBe("z-spread");
  });
  it.each([
    ["z-spread", "Z-spread", "correct"],
    ["Zspread", "Z-spread", "correct"],
    ["gordon growth modle", "Gordon growth model", "correct"],
    ["option adjusted spred", "Option-adjusted spread", "correct"],
    ["the sustainable growth rate g = b × ROE", "g = b × ROE", "correct"],
    ["cash available to shareholders after debt", "Cash flow available to common shareholders after all obligations to debt holders", "correct"],
    ["cash flow to shareholders", "Cash flow available to common shareholders after all obligations to debt holders", "close"],
    ["duration", "Convexity", "incorrect"],
    ["", "anything", "incorrect"],
  ])("%s vs %s → %s", (given, expected, verdict) => {
    expect(checkAnswer(given, expected).verdict).toBe(verdict);
  });
});

describe("learn mode", () => {
  it("builds MC questions with distractors from the same topic first", () => {
    const q = buildMcQuestion(cards[0], cards, seededRng(7));
    expect(q.options).toHaveLength(4);
    expect(q.options[q.correctIndex]).toBe(cards[0].back);
    const distractors = q.options.filter((_, i) => i !== q.correctIndex);
    const topics = distractors.map((d) => cards.find((c) => c.back === d)!.topic);
    expect(topics.every((t) => t === "A")).toBe(true);
    expect(new Set(q.options).size).toBe(4);
  });

  it("falls back to other topics when the same topic is too small", () => {
    const q = buildMcQuestion(cards[9], [cards[9], cards[0], cards[1], cards[2]], seededRng(1));
    expect(q.options).toHaveLength(4);
  });

  it("buildQuiz covers distinct cards", () => {
    const quiz = buildQuiz(cards, seededRng(8), 5);
    expect(quiz).toHaveLength(5);
    expect(new Set(quiz.map((q) => q.cardId)).size).toBe(5);
  });

  it("shuffle is a permutation", () => {
    expect(shuffle([1, 2, 3, 4, 5], seededRng(1)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("mastery", () => {
  it("updates levels", () => {
    expect(applyResult(0, "known")).toBe(3);
    expect(applyResult(4, "known")).toBe(5);
    expect(applyResult(4, "learning")).toBe(1);
    expect(applyResult(1, "correct")).toBe(2);
    expect(applyResult(1, "incorrect")).toBe(0);
    expect(isMastered(3)).toBe(true);
  });
  it("summarizes progress overall and per topic", () => {
    const cs = [
      { mastery: 3, status: "known", topic: "A" },
      { mastery: 0, status: "new", topic: "A" },
      { mastery: 1, status: "learning", topic: "B" },
    ];
    expect(summarize(cs)).toEqual({ total: 3, mastered: 1, learning: 1, notStarted: 1, percent: 44 });
    expect(summarizeByTopic(cs).map((t) => t.topic)).toEqual(["A", "B"]);
  });
});

describe("csv export", () => {
  it("quotes fields and flattens newlines for Quizlet", () => {
    expect(csvField('He said "hi", ok')).toBe('"He said ""hi"", ok"');
    expect(cardsToCsv([{ front: "A", back: "line1\nline2" }])).toBe("A,line1 / line2\n");
  });
});
