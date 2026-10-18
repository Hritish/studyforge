"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProgressSummary } from "@/lib/study/mastery";
import { btn, ContextBadge, input, ProgressBar } from "./ui";

export interface LibraryItem {
  id: string;
  title: string;
  contextName: string;
  cardCount: number;
  progress: ProgressSummary;
}

export function LibraryGrid({ sets }: { sets: LibraryItem[] }) {
  if (sets.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-10 text-center">
        <p className="font-medium text-slate-700">No study sets yet.</p>
        <p className="mt-1 text-sm text-slate-500">Create one from your notes, or run <code>npm run db:seed</code> for the CFA demo.</p>
        <Link href="/new" className={`${btn.primary} mt-5`}>
          Create your first set
        </Link>
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="library">
      {sets.map((s) => (
        <SetTile key={s.id} set={s} />
      ))}
    </div>
  );
}

function SetTile({ set }: { set: LibraryItem }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(set.title);
  const [busy, setBusy] = useState(false);

  async function rename() {
    if (!title.trim()) return;
    setBusy(true);
    await fetch(`/api/sets/${set.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    setBusy(false);
    setRenaming(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete "${set.title}" and its ${set.cardCount} cards? This can't be undone.`)) return;
    setBusy(true);
    await fetch(`/api/sets/${set.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="group relative flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <ContextBadge name={set.contextName} />
        <div className="relative z-10">
          <button className={btn.ghost} onClick={() => setMenu((m) => !m)} aria-label="Set actions" aria-expanded={menu}>
            •••
          </button>
          {menu ? (
            <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-xl bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200" onMouseLeave={() => setMenu(false)}>
              <button className="block w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setRenaming(true); setMenu(false); }}>
                Rename
              </button>
              <a className="block px-3 py-2 hover:bg-slate-50" href={`/api/sets/${set.id}/export`}>
                Export CSV
              </a>
              <button className="block w-full px-3 py-2 text-left text-rose-600 hover:bg-rose-50" onClick={remove} disabled={busy}>
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {renaming ? (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); rename(); }}>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-label="Set title" />
          <button className={btn.primary} disabled={busy}>Save</button>
        </form>
      ) : (
        <Link href={`/sets/${set.id}`} className="mt-3 line-clamp-2 text-lg font-semibold leading-snug text-slate-900 after:absolute after:inset-0 after:content-['']">
          {set.title}
        </Link>
      )}
      <div className="mt-auto pt-5">
        <div className="mb-1.5 flex justify-between text-xs text-slate-500">
          <span>{set.cardCount} cards</span>
          <span>{set.progress.percent}% mastered</span>
        </div>
        <ProgressBar value={set.progress.percent} />
      </div>
    </div>
  );
}
