import Link from "next/link";
import type { ReactNode } from "react";
import { ContextBadge } from "../ui";

const MODES = [
  { key: "flashcards", label: "Flashcards" },
  { key: "match", label: "Match" },
  { key: "learn", label: "Learn" },
] as const;

export function StudyShell({ setId, title, contextName, mode, children }: { setId: string; title: string; contextName: string; mode: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href={`/sets/${setId}`} className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <span className="block text-xs text-slate-500">← Back to set</span>
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-900">{title}</span>
            <ContextBadge name={contextName} />
          </span>
        </Link>
        <nav className="inline-flex rounded-xl bg-slate-100 p-1 text-sm" aria-label="Study modes">
          {MODES.map((m) => (
            <Link
              key={m.key}
              href={`/sets/${setId}/${m.key}`}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${m.key === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              aria-current={m.key === mode ? "page" : undefined}
            >
              {m.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
