/**
 * CSV export compatible with Quizlet's import ("Between term and definition: Comma",
 * "Between rows: New line"). Fields are quoted; embedded newlines are flattened
 * because Quizlet treats every newline as a new card.
 */
export function csvField(s: string): string {
  const flat = s.replace(/\r?\n+/g, " / ").trim();
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}

export function cardsToCsv(cards: { front: string; back: string }[]): string {
  return cards.map((c) => `${csvField(c.front)},${csvField(c.back)}`).join("\n") + "\n";
}

export function safeFilename(s: string): string {
  return (s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "study-set").slice(0, 60);
}
