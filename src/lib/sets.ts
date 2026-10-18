import "server-only";
import { prisma } from "./db";
import { EMPTY_CONTEXT, type ClientCard, type StudyContext } from "./types";

export function parseContext(json: string): StudyContext {
  try {
    return { ...EMPTY_CONTEXT, ...(JSON.parse(json) as Partial<StudyContext>) };
  } catch {
    return { ...EMPTY_CONTEXT };
  }
}

export type CardRow = Awaited<ReturnType<typeof prisma.card.findMany>>[number];

export async function getSetWithCards(id: string) {
  const set = await prisma.studySet.findUnique({
    where: { id },
    include: { cards: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
  });
  if (!set) return null;
  return { ...set, context: parseContext(set.contextJson) };
}

/** Plain JSON-safe card for client components. */
export function serializeCard(c: CardRow): ClientCard {
  return {
    id: c.id,
    front: c.front,
    back: c.back,
    type: c.type,
    topic: c.topic,
    difficulty: c.difficulty,
    source: c.source,
    mastery: c.mastery,
    status: c.status,
    correctCount: c.correctCount,
    incorrectCount: c.incorrectCount,
  };
}
