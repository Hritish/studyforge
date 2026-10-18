"use client";

import { useEffect, useRef, useState } from "react";
import { checkAnswer, type AnswerVerdict } from "@/lib/study/answer";
import { buildQuiz, type McQuestion } from "@/lib/study/learn";
import type { StudyResult } from "@/lib/study/mastery";
import { shuffle } from "@/lib/study/random";
import type { ClientCard } from "@/lib/types";
import { btn, input, ProgressBar } from "../ui";
import { recordResults, type ModeProps } from "./progress";

type QuizMode = "mc" | "written";
type WrittenAnswerSide = "term" | "definition";

interface Answered {
  cardId: string;
  correct: boolean;
  given: string;
}

export function LearnMode({ setId, cards }: ModeProps) {
  const [mode, setMode] = useState<QuizMode>("mc");
  const [side, setSide] = useState<WrittenAnswerSide>("term");
  const [size, setSize] = useState<number>(10);
  const [questions, setQuestions] = useState<McQuestion[] | null>(null);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answered[]>([]);
  const byId = new Map(cards.map((c) => [c.id, c]));

  function start(subset?: ClientCard[]) {
    const pool = subset ?? cards;
    setQuestions(buildQuiz(pool, Math.random, subset ? pool.length : size).map((q) => ({ ...q, options: q.options })));
    setI(0);
    setAnswers([]);
  }

  function answer(cardId: string, correct: boolean, given: string) {
    setAnswers((a) => [...a, { cardId, correct, given }]);
    const result: StudyResult = correct ? "correct" : "incorrect";
    void recordResults(setId, [{ cardId, result }]);
  }

  if (cards.length < 2) {
    return <p className="rounded-2xl bg-white p-8 text-center text-slate-600 ring-1 ring-slate-200">Add at least 2 cards to use Learn mode.</p>;
  }

  if (!questions) {
    return (
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
        <h2 className="text-2xl font-bold text-slate-900">Learn / Test</h2>
        <p className="mt-1 text-slate-600">Answer questions to build mastery. Missed cards are listed at the end.</p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Question type</legend>
            <div className="grid gap-2">
              <Choice active={mode === "mc"} onClick={() => setMode("mc")} title="Multiple choice" desc="Pick the right definition for each term." testId="learn-mc" />
              <Choice active={mode === "written"} onClick={() => setMode("written")} title="Written" desc="Type the answer — small typos are forgiven." testId="learn-written" />
            </div>
          </fieldset>
          <div className="space-y-5">
            {mode === "written" ? (
              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Answer with</legend>
                <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm">
                  {(["term", "definition"] as const).map((s) => (
                    <button key={s} onClick={() => setSide(s)} className={`rounded-lg px-4 py-1.5 font-medium capitalize ${side === s ? "bg-white shadow-sm" : "text-slate-600"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <fieldset>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</legend>
              <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm">
                {[10, 20, cards.length].filter((n, k, arr) => n <= cards.length && arr.indexOf(n) === k).map((n) => (
                  <button key={n} onClick={() => setSize(n)} className={`rounded-lg px-4 py-1.5 font-medium ${size === n ? "bg-white shadow-sm" : "text-slate-600"}`}>
                    {n === cards.length ? `All (${n})` : n}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
        <button className={`${btn.primary} mt-8 px-8`} onClick={() => start()} data-testid="learn-start">
          Start
        </button>
      </div>
    );
  }

  if (i >= questions.length) {
    const correct = answers.filter((a) => a.correct).length;
    const missed = answers.filter((a) => !a.correct).map((a) => ({ ...a, card: byId.get(a.cardId)! }));
    const pct = Math.round((correct / Math.max(1, answers.length)) * 100);
    return (
      <div className="animate-fade-up rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10" data-testid="learn-summary">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Score</p>
        <p className="mt-1 text-5xl font-bold text-slate-900">
          {correct}/{answers.length} <span className="text-2xl text-slate-500">({pct}%)</span>
        </p>
        <ProgressBar className="mt-4" value={pct} tone="emerald" />
        {missed.length ? (
          <>
            <h3 className="mt-8 font-semibold text-slate-900">Missed cards ({missed.length})</h3>
            <ul className="mt-3 space-y-2">
              {missed.map((m) => (
                <li key={m.cardId} className="rounded-xl bg-rose-50/60 p-4 ring-1 ring-rose-100">
                  <p className="font-medium text-slate-900">{m.card.front}</p>
                  <p className="mt-1 text-sm text-slate-700">{m.card.back}</p>
                  {m.given ? <p className="mt-1 text-xs text-rose-700">You answered: {m.given}</p> : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-6 text-emerald-700">Perfect score — nothing missed. 🎉</p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          {missed.length ? (
            <button className={btn.primary} onClick={() => start(shuffle(missed.map((m) => m.card)))}>
              Retry missed cards
            </button>
          ) : null}
          <button className={btn.secondary} onClick={() => setQuestions(null)}>
            New test
          </button>
        </div>
      </div>
    );
  }

  const q = questions[i];
  const card = byId.get(q.cardId)!;
  return (
    <div>
      <div className="mb-4 flex items-center gap-3 text-sm text-slate-500">
        <span data-testid="learn-counter">
          {i + 1} / {questions.length}
        </span>
        <ProgressBar className="flex-1" value={(i / questions.length) * 100} />
        <span className="text-emerald-700">{answers.filter((a) => a.correct).length} correct</span>
      </div>
      {mode === "mc" ? (
        <McQuestionView key={q.cardId + i} q={q} card={card} onAnswer={(ok, given) => answer(q.cardId, ok, given)} onNext={() => setI(i + 1)} />
      ) : (
        <WrittenQuestionView key={q.cardId + i} card={card} side={side} onAnswer={(ok, given) => answer(q.cardId, ok, given)} onNext={() => setI(i + 1)} />
      )}
    </div>
  );
}

function Choice({ active, onClick, title, desc, testId }: { active: boolean; onClick: () => void; title: string; desc: string; testId: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`rounded-xl p-4 text-left ring-1 transition ${active ? "bg-indigo-50 ring-2 ring-indigo-500" : "bg-white ring-slate-200 hover:ring-indigo-300"}`}
    >
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="text-sm text-slate-500">{desc}</p>
    </button>
  );
}

function McQuestionView({ q, card, onAnswer, onNext }: { q: McQuestion; card: ClientCard; onAnswer: (ok: boolean, given: string) => void; onNext: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (picked === null) {
        const n = Number(e.key);
        if (n >= 1 && n <= q.options.length) pick(n - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function pick(k: number) {
    if (picked !== null) return;
    setPicked(k);
    onAnswer(k === q.correctIndex, k === q.correctIndex ? "" : q.options[k]);
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.topic} · Term</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900" data-testid="learn-prompt">{q.prompt}</p>
      <p className="mt-6 text-sm text-slate-500">Choose the matching definition</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.options.map((o, k) => {
          const state = picked === null ? "idle" : k === q.correctIndex ? "correct" : k === picked ? "wrong" : "dim";
          return (
            <button
              key={k}
              onClick={() => pick(k)}
              data-testid="learn-option"
              data-correct={k === q.correctIndex ? "true" : "false"}
              className={`flex gap-3 rounded-xl p-4 text-left text-sm ring-1 transition ${
                state === "correct"
                  ? "bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500"
                  : state === "wrong"
                    ? "bg-rose-50 text-rose-900 ring-2 ring-rose-400"
                    : state === "dim"
                      ? "bg-white text-slate-400 ring-slate-100"
                      : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-50 hover:ring-indigo-300"
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500">{k + 1}</span>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      {picked !== null ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className={`text-sm font-semibold ${picked === q.correctIndex ? "text-emerald-700" : "text-rose-700"}`}>
            {picked === q.correctIndex ? "Correct!" : "Not quite — the correct answer is highlighted."}
          </p>
          <button className={btn.primary} onClick={onNext} autoFocus data-testid="learn-next">
            Continue →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WrittenQuestionView({ card, side, onAnswer, onNext }: { card: ClientCard; side: WrittenAnswerSide; onAnswer: (ok: boolean, given: string) => void; onNext: () => void }) {
  const [value, setValue] = useState("");
  const [verdict, setVerdict] = useState<AnswerVerdict | null>(null);
  const [overridden, setOverridden] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prompt = side === "term" ? card.back : card.front;
  const expected = side === "term" ? card.front : card.back;

  function submit() {
    if (verdict) {
      if (verdict === "close" && !overridden) onAnswer(false, value);
      return onNext();
    }
    const r = checkAnswer(value, expected);
    setVerdict(r.verdict);
    // "close" is shown as "almost" and counts as wrong unless the user overrides.
    if (r.verdict !== "close") onAnswer(r.verdict === "correct", value);
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {card.topic} · {side === "term" ? "Definition" : "Term"}
      </p>
      <p className="mt-2 text-xl font-semibold leading-relaxed text-slate-900" data-testid="learn-prompt">{prompt}</p>
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="mb-1 block text-sm text-slate-500" htmlFor="written-answer">
          Type the {side}
        </label>
        <input
          id="written-answer"
          ref={inputRef}
          className={`${input} text-base`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={verdict !== null}
          autoFocus
          autoComplete="off"
          data-testid="learn-input"
        />
        {verdict === null ? (
          <div className="mt-4 flex justify-between">
            <button type="button" className={btn.ghost} onClick={() => { setVerdict("incorrect"); onAnswer(false, ""); }}>
              Don&apos;t know
            </button>
            <button className={btn.primary} data-testid="learn-submit">Check</button>
          </div>
        ) : (
          <div className="mt-4">
            <div
              className={`rounded-xl p-4 text-sm ${
                verdict === "correct" || overridden ? "bg-emerald-50 text-emerald-900" : verdict === "close" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-900"
              }`}
              data-testid="learn-verdict"
              data-verdict={overridden ? "correct" : verdict}
            >
              <p className="font-semibold">{verdict === "correct" || overridden ? "Correct!" : verdict === "close" ? "Almost!" : "Incorrect"}</p>
              {verdict !== "correct" ? <p className="mt-1">Expected: <strong>{expected}</strong></p> : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {verdict === "close" && !overridden ? (
                <>
                  <button type="button" className={btn.secondary} onClick={() => { onAnswer(false, value); onNext(); }}>
                    Count as wrong
                  </button>
                  <button type="button" className={btn.primary} onClick={() => { setOverridden(true); onAnswer(true, value); }}>
                    I was right
                  </button>
                </>
              ) : (
                <button className={btn.primary} data-testid="learn-next" autoFocus>
                  Continue →
                </button>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
