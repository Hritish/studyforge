"use client";

import { useState } from "react";
import type { StudyContext } from "@/lib/types";
import { btn, input } from "../ui";

export function ContextEditor({ value, onChange }: { value: StudyContext; onChange: (c: StudyContext) => void }) {
  const [newTopic, setNewTopic] = useState("");
  const set = (patch: Partial<StudyContext>) => onChange({ ...value, ...patch });

  function addTopic() {
    const t = newTopic.trim();
    if (!t || value.topicAreas.includes(t)) return;
    set({ topicAreas: [...value.topicAreas, t] });
    setNewTopic("");
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Exam / course</span>
        <input className={input} value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. CFA Level II" data-testid="ctx-name" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Subject domain</span>
        <input className={input} value={value.domain} onChange={(e) => set({ domain: e.target.value })} placeholder="e.g. Finance / investment analysis" />
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Level / difficulty</span>
        <input className={input} value={value.level} onChange={(e) => set({ level: e.target.value })} placeholder="e.g. Professional certification, intermediate–advanced" />
      </label>
      <div className="sm:col-span-2">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Topic areas (cards get tagged with these)</span>
        <div className="flex flex-wrap gap-2">
          {value.topicAreas.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm text-indigo-800 ring-1 ring-indigo-100">
              {t}
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded-full text-indigo-500 hover:bg-indigo-100"
                onClick={() => set({ topicAreas: value.topicAreas.filter((x) => x !== t) })}
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
          {value.topicAreas.length === 0 ? <span className="text-sm text-slate-400">None yet — topics will come from your notes&apos; headings.</span> : null}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className={input}
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTopic();
              }
            }}
            placeholder="Add a topic area, e.g. Fixed Income"
          />
          <button type="button" className={btn.secondary} onClick={addTopic}>
            Add
          </button>
        </div>
      </div>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Terminology &amp; notation conventions</span>
        <textarea
          className={`${input} min-h-20`}
          value={value.conventions}
          onChange={(e) => set({ conventions: e.target.value })}
          placeholder="e.g. Use CFA Institute terms (FCFF, FCFE, residual income); formulas like V0 = D1 / (r − g)"
        />
      </label>
    </div>
  );
}
