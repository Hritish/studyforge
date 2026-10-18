"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { applyResult, isMastered, statusFor } from "@/lib/study/mastery";
import { shuffle as shuffleArr } from "@/lib/study/random";
import { FilterChip } from "../create/ReviewList";
import { btn, DifficultyDots, ProgressBar, TypeChip } from "../ui";
import { recordResults, type ModeProps } from "./progress";

type Filter = { kind: "all" } | { kind: "learning" } | { kind: "topic"; topic: string };

export function FlashcardsMode({ setId, cards: initial }: ModeProps) {
  const [cards, setCards] = useState(initial);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [order, setOrder] = useState<string[]>(() => initial.map((c) => c.id));
  const [shuffled, setShuffled] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [session, setSession] = useState<Record<string, "known" | "learning">>({});

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const topics = useMemo(() => [...new Set(initial.map((c) => c.topic))], [initial]);

  const deck = useMemo(() => {
    return order
      .map((id) => byId.get(id)!)
      .filter(Boolean)
      .filter((c) => (filter.kind === "learning" ? !isMastered(c.mastery) || c.status === "learning" : filter.kind === "topic" ? c.topic === filter.topic : true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, filter, initial]); // deck membership is fixed when the filter changes, not on every mark

  const done = index >= deck.length;
  const card = deck[Math.min(index, deck.length - 1)];

  const go = useCallback(
    (delta: number) => {
      setFlipped(false);
      setIndex((i) => Math.max(0, Math.min(deck.length, i + delta)));
    },
    [deck.length],
  );

  const mark = useCallback(
    (result: "known" | "learning") => {
      if (!card || done) return;
      setSession((s) => ({ ...s, [card.id]: result }));
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, mastery: applyResult(c.mastery, result), status: statusFor(result, c.status) } : c)));
      void recordResults(setId, [{ cardId: card.id, result }]);
      go(1);
    },
    [card, done, go, setId],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        mark("known");
      } else if (e.key === "ArrowDown" || e.key.toLowerCase() === "l") {
        e.preventDefault();
        mark("learning");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, mark]);

  function applyFilter(f: Filter) {
    setFilter(f);
    setIndex(0);
    setFlipped(false);
    setSession({});
  }

  function toggleShuffle() {
    const next = !shuffled;
    setShuffled(next);
    setOrder(next ? shuffleArr(initial.map((c) => c.id)) : initial.map((c) => c.id));
    setIndex(0);
    setFlipped(false);
  }

  const knownCount = Object.values(session).filter((v) => v === "known").length;
  const learningCount = Object.values(session).filter((v) => v === "learning").length;

  return (
    <div>
      <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
        <FilterChip active={filter.kind === "all"} onClick={() => applyFilter({ kind: "all" })} label="All cards" />
        <FilterChip active={filter.kind === "learning"} onClick={() => applyFilter({ kind: "learning" })} label="Still learning" />
        {topics.map((t) => (
          <FilterChip key={t} active={filter.kind === "topic" && filter.topic === t} onClick={() => applyFilter({ kind: "topic", topic: t })} label={t} />
        ))}
      </div>

      <div className="mb-3 flex items-center gap-3 text-sm text-slate-500">
        <span data-testid="fc-counter">
          {Math.min(index + 1, deck.length)} / {deck.length}
        </span>
        <ProgressBar className="flex-1" value={deck.length ? (index / deck.length) * 100 : 0} />
        <button className={`${btn.ghost} ${shuffled ? "bg-indigo-50 text-indigo-700" : ""}`} onClick={toggleShuffle} aria-pressed={shuffled}>
          ⇄ Shuffle
        </button>
      </div>

      {deck.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-lg font-semibold text-slate-800">Nothing here 🎉</p>
          <p className="mt-1 text-sm text-slate-500">No cards match this filter{filter.kind === "learning" ? " — you've mastered everything" : ""}.</p>
          <button className={`${btn.secondary} mt-4`} onClick={() => applyFilter({ kind: "all" })}>Show all cards</button>
        </div>
      ) : done ? (
        <div className="animate-fade-up rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200" data-testid="fc-done">
          <p className="text-2xl font-bold text-slate-900">Round complete!</p>
          <p className="mt-2 text-slate-600">
            <span className="font-semibold text-emerald-700">{knownCount} known</span> · <span className="font-semibold text-amber-700">{learningCount} still learning</span>
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className={btn.secondary} onClick={() => { setIndex(0); setSession({}); }}>Restart</button>
            <button className={btn.primary} onClick={() => applyFilter({ kind: "learning" })}>Study still-learning cards</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flip-scene">
            <button
              className={`flip-card block h-[340px] w-full text-left sm:h-[380px] ${flipped ? "is-flipped" : ""}`}
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Show term" : "Show definition"}
              data-testid="flashcard"
            >
              <Face card={card} side="front" />
              <Face card={card} side="back" />
            </button>
          </div>
          <div className="mt-5 grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 sm:gap-3">
            <button className={btn.secondary} onClick={() => go(-1)} disabled={index === 0} aria-label="Previous card">←</button>
            <button className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100" onClick={() => mark("learning")} data-testid="still-learning">
              Still learning
            </button>
            <button className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100" onClick={() => mark("known")} data-testid="know-it">
              Know it
            </button>
            <button className={btn.secondary} onClick={() => go(1)} aria-label="Next card">→</button>
          </div>
          <p className="mt-4 hidden text-center text-xs text-slate-400 sm:block">
            <kbd className="rounded bg-slate-100 px-1.5">Space</kbd> flip · <kbd className="rounded bg-slate-100 px-1.5">←</kbd>
            <kbd className="rounded bg-slate-100 px-1.5">→</kbd> move · <kbd className="rounded bg-slate-100 px-1.5">K</kbd>/<kbd className="rounded bg-slate-100 px-1.5">↑</kbd> know it ·{" "}
            <kbd className="rounded bg-slate-100 px-1.5">L</kbd>/<kbd className="rounded bg-slate-100 px-1.5">↓</kbd> still learning
          </p>
        </>
      )}
    </div>
  );
}

function Face({ card, side }: { card: ModeProps["cards"][number]; side: "front" | "back" }) {
  const isFront = side === "front";
  return (
    <div
      className={`flip-face ${isFront ? "" : "flip-back"} flex flex-col rounded-3xl p-6 shadow-lg ring-1 sm:p-8 ${
        isFront ? "bg-white ring-slate-200" : "bg-gradient-to-br from-indigo-600 to-violet-600 text-white ring-indigo-500"
      }`}
    >
      <div className={`flex items-center gap-2 text-xs ${isFront ? "text-slate-500" : "text-indigo-100"}`}>
        {isFront ? <TypeChip type={card.type} /> : <span className="font-medium uppercase tracking-wide">Answer</span>}
        <span className="truncate">{card.topic}</span>
        <span className="ml-auto">{isFront ? <DifficultyDots level={card.difficulty} /> : null}</span>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto py-4">
        <p className={`whitespace-pre-line text-center ${isFront ? "text-2xl font-semibold text-slate-900 sm:text-3xl" : "text-lg leading-relaxed sm:text-xl"}`}>
          {isFront ? card.front : card.back}
        </p>
      </div>
      {!isFront && card.source ? <p className="line-clamp-2 text-center text-xs italic text-indigo-100">“{card.source}”</p> : null}
      {isFront ? <p className="text-center text-xs text-slate-400">Tap to flip</p> : null}
    </div>
  );
}
