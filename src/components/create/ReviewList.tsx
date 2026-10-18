"use client";

import { useMemo, useState } from "react";
import { CARD_TYPE_LABELS, CARD_TYPES, type CardDraft, type CardType } from "@/lib/types";
import { btn, DifficultyDots, input, select, TypeChip } from "../ui";

export type DraftWithId = CardDraft & { key: string };

export function ReviewList({
  cards,
  topics,
  onChange,
}: {
  cards: DraftWithId[];
  topics: string[];
  onChange: (cards: DraftWithId[]) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const allTopics = useMemo(() => [...new Set([...topics, ...cards.map((c) => c.topic)])], [topics, cards]);
  const visible = filter === "all" ? cards : cards.filter((c) => c.topic === filter);

  const update = (key: string, patch: Partial<CardDraft>) => onChange(cards.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const remove = (key: string) => onChange(cards.filter((c) => c.key !== key));
  const add = () =>
    onChange([
      { key: `new-${Date.now()}`, front: "", back: "", type: "definition", topic: filter !== "all" ? filter : allTopics[0] ?? "General", difficulty: 2, source: "" },
      ...cards,
    ]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All (${cards.length})`} />
          {allTopics.map((t) => {
            const n = cards.filter((c) => c.topic === t).length;
            return n ? <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)} label={`${t} (${n})`} /> : null;
          })}
        </div>
        <button className={btn.secondary} onClick={add} data-testid="add-card">
          + Add card
        </button>
      </div>
      <ol className="space-y-3" data-testid="review-list">
        {visible.map((c, i) => (
          <li key={c.key} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono text-slate-400">#{i + 1}</span>
              <TypeChip type={c.type} />
              <DifficultyDots level={c.difficulty} />
              <span className="truncate">{c.topic}</span>
              <button className={`${btn.danger} ml-auto`} onClick={() => remove(c.key)} aria-label="Delete card">
                Delete
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="sr-only">Front</span>
                <textarea
                  className={`${input} min-h-16 font-medium`}
                  value={c.front}
                  placeholder="Term / question"
                  onChange={(e) => update(c.key, { front: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="sr-only">Back</span>
                <textarea
                  className={`${input} min-h-16`}
                  value={c.back}
                  placeholder="Definition / answer"
                  onChange={(e) => update(c.key, { back: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <select className={`${select}`} value={c.type} onChange={(e) => update(c.key, { type: e.target.value as CardType })} aria-label="Card type">
                {CARD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CARD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <select className={`${select} max-w-64`} value={c.topic} onChange={(e) => update(c.key, { topic: e.target.value })} aria-label="Topic area">
                {allTopics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                className={`${select}`}
                value={c.difficulty}
                onChange={(e) => update(c.key, { difficulty: Number(e.target.value) as 1 | 2 | 3 })}
                aria-label="Difficulty"
              >
                <option value={1}>Easy</option>
                <option value={2}>Medium</option>
                <option value={3}>Hard</option>
              </select>
            </div>
            {c.source ? (
              <p className="mt-3 border-l-2 border-slate-200 pl-3 text-xs italic text-slate-500">
                <span className="not-italic font-medium text-slate-400">From your notes: </span>“{c.source}”
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition ${
        active ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}
