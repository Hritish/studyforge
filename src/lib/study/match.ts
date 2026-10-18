import { normalizeAnswer } from "./answer";
import { shuffle, type Rng } from "./random";

export interface MatchCard {
  id: string;
  front: string;
  back: string;
}

export interface Tile {
  id: string;
  cardId: string;
  kind: "term" | "def";
  text: string;
}

export interface MatchState {
  tiles: Tile[];
  selected: string | null;
  matchedCardIds: string[];
  /** The two tiles currently flashing red after a wrong pair. */
  wrong: [string, string] | null;
  mistakes: number;
  penaltyMs: number;
  startedAt: number;
  finishedAt: number | null;
}

export const PAIRS_PER_ROUND = 6;
export const PENALTY_MS = 1000;
export const MATCH_TRUNCATE_CHARS = 90;

/** Pick up to `size` random cards with distinct terms and definitions. */
export function pickRoundCards(cards: MatchCard[], rng: Rng = Math.random, size = PAIRS_PER_ROUND): MatchCard[] {
  const seenF = new Set<string>();
  const seenB = new Set<string>();
  const out: MatchCard[] = [];
  for (const c of shuffle(cards, rng)) {
    const f = normalizeAnswer(c.front);
    const b = normalizeAnswer(c.back);
    if (!f || !b || seenF.has(f) || seenB.has(b)) continue;
    seenF.add(f);
    seenB.add(b);
    out.push(c);
    if (out.length === size) break;
  }
  return out;
}

export function newRound(cards: MatchCard[], now: number, rng: Rng = Math.random, size = PAIRS_PER_ROUND): MatchState {
  const picked = pickRoundCards(cards, rng, size);
  const tiles: Tile[] = shuffle(
    picked.flatMap((c) => [
      { id: `t-${c.id}`, cardId: c.id, kind: "term" as const, text: c.front },
      { id: `d-${c.id}`, cardId: c.id, kind: "def" as const, text: c.back },
    ]),
    rng,
  );
  return { tiles, selected: null, matchedCardIds: [], wrong: null, mistakes: 0, penaltyMs: 0, startedAt: now, finishedAt: null };
}

export function isComplete(s: MatchState): boolean {
  return s.tiles.length > 0 && s.matchedCardIds.length * 2 === s.tiles.length;
}

/** Elapsed time including penalties, in ms. */
export function elapsedMs(s: MatchState, now: number): number {
  return (s.finishedAt ?? now) - s.startedAt + s.penaltyMs;
}

/** Handle a click/tap on a tile. Pure; returns a new state. */
export function selectTile(s: MatchState, tileId: string, now: number): MatchState {
  if (s.finishedAt !== null) return s;
  const tile = s.tiles.find((t) => t.id === tileId);
  if (!tile || s.matchedCardIds.includes(tile.cardId)) return s;
  const state: MatchState = { ...s, wrong: null };

  if (!state.selected) return { ...state, selected: tileId };
  if (state.selected === tileId) return { ...state, selected: null };

  const prev = state.tiles.find((t) => t.id === state.selected)!;
  if (prev.kind === tile.kind) return { ...state, selected: tileId };

  if (prev.cardId === tile.cardId) {
    const matchedCardIds = [...state.matchedCardIds, tile.cardId];
    const next = { ...state, selected: null, matchedCardIds };
    return isComplete(next) ? { ...next, finishedAt: now } : next;
  }
  return {
    ...state,
    selected: null,
    wrong: [prev.id, tile.id],
    mistakes: state.mistakes + 1,
    penaltyMs: state.penaltyMs + PENALTY_MS,
  };
}

export function clearWrong(s: MatchState): MatchState {
  return s.wrong ? { ...s, wrong: null } : s;
}

export function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function truncate(text: string, max = MATCH_TRUNCATE_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return { text: `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`, truncated: true };
}

/** Returns true when `ms` beats the stored best (or there is none). */
export function isNewBest(ms: number, best: number | null | undefined): boolean {
  return best == null || ms < best;
}
