"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { summarize, summarizeByTopic } from "@/lib/study/mastery";
import { formatTime } from "@/lib/study/match";
import { CARD_TYPE_LABELS, CARD_TYPES, type ClientCard, type StudyContext } from "@/lib/types";
import { ContextEditor } from "./create/ContextEditor";
import { FilterChip } from "./create/ReviewList";
import { btn, Card, ContextBadge, DifficultyDots, input, ProgressBar, select, TypeChip } from "./ui";

export interface OverviewSet {
  id: string;
  title: string;
  context: StudyContext;
  bestMatchMs: number | null;
  cards: ClientCard[];
}

const jsonHeaders = { "Content-Type": "application/json" };

export function SetOverview({ set }: { set: OverviewSet }) {
  const router = useRouter();
  const [title, setTitle] = useState(set.title);
  const [renaming, setRenaming] = useState(false);
  const [editingCtx, setEditingCtx] = useState(false);
  const [ctx, setCtx] = useState(set.context);
  const [cards, setCards] = useState(set.cards);
  const [topicFilter, setTopicFilter] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const progress = summarize(cards);
  const byTopic = useMemo(() => summarizeByTopic(cards), [cards]);
  const visible = topicFilter === "all" ? cards : cards.filter((c) => c.topic === topicFilter);

  async function saveTitle() {
    if (!title.trim()) return;
    await fetch(`/api/sets/${set.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ title }) });
    setRenaming(false);
    router.refresh();
  }

  async function saveContext() {
    await fetch(`/api/sets/${set.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ context: ctx }) });
    setEditingCtx(false);
    router.refresh();
  }

  async function deleteSet() {
    if (!confirm(`Delete "${set.title}" and all ${cards.length} cards?`)) return;
    await fetch(`/api/sets/${set.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  async function saveCard(c: ClientCard) {
    const res = await fetch(`/api/cards/${c.id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ front: c.front, back: c.back, type: c.type, topic: c.topic, difficulty: c.difficulty }),
    });
    if (res.ok) {
      const { card } = await res.json();
      setCards((cs) => cs.map((x) => (x.id === card.id ? card : x)));
      setEditing(null);
    }
  }

  async function deleteCard(id: string) {
    if (!confirm("Delete this card?")) return;
    const res = await fetch(`/api/cards/${id}`, { method: "DELETE" });
    if (res.ok) setCards((cs) => cs.filter((c) => c.id !== id));
  }

  async function addCard(c: Pick<ClientCard, "front" | "back" | "type" | "topic" | "difficulty">) {
    const res = await fetch(`/api/sets/${set.id}/cards`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ cards: [{ ...c, source: "" }] }) });
    if (res.ok) {
      setAdding(false);
      router.refresh();
      const data = await fetch(`/api/sets/${set.id}`).then((r) => r.json());
      setCards(data.cards);
    }
  }

  const modes = [
    { href: "flashcards", title: "Flashcards", desc: "Flip, mark what you know, filter by topic.", icon: "🃏" },
    { href: "match", title: "Match", desc: set.bestMatchMs ? `Best time ${formatTime(set.bestMatchMs)}` : "Race the clock pairing terms & definitions.", icon: "⚡" },
    { href: "learn", title: "Learn / Test", desc: "Multiple choice and written answers.", icon: "🎯" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← Library
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <ContextBadge name={set.context.name} />
            <span className="text-xs text-slate-500">{cards.length} cards</span>
          </div>
          {renaming ? (
            <form className="flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); saveTitle(); }}>
              <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-label="Set title" />
              <button className={btn.primary}>Save</button>
              <button type="button" className={btn.ghost} onClick={() => { setRenaming(false); setTitle(set.title); }}>
                Cancel
              </button>
            </form>
          ) : (
            <h1 className="text-3xl font-bold tracking-tight text-slate-900" data-testid="set-title">
              {set.title}
            </h1>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/sets/${set.id}/add`} className={btn.primary}>
            + Add notes
          </Link>
          <a href={`/api/sets/${set.id}/export`} className={btn.secondary}>
            Export CSV
          </a>
          <button className={btn.ghost} onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button className={btn.danger} onClick={deleteSet}>
            Delete
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {modes.map((m) => (
          <Link
            key={m.href}
            href={`/sets/${set.id}/${m.href}`}
            className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-indigo-200"
            data-testid={`mode-${m.href}`}
          >
            <div className="text-2xl" aria-hidden="true">{m.icon}</div>
            <h3 className="mt-2 font-semibold text-slate-900 group-hover:text-indigo-700">{m.title}</h3>
            <p className="text-sm text-slate-500">{m.desc}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="font-semibold text-slate-900">Progress</h2>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-slate-900" data-testid="set-progress">{progress.percent}%</span>
            <span className="text-sm text-slate-500">mastered</span>
          </div>
          <ProgressBar className="mt-3" value={progress.percent} />
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-emerald-50 py-2"><dt className="text-emerald-700">Mastered</dt><dd className="text-lg font-semibold text-emerald-800">{progress.mastered}</dd></div>
            <div className="rounded-xl bg-amber-50 py-2"><dt className="text-amber-700">Learning</dt><dd className="text-lg font-semibold text-amber-800">{progress.learning}</dd></div>
            <div className="rounded-xl bg-slate-50 py-2"><dt className="text-slate-500">New</dt><dd className="text-lg font-semibold text-slate-700">{progress.notStarted}</dd></div>
          </dl>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">By topic area</h3>
          <ul className="mt-2 space-y-3">
            {byTopic.map(({ topic, summary }) => (
              <li key={topic}>
                <div className="mb-1 flex justify-between gap-2 text-sm">
                  <span className="truncate text-slate-700">{topic}</span>
                  <span className="shrink-0 text-slate-500">{summary.percent}% · {summary.total}</span>
                </div>
                <ProgressBar value={summary.percent} tone="emerald" />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Study context</h2>
            {editingCtx ? (
              <div className="flex gap-2">
                <button className={btn.ghost} onClick={() => { setEditingCtx(false); setCtx(set.context); }}>Cancel</button>
                <button className={btn.primary} onClick={saveContext}>Save context</button>
              </div>
            ) : (
              <button className={btn.ghost} onClick={() => setEditingCtx(true)}>Edit</button>
            )}
          </div>
          {editingCtx ? (
            <div className="mt-4">
              <ContextEditor value={ctx} onChange={setCtx} />
              <p className="mt-3 text-xs text-slate-500">Changes apply to cards you generate from now on.</p>
            </div>
          ) : (
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Exam / course</dt><dd className="font-medium text-slate-800">{set.context.name || "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Domain</dt><dd className="text-slate-800">{set.context.domain || "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Level</dt><dd className="text-slate-800">{set.context.level || "—"}</dd></div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Topic areas</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {set.context.topicAreas.length ? set.context.topicAreas.map((t) => (
                    <span key={t} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{t}</span>
                  )) : "—"}
                </dd>
              </div>
              {set.context.conventions ? (
                <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Conventions</dt><dd className="text-slate-700">{set.context.conventions}</dd></div>
              ) : null}
            </dl>
          )}
        </Card>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">Cards</h2>
          <button className={btn.secondary} onClick={() => setAdding(true)}>+ Add a card</button>
        </div>
        <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
          <FilterChip active={topicFilter === "all"} onClick={() => setTopicFilter("all")} label={`All (${cards.length})`} />
          {byTopic.map(({ topic, summary }) => (
            <FilterChip key={topic} active={topicFilter === topic} onClick={() => setTopicFilter(topic)} label={`${topic} (${summary.total})`} />
          ))}
        </div>
        {adding ? (
          <CardForm
            topics={set.context.topicAreas}
            initial={{ front: "", back: "", type: "definition", topic: topicFilter !== "all" ? topicFilter : set.context.topicAreas[0] ?? "General", difficulty: 2 }}
            onCancel={() => setAdding(false)}
            onSave={addCard}
          />
        ) : null}
        <ul className="space-y-2" data-testid="card-list">
          {visible.map((c) =>
            editing === c.id ? (
              <li key={c.id}>
                <CardForm topics={set.context.topicAreas} initial={c} onCancel={() => setEditing(null)} onSave={(v) => saveCard({ ...c, ...v })} />
              </li>
            ) : (
              <li key={c.id} className="grid gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 md:grid-cols-[1fr_1.6fr_auto] md:items-start md:gap-6">
                <div>
                  <p className="font-medium text-slate-900">{c.front}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <TypeChip type={c.type} />
                    <DifficultyDots level={c.difficulty} />
                    <span className="truncate">{c.topic}</span>
                  </div>
                </div>
                <p className="whitespace-pre-line text-sm text-slate-700">{c.back}</p>
                <div className="flex items-center gap-1 md:flex-col md:items-end">
                  <MasteryPill mastery={c.mastery} />
                  <button className={btn.ghost} onClick={() => setEditing(c.id)}>Edit</button>
                  <button className={btn.danger} onClick={() => deleteCard(c.id)}>Delete</button>
                </div>
              </li>
            ),
          )}
        </ul>
      </section>
    </div>
  );
}

function MasteryPill({ mastery }: { mastery: number }) {
  if (mastery >= 3) return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Mastered</span>;
  if (mastery > 0) return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Learning</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">New</span>;
}

type CardFields = Pick<ClientCard, "front" | "back" | "type" | "topic" | "difficulty">;

function CardForm({ initial, topics, onSave, onCancel }: { initial: CardFields; topics: string[]; onSave: (c: CardFields) => void; onCancel: () => void }) {
  const [v, setV] = useState<CardFields>({ front: initial.front, back: initial.back, type: initial.type, topic: initial.topic, difficulty: initial.difficulty });
  const allTopics = [...new Set([...topics, v.topic].filter(Boolean))];
  return (
    <form
      className="mb-3 rounded-2xl bg-white p-4 shadow-sm ring-2 ring-indigo-200"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.front.trim() && v.back.trim()) onSave(v);
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <textarea className={`${input} min-h-16`} value={v.front} onChange={(e) => setV({ ...v, front: e.target.value })} placeholder="Term / question" aria-label="Front" autoFocus />
        <textarea className={`${input} min-h-16`} value={v.back} onChange={(e) => setV({ ...v, back: e.target.value })} placeholder="Definition / answer" aria-label="Back" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={`${select}`} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} aria-label="Card type">
          {CARD_TYPES.map((t) => <option key={t} value={t}>{CARD_TYPE_LABELS[t]}</option>)}
        </select>
        <select className={`${select} max-w-64`} value={v.topic} onChange={(e) => setV({ ...v, topic: e.target.value })} aria-label="Topic">
          {allTopics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={`${select}`} value={v.difficulty} onChange={(e) => setV({ ...v, difficulty: Number(e.target.value) })} aria-label="Difficulty">
          <option value={1}>Easy</option>
          <option value={2}>Medium</option>
          <option value={3}>Hard</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button type="button" className={btn.ghost} onClick={onCancel}>Cancel</button>
          <button className={btn.primary}>Save card</button>
        </div>
      </div>
    </form>
  );
}
