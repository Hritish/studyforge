export const MASTERY_MAX = 5;
export const MASTERED_AT = 3;

export type StudyResult = "known" | "learning" | "correct" | "incorrect";

/** Update a card's 0..5 mastery level after a study interaction. */
export function applyResult(mastery: number, result: StudyResult): number {
  switch (result) {
    case "known":
      return Math.min(MASTERY_MAX, Math.max(mastery + 1, MASTERED_AT));
    case "correct":
      return Math.min(MASTERY_MAX, mastery + 1);
    case "learning":
      return Math.min(mastery, 1);
    case "incorrect":
      return Math.max(0, mastery - 2);
  }
}

export function statusFor(result: StudyResult, current: string): string {
  if (result === "known") return "known";
  if (result === "learning" || result === "incorrect") return "learning";
  return current === "new" ? "learning" : current;
}

export function isMastered(mastery: number): boolean {
  return mastery >= MASTERED_AT;
}

export interface ProgressSummary {
  total: number;
  mastered: number;
  learning: number;
  notStarted: number;
  percent: number;
}

export function summarize(cards: { mastery: number; status: string }[]): ProgressSummary {
  const total = cards.length;
  const mastered = cards.filter((c) => isMastered(c.mastery)).length;
  const notStarted = cards.filter((c) => !isMastered(c.mastery) && c.status === "new" && c.mastery === 0).length;
  const learning = total - mastered - notStarted;
  // Percent uses partial credit so progress moves before a card is fully mastered.
  const points = cards.reduce((a, c) => a + Math.min(c.mastery, MASTERED_AT), 0);
  const percent = total ? Math.round((points / (total * MASTERED_AT)) * 100) : 0;
  return { total, mastered, learning, notStarted, percent };
}

export function summarizeByTopic<T extends { mastery: number; status: string; topic: string }>(
  cards: T[],
): { topic: string; summary: ProgressSummary }[] {
  const groups = new Map<string, T[]>();
  for (const c of cards) groups.set(c.topic, [...(groups.get(c.topic) ?? []), c]);
  return [...groups.entries()]
    .map(([topic, cs]) => ({ topic, summary: summarize(cs) }))
    .sort((a, b) => b.summary.total - a.summary.total);
}
