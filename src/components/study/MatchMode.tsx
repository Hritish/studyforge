"use client";

import { useEffect, useRef, useState } from "react";
import { clearWrong, elapsedMs, formatTime, newRound, selectTile, truncate, type MatchState, type Tile } from "@/lib/study/match";
import { btn } from "../ui";
import type { ModeProps } from "./progress";

/** Wall clock, read only from event handlers / timers. */
const clock = () => Date.now();

export function MatchMode({ setId, cards, bestMatchMs }: ModeProps) {
  const [game, setGame] = useState<MatchState | null>(null);
  const [now, setNow] = useState(0);
  const [best, setBest] = useState<number | null>(bestMatchMs ?? null);
  const [newBest, setNewBest] = useState(false);
  const [expanded, setExpanded] = useState<Tile | null>(null);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = game?.finishedAt != null;

  // Timer tick while a round is running.
  useEffect(() => {
    if (!game || finished) return;
    const t = setInterval(() => setNow(clock()), 100);
    return () => clearInterval(t);
  }, [game, finished]);

  function start() {
    const t = clock();
    setNow(t);
    setNewBest(false);
    setGame(newRound(cards, t));
  }

  async function onFinish(state: MatchState) {
    const ms = elapsedMs(state, state.finishedAt!);
    try {
      const res = await fetch(`/api/sets/${setId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bestMatchMs: Math.round(ms) }),
      });
      const data = await res.json();
      if (data.newBest) {
        setBest(Math.round(ms));
        setNewBest(true);
      }
    } catch {
      /* best time is non-critical */
    }
  }

  function click(tile: Tile) {
    if (!game) return;
    const t = clock();
    const next = selectTile(game, tile.id, t);
    setGame(next);
    setNow(t);
    if (next.wrong) {
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
      wrongTimer.current = setTimeout(() => setGame((g) => (g ? clearWrong(g) : g)), 500);
    }
    if (next.finishedAt != null && game.finishedAt == null) void onFinish(next);
  }

  if (cards.length < 2) {
    return <p className="rounded-2xl bg-white p-8 text-center text-slate-600 ring-1 ring-slate-200">Add at least 2 cards to play Match.</p>;
  }

  if (!game) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
        <div className="text-4xl" aria-hidden="true">⚡</div>
        <h2 className="mt-3 text-2xl font-bold text-slate-900">Match</h2>
        <p className="mx-auto mt-2 max-w-md text-slate-600">
          Tap a term, then its definition. Matched pairs disappear. Wrong pairs add a <strong>+1s</strong> penalty. Clear the board as fast as you can.
        </p>
        {best ? <p className="mt-3 text-sm text-slate-500">Best time: <strong data-testid="best-time">{formatTime(best)}</strong></p> : null}
        <button className={`${btn.primary} mt-6 px-8`} onClick={start} data-testid="match-start">
          Start game
        </button>
      </div>
    );
  }

  const time = elapsedMs(game, finished ? game.finishedAt! : now);

  if (finished) {
    return (
      <div className="animate-fade-up rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200" data-testid="match-done">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Your time</p>
        <p className="mt-1 text-5xl font-bold tabular-nums text-slate-900">{formatTime(time)}</p>
        {newBest ? <p className="mt-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">New best time!</p> : null}
        <p className="mt-3 text-sm text-slate-500">
          {game.mistakes} mistake{game.mistakes === 1 ? "" : "s"} (+{game.mistakes}s){best ? ` · Best ${formatTime(best)}` : ""}
        </p>
        <button className={`${btn.primary} mt-6 px-8`} onClick={start} data-testid="match-again">
          Play again
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-3xl font-bold tabular-nums text-slate-900" data-testid="match-timer">{formatTime(time)}</p>
        <div className="text-right text-sm text-slate-500">
          <p>{game.matchedCardIds.length} / {game.tiles.length / 2} matched</p>
          {game.penaltyMs ? <p className="text-rose-600">+{game.penaltyMs / 1000}s penalty</p> : null}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3" data-testid="match-grid">
        {game.tiles.map((tile) => {
          const matched = game.matchedCardIds.includes(tile.cardId);
          const selected = game.selected === tile.id;
          const wrong = game.wrong?.includes(tile.id);
          const { text, truncated } = truncate(tile.text);
          return (
            <div key={tile.id} className={`relative ${matched ? "animate-pop-out pointer-events-none" : ""}`}>
              <button
                onClick={() => click(tile)}
                data-testid="match-tile"
                data-kind={tile.kind}
                data-card={tile.cardId}
                aria-pressed={selected}
                className={`flex h-28 w-full touch-manipulation items-center justify-center rounded-2xl p-3 text-center text-[13px] leading-snug shadow-sm ring-1 transition sm:h-32 sm:text-sm ${
                  wrong
                    ? "animate-shake bg-rose-50 text-rose-800 ring-2 ring-rose-400"
                    : selected
                      ? "bg-indigo-50 text-indigo-900 ring-2 ring-indigo-500"
                      : tile.kind === "term"
                        ? "bg-white font-semibold text-slate-900 ring-slate-200 hover:ring-indigo-300"
                        : "bg-slate-50 text-slate-700 ring-slate-200 hover:ring-indigo-300"
                }`}
              >
                <span className={truncated ? "line-clamp-4 pb-3" : "line-clamp-5"}>{text}</span>
              </button>
              {truncated ? (
                <button
                  className="absolute bottom-1.5 right-1.5 rounded-md bg-white/90 px-1.5 text-[11px] font-medium text-indigo-600 ring-1 ring-slate-200 hover:bg-indigo-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(tile);
                  }}
                  aria-label="Show full text"
                >
                  more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {expanded ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={() => setExpanded(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{expanded.kind === "term" ? "Term" : "Definition"}</p>
            <p className="mt-2 whitespace-pre-line text-slate-800">{expanded.text}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className={btn.secondary} onClick={() => setExpanded(null)}>Close</button>
              <button
                className={btn.primary}
                onClick={() => {
                  const t = expanded;
                  setExpanded(null);
                  click(t);
                }}
              >
                Select this tile
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
