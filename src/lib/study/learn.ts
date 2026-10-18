import { normalizeAnswer } from "./answer";
import { shuffle, type Rng } from "./random";

export interface QuizCard {
  id: string;
  front: string;
  back: string;
  topic: string;
}

export interface McQuestion {
  cardId: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

/**
 * Build a multiple-choice question for `card`. Distractors are other cards'
 * definitions, preferring cards from the same topic area.
 */
export function buildMcQuestion(card: QuizCard, all: QuizCard[], rng: Rng = Math.random, choices = 4): McQuestion {
  const correct = normalizeAnswer(card.back);
  const seen = new Set([correct]);
  const pool = all.filter((c) => c.id !== card.id);
  const sameTopic = shuffle(pool.filter((c) => c.topic === card.topic), rng);
  const otherTopic = shuffle(pool.filter((c) => c.topic !== card.topic), rng);
  const distractors: string[] = [];
  for (const c of [...sameTopic, ...otherTopic]) {
    const n = normalizeAnswer(c.back);
    if (seen.has(n)) continue;
    seen.add(n);
    distractors.push(c.back);
    if (distractors.length === choices - 1) break;
  }
  const options = shuffle([card.back, ...distractors], rng);
  return { cardId: card.id, prompt: card.front, options, correctIndex: options.indexOf(card.back) };
}

export function buildQuiz(cards: QuizCard[], rng: Rng = Math.random, limit = 20): McQuestion[] {
  return shuffle(cards, rng)
    .slice(0, limit)
    .map((c) => buildMcQuestion(c, cards, rng));
}
