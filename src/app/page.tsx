import Link from "next/link";
import { LibraryGrid } from "@/components/LibraryGrid";
import { btn } from "@/components/ui";
import { prisma } from "@/lib/db";
import { engineMode } from "@/lib/engine";
import { summarize } from "@/lib/study/mastery";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sets = await prisma.studySet.findMany({
    orderBy: { updatedAt: "desc" },
    include: { cards: { select: { mastery: true, status: true } } },
  });
  const demo = sets.find((s) => s.contextName === "CFA Level II");
  const mode = engineMode();
  const items = sets.map((s) => ({
    id: s.id,
    title: s.title,
    contextName: s.contextName,
    cardCount: s.cards.length,
    progress: summarize(s.cards),
  }));

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_70%_-10%,#e0e7ff_0%,transparent_60%),radial-gradient(40rem_25rem_at_0%_10%,#f3e8ff_0%,transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-12 md:grid-cols-2 md:pt-20">
          <div className="animate-fade-up">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Context-aware flashcards
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Your notes, turned into <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">exam-ready</span> flashcards.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-slate-600">
              StudyForge figures out what you&apos;re studying — CFA Level II, MCAT, AWS, Organic Chemistry — and writes cards in that exam&apos;s
              language, tagged by syllabus topic, with the formulas that get tested.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/new" className={btn.primary}>
                Create a study set
              </Link>
              {demo ? (
                <Link href={`/sets/${demo.id}`} className={btn.secondary}>
                  Try the CFA Level II demo →
                </Link>
              ) : null}
            </div>
            {mode === "demo" ? (
              <p className="mt-4 text-xs text-slate-500">
                Running in <strong>Demo mode</strong> (no API key): cards are extracted with simple patterns. Add <code className="rounded bg-slate-100 px-1">ANTHROPIC_API_KEY</code> for full AI generation.
              </p>
            ) : null}
          </div>
          <HeroPreview />
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["1", "Tell us what you're studying", "Type an exam or course, upload a syllabus — or skip it and we'll infer it from your notes."],
            ["2", "Drop in your notes", "Paste text or upload .txt, .md, .pdf and .docx files. Long notes are chunked, never truncated."],
            ["3", "Review, then study", "Edit the cards, then drill with Flashcards, Match and Learn. Progress is tracked per topic."],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-2xl bg-white/70 p-5 ring-1 ring-slate-200/80">
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">{n}</div>
              <h3 className="font-semibold text-slate-900">{t}</h3>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Library */}
      <section id="library" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-10">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Your library</h2>
            <p className="text-sm text-slate-500">{items.length} study {items.length === 1 ? "set" : "sets"}</p>
          </div>
          <Link href="/new" className={btn.secondary}>
            + New set
          </Link>
        </div>
        <LibraryGrid sets={items} />
      </section>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md animate-fade-up [animation-delay:120ms]" aria-hidden="true">
      <div className="absolute -right-3 top-6 h-full w-full rotate-3 rounded-3xl bg-violet-200/60" />
      <div className="relative rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between text-xs">
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 font-semibold text-indigo-700 ring-1 ring-indigo-100">CFA Level II</span>
          <span className="text-slate-400">Equity Valuation · Formula</span>
        </div>
        <p className="mt-8 text-center text-xl font-semibold text-slate-900">Gordon growth model</p>
        <div className="my-6 border-t border-dashed border-slate-200" />
        <p className="text-center font-mono text-lg text-indigo-700">V₀ = D₁ / (r − g)</p>
        <p className="mt-2 text-center text-sm text-slate-500">D₁ next dividend · r required return on equity · g constant growth (g &lt; r)</p>
        <div className="mt-8 grid grid-cols-2 gap-2 text-sm">
          <span className="rounded-xl bg-rose-50 py-2 text-center font-medium text-rose-700">Still learning</span>
          <span className="rounded-xl bg-emerald-50 py-2 text-center font-medium text-emerald-700">Know it</span>
        </div>
      </div>
    </div>
  );
}
