"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CardCount, CardDraft, GenerationEvent, NoteInput, StudyContext } from "@/lib/types";
import { EMPTY_CONTEXT, IMAGES_NEED_KEY_MESSAGE } from "@/lib/types";
import { btn, Card, input, ProgressBar, Spinner } from "../ui";
import { ContextEditor } from "./ContextEditor";
import { ReviewList, type DraftWithId } from "./ReviewList";

type Step = "input" | "context" | "generating" | "review";
type UploadedNote = NoteInput & { chars: number; pages?: number; width?: number; height?: number };

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif";
const imgSrc = (n: { imageBase64?: string; mediaType?: string }) => `data:${n.mediaType ?? "image/jpeg"};base64,${n.imageBase64}`;

const NOTES_PLACEHOLDER = `Paste your notes here. For example (CFA Level II):

## Equity Valuation
Gordon growth model: V0 = D1 / (r − g)
Residual income: net income minus a charge for the cost of equity capital

## Fixed Income
Z-spread: the constant spread added to every spot rate so discounted cash flows equal the price
OAS = Z-spread − option cost`;

export function CreateFlow({
  engine,
  setId,
  setTitle,
  initialContext,
}: {
  engine: "demo" | "claude";
  /** When set, we're adding notes to an existing set. */
  setId?: string;
  setTitle?: string;
  initialContext?: StudyContext;
}) {
  const router = useRouter();
  const adding = Boolean(setId);
  const [step, setStep] = useState<Step>("input");
  const [title, setTitleState] = useState("");
  const [examName, setExamName] = useState("");
  const [syllabus, setSyllabus] = useState<UploadedNote | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [files, setFiles] = useState<UploadedNote[]>([]);
  const [previewOpen, setPreviewOpen] = useState<string | null>(null);
  const [count, setCount] = useState<CardCount>("auto");
  const [context, setContext] = useState<StudyContext>(initialContext ?? EMPTY_CONTEXT);
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ chunk: number; chunks: number; message: string }>({ chunk: 0, chunks: 1, message: "" });
  const [liveCount, setLiveCount] = useState(0);
  const [drafts, setDrafts] = useState<DraftWithId[]>([]);
  const [dupes, setDupes] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const syllabusRef = useRef<HTMLInputElement>(null);

  const notes: NoteInput[] = [
    ...(pasteText.trim() ? [{ name: "Pasted notes", kind: "paste" as const, text: pasteText }] : []),
    ...files.map(({ name, kind, text, pdfBase64, imageBase64, mediaType }) => ({ name, kind, text, pdfBase64, imageBase64, mediaType })),
  ];
  const totalChars = notes.reduce((a, n) => a + n.text.length, 0);
  const imageCount = notes.filter((n) => n.kind === "image").length + (syllabus?.kind === "image" ? 1 : 0);

  async function upload(list: FileList | File[] | null): Promise<UploadedNote[]> {
    if (!list || list.length === 0) return [];
    const fd = new FormData();
    for (const f of Array.from(list)) fd.append("files", f);
    setBusy("Reading files…");
    setError(null);
    try {
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      if (data.errors?.length) setError(data.errors.join(" "));
      return data.files as UploadedNote[];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      return [];
    } finally {
      setBusy(null);
    }
  }

  async function loadSample() {
    const res = await fetch("/api/sample");
    const data = await res.json();
    if (res.ok) setPasteText(data.text);
  }

  /** Ctrl+V a screenshot into the notes box. */
  async function onPasteNotes(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const named = images.map((f, i) => new File([f], `pasted-screenshot-${stamp}${images.length > 1 ? `-${i + 1}` : ""}.${f.type.split("/")[1] || "png"}`, { type: f.type }));
    const up = await upload(named);
    setFiles((f) => [...f, ...up]);
  }

  async function continueFromInput() {
    setError(null);
    const hasImages = notes.some((n) => n.kind === "image");
    if (notes.length === 0 || (totalChars < 20 && !hasImages)) {
      setError("Add some notes first — paste text or upload a file.");
      return;
    }
    if (adding) {
      void generate(context);
      return;
    }
    setBusy(engine === "claude" ? "Claude is working out what you're studying…" : "Detecting your study context…");
    try {
      const res = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examName: examName || undefined,
          syllabus: syllabus ? { name: syllabus.name, kind: syllabus.kind, text: syllabus.text, pdfBase64: syllabus.pdfBase64 } : undefined,
          notesText: notes.map((n) => n.text).join("\n\n"),
          images: notes.filter((n) => n.kind === "image").slice(0, 6),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Context detection failed.");
      setContext(data.context);
      setContextWarning(data.warning ?? null);
      setStep("context");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Context detection failed.");
    } finally {
      setBusy(null);
    }
  }

  async function generate(ctx: StudyContext) {
    setStep("generating");
    setError(null);
    setWarnings([]);
    setLiveCount(0);
    setProgress({ chunk: 0, chunks: 1, message: "Starting…" });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: ctx, notes, count, setId }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Generation failed.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let final: CardDraft[] | null = null;
      let failed: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as GenerationEvent;
          if (ev.type === "start") setProgress({ chunk: 0, chunks: ev.chunks, message: ev.mode === "demo" ? "Extracting cards (Demo mode)…" : `Generating with ${ev.model}…` });
          if (ev.type === "progress") setProgress({ chunk: ev.chunk, chunks: ev.chunks, message: ev.message });
          if (ev.type === "cards") setLiveCount((n) => n + ev.cards.length);
          if (ev.type === "warning") setWarnings((w) => [...w, ev.message]);
          if (ev.type === "error") failed = ev.message;
          if (ev.type === "done") {
            final = ev.cards;
            setDupes(ev.removedDuplicates);
          }
        }
      }
      if (failed) throw new Error(failed);
      if (!final) throw new Error("Generation ended unexpectedly.");
      setDrafts((final as CardDraft[]).map((c, i) => ({ ...c, key: `g-${i}-${Date.now()}` })));
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
      setStep(adding ? "input" : "context");
    }
  }

  async function save() {
    const cards = drafts.filter((c) => c.front.trim() && c.back.trim()).map((d) => ({ front: d.front, back: d.back, type: d.type, topic: d.topic, difficulty: d.difficulty, source: d.source }));
    if (cards.length === 0) {
      setError("There are no complete cards to save.");
      return;
    }
    setBusy("Saving…");
    setError(null);
    const savedNotes = notes.map(({ name, kind, text }) => ({ name, kind, text }));
    try {
      const res = adding
        ? await fetch(`/api/sets/${setId}/cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards, notes: savedNotes }) })
        : await fetch("/api/sets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title || undefined, context, contextConfirmed: true, cards, notes: savedNotes }),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      router.push(`/sets/${adding ? setId : data.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setBusy(null);
    }
  }

  const steps = adding ? ["Notes", "Generate", "Review"] : ["Notes & context", "Confirm context", "Generate", "Review"];
  const stepIndex = adding
    ? { input: 0, context: 0, generating: 1, review: 2 }[step]
    : { input: 0, context: 1, generating: 2, review: 3 }[step];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        {adding ? (
          <Link href={`/sets/${setId}`} className="text-sm text-slate-500 hover:text-slate-800">
            ← {setTitle}
          </Link>
        ) : null}
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{adding ? "Add notes & generate more cards" : "New study set"}</h1>
        <ol className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
          {steps.map((s, i) => (
            <li
              key={s}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${
                i === stepIndex ? "bg-indigo-600 text-white" : i < stepIndex ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              <span>{i + 1}</span> {s}
            </li>
          ))}
        </ol>
        {engine === "demo" ? (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200" data-testid="demo-banner">
            <strong>Demo mode:</strong> no <code>ANTHROPIC_API_KEY</code> is set, so cards are extracted offline from lines like
            &nbsp;<code>Term: definition</code>, <code>Term - definition</code> and headings with bullets. Context detection uses keyword matching.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mb-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200" role="alert">
          {error}
        </div>
      ) : null}

      {step === "input" ? (
        <div className="space-y-5">
          {!adding ? (
            <Card>
              <h2 className="text-lg font-semibold text-slate-900">What are you studying?</h2>
              <p className="mb-4 text-sm text-slate-500">Optional. Give an exam or course name, upload a syllabus, both, or neither — we&apos;ll infer it from your notes.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Exam or course</span>
                  <input
                    className={input}
                    value={examName}
                    onChange={(e) => setExamName(e.target.value)}
                    placeholder="e.g. CFA Level II, MCAT, AWS Solutions Architect"
                    data-testid="exam-name"
                  />
                </label>
                <div>
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Syllabus / curriculum outline</span>
                  {syllabus ? (
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-200">
                      <span className="flex min-w-0 items-center gap-2 truncate">
                        {syllabus.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgSrc(syllabus)} alt="" className="h-8 w-12 rounded object-cover ring-1 ring-slate-200" />
                        ) : (
                          "📄"
                        )}
                        {syllabus.name}
                        {syllabus.kind === "image" ? "" : ` · ${syllabus.chars.toLocaleString()} chars`}
                      </span>
                      <button className={btn.ghost} onClick={() => setSyllabus(null)}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button className={`${btn.secondary} w-full`} onClick={() => syllabusRef.current?.click()}>
                      Upload syllabus (PDF, DOCX, TXT, MD, image)
                    </button>
                  )}
                  <input
                    ref={syllabusRef}
                    type="file"
                    className="hidden"
                    accept={ACCEPT}
                    onChange={async (e) => {
                      const [f] = await upload(e.target.files);
                      if (f) setSyllabus(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Set title (optional)</span>
                <input className={input} value={title} onChange={(e) => setTitleState(e.target.value)} placeholder="e.g. CFA L2 — Equity & Fixed Income" />
              </label>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-slate-600">
                New cards will use this set&apos;s study context: <strong>{context.name || "General"}</strong>
                {context.topicAreas.length ? ` · ${context.topicAreas.length} topic areas` : ""}. Duplicates of existing cards are skipped.
              </p>
            </Card>
          )}

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Your notes</h2>
                <p className="text-sm text-slate-500">
                  Paste text and/or upload files (.txt, .md, .pdf, .docx) or slide screenshots (.png, .jpg, .webp, .gif). Tip: paste a screenshot with Ctrl+V.
                </p>
              </div>
              <button className={btn.ghost} onClick={loadSample} data-testid="use-sample">
                Use sample CFA notes
              </button>
            </div>
            <textarea
              className={`${input} min-h-56 font-mono text-[13px] leading-relaxed`}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onPaste={onPasteNotes}
              placeholder={NOTES_PLACEHOLDER}
              data-testid="notes-text"
            />
            <div
              className="mt-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 transition hover:border-indigo-300 hover:bg-indigo-50/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                const up = await upload(e.dataTransfer.files);
                setFiles((f) => [...f, ...up]);
              }}
            >
              <p>
                Drag &amp; drop files here, or{" "}
                <button className="font-semibold text-indigo-600 hover:underline" onClick={() => fileRef.current?.click()}>
                  browse
                </button>
              </p>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                accept={ACCEPT}
                onChange={async (e) => {
                  const up = await upload(e.target.files);
                  setFiles((f) => [...f, ...up]);
                  e.target.value = "";
                }}
              />
            </div>
            {files.length ? (
              <ul className="mt-3 space-y-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="rounded-xl bg-slate-50 ring-1 ring-slate-200">
                    <div className="flex items-center gap-2 px-3 py-2 text-sm">
                      {f.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imgSrc(f)} alt={`Thumbnail of ${f.name}`} className="h-10 w-16 shrink-0 rounded-md object-cover ring-1 ring-slate-200" data-testid="image-thumb" />
                      ) : (
                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] uppercase text-slate-500 ring-1 ring-slate-200">{f.kind}</span>
                      )}
                      <span className="truncate font-medium text-slate-800">{f.name}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {f.kind === "image" ? `${f.width}×${f.height}px` : `${f.chars.toLocaleString()} chars`}
                        {f.pages ? ` · ${f.pages} pages` : ""}
                      </span>
                      <button className={`${btn.ghost} ml-auto`} onClick={() => setPreviewOpen(previewOpen === f.name ? null : f.name)}>
                        {previewOpen === f.name ? "Hide" : "Preview"}
                      </button>
                      <button className={btn.danger} onClick={() => setFiles(files.filter((_, k) => k !== i))}>
                        Remove
                      </button>
                    </div>
                    {previewOpen === f.name && f.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgSrc(f)} alt={f.name} className="max-h-96 w-full border-t border-slate-200 bg-white object-contain p-2" />
                    ) : previewOpen === f.name ? (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-slate-200 px-3 py-2 text-xs text-slate-600" data-testid="file-preview">
                        {f.text.slice(0, 4000)}
                        {f.text.length > 4000 ? `\n\n… ${(f.text.length - 4000).toLocaleString()} more characters (all of it will be used)` : ""}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {engine === "demo" && imageCount > 0 ? (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200" data-testid="image-demo-notice">
                <strong>{IMAGES_NEED_KEY_MESSAGE}.</strong> {imageCount} image{imageCount === 1 ? " is" : "s are"} attached but will be skipped in Demo mode
                {totalChars >= 20 ? "; cards will come from your text notes." : "."}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-slate-500">
              {imageCount ? `${imageCount} image${imageCount === 1 ? "" : "s"} · ` : ""}
              {notes.length} source{notes.length === 1 ? "" : "s"} · {totalChars.toLocaleString()} characters · ~{Math.ceil(totalChars / 4).toLocaleString()} tokens
              {totalChars / 4 > 30000 ? " · long notes will be split into sections and processed in parts" : ""}
            </p>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">How many cards?</h2>
            <div className="inline-flex rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Number of cards">
              {(["auto", 10, 25, 50] as CardCount[]).map((c) => (
                <button
                  key={String(c)}
                  role="radio"
                  aria-checked={count === c}
                  onClick={() => setCount(c)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${count === c ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {c === "auto" ? "Auto" : `~${c}`}
                </button>
              ))}
            </div>
          </Card>

          <div className="flex justify-end">
            <button className={btn.primary} onClick={continueFromInput} disabled={Boolean(busy)} data-testid="continue">
              {busy ? <Spinner /> : null}
              {busy ?? (adding ? "Generate cards" : "Continue")}
            </button>
          </div>
        </div>
      ) : null}

      {step === "context" ? (
        <Card className="animate-fade-up">
          {context.name && context.source === "inferred" ? (
            <h2 className="text-xl font-semibold text-slate-900" data-testid="context-question">
              Looks like you&apos;re studying <span className="text-indigo-700">{context.name}</span> — correct?
            </h2>
          ) : context.name ? (
            <h2 className="text-xl font-semibold text-slate-900">
              Study context: <span className="text-indigo-700">{context.name}</span>
            </h2>
          ) : (
            <h2 className="text-xl font-semibold text-slate-900">We couldn&apos;t tell what you&apos;re studying</h2>
          )}
          <p className="mb-5 mt-1 text-sm text-slate-500">
            {context.name
              ? "Cards will use this exam's terminology, emphasize what's testable, and be tagged with these topic areas. Edit anything that's off."
              : "That's fine — add an exam or course name if you like, or continue with a general context."}
            {typeof context.confidence === "number" && context.source === "inferred" && context.name ? ` (confidence ${Math.round(context.confidence * 100)}%)` : ""}
          </p>
          {contextWarning ? <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{contextWarning}</p> : null}
          <ContextEditor value={context} onChange={setContext} />
          <div className="mt-6 flex flex-wrap justify-between gap-3">
            <button className={btn.secondary} onClick={() => setStep("input")}>
              ← Back
            </button>
            <button className={btn.primary} onClick={() => generate({ ...context, source: context.source === "inferred" ? "user" : context.source })} data-testid="confirm-generate">
              {context.name && context.source === "inferred" ? "Yes, generate cards" : "Generate cards"}
            </button>
          </div>
        </Card>
      ) : null}

      {step === "generating" ? (
        <Card className="animate-fade-up">
          <div className="flex items-center gap-3">
            <Spinner className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-900">Generating flashcards{context.name ? ` for ${context.name}` : ""}…</h2>
          </div>
          <ProgressBar className="mt-5" value={progress.chunks ? (Math.max(0, progress.chunk - 0.5) / progress.chunks) * 100 : 5} />
          <div className="mt-2 flex justify-between text-sm text-slate-500" data-testid="gen-progress">
            <span>{progress.message}</span>
            <span>
              Part {Math.max(1, progress.chunk)} of {progress.chunks} · {liveCount} cards
            </span>
          </div>
          {warnings.length ? (
            <ul className="mt-4 space-y-1 text-sm text-amber-800">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {step === "review" ? (
        <div className="animate-fade-up">
          <div className="sticky top-14 z-20 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 bg-[var(--background)]/90 px-4 py-3 backdrop-blur">
            <div>
              <h2 className="text-xl font-semibold text-slate-900" data-testid="review-heading">
                Review {drafts.length} cards
              </h2>
              <p className="text-sm text-slate-500">
                Edit, delete or add cards, then save.{dupes ? ` ${dupes} duplicate${dupes === 1 ? "" : "s"} removed.` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <button className={btn.secondary} onClick={() => setStep(adding ? "input" : "context")}>
                Start over
              </button>
              <button className={btn.primary} onClick={save} disabled={Boolean(busy) || drafts.length === 0} data-testid="save-set">
                {busy ? <Spinner /> : null} {adding ? `Add ${drafts.length} cards` : "Save study set"}
              </button>
            </div>
          </div>
          {warnings.length ? (
            <ul className="mb-4 space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          <ReviewList cards={drafts} topics={context.topicAreas} onChange={setDrafts} />
        </div>
      ) : null}
    </div>
  );
}
