import type { StudyResult } from "@/lib/study/mastery";

export interface ModeProps {
  setId: string;
  cards: import("@/lib/types").ClientCard[];
  bestMatchMs?: number | null;
}

/** Fire-and-forget progress update. */
export async function recordResults(setId: string, results: { cardId: string; result: StudyResult }[]) {
  if (results.length === 0) return null;
  try {
    const res = await fetch(`/api/sets/${setId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    });
    return res.ok ? ((await res.json()) as { cards: { id: string; mastery: number; status: string }[] }) : null;
  } catch {
    return null;
  }
}
