import type { ReactNode } from "react";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50",
};

export const input =
  "w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none";

export const select =
  "rounded-xl border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 ${className}`}>{children}</div>;
}

export function ProgressBar({ value, className = "", tone = "indigo" }: { value: number; className?: string; tone?: "indigo" | "emerald" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${tone === "emerald" ? "bg-emerald-500" : "bg-gradient-to-r from-indigo-500 to-violet-500"}`}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function ContextBadge({ name }: { name: string }) {
  if (!name) return <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">General</span>;
  return <span className="shrink-0 whitespace-nowrap rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">{name}</span>;
}

const TYPE_STYLES: Record<string, string> = {
  definition: "bg-sky-50 text-sky-700 ring-sky-100",
  concept: "bg-violet-50 text-violet-700 ring-violet-100",
  formula: "bg-amber-50 text-amber-800 ring-amber-100",
  calculation: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  compare: "bg-rose-50 text-rose-700 ring-rose-100",
};

export function TypeChip({ type }: { type: string }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ${TYPE_STYLES[type] ?? "bg-slate-50 text-slate-600 ring-slate-100"}`}>
      {type === "compare" ? "compare" : type}
    </span>
  );
}

export function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Difficulty ${level}/3`} aria-label={`Difficulty ${level} of 3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= level ? "bg-slate-500" : "bg-slate-200"}`} />
      ))}
    </span>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
