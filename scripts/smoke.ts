/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON in a test script */
/**
 * End-to-end smoke test of the demo-mode flow against a running server.
 *   npm run build && npm start   (port 3100)
 *   npm run smoke                 (BASE_URL=http://localhost:3100 by default)
 * Creates a temporary set and deletes it at the end.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let passed = 0;

function ok(cond: unknown, label: string): asserts cond {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

async function json<T = any>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, init);
  return { status: res.status, body: (await res.json()) as T };
}

const post = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function generate(body: unknown) {
  const res = await fetch(`${BASE}/api/generate`, post(body));
  const text = await res.text();
  const events = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { status: res.status, events, done: events.find((e) => e.type === "done") };
}

async function main() {
  console.log(`StudyForge smoke test → ${BASE}\n`);

  // 1. Status + pages
  const status = await json("/api/status");
  ok(status.status === 200 && ["demo", "claude"].includes(status.body.mode), `status endpoint (mode: ${status.body.mode})`);
  const demo = status.body.mode === "demo";
  const home = await fetch(BASE + "/").then((r) => r.text());
  ok(home.includes("StudyForge") && home.includes("Your library"), "home page renders library");
  if (demo) ok(home.includes("Demo mode"), "home page shows Demo mode label");
  const newPage = await fetch(BASE + "/new").then((r) => r.text());
  ok(newPage.includes("CFA Level II"), "new-set page uses CFA Level II placeholder");

  // 2. Library contains the seeded CFA set
  const lib = await json("/api/sets");
  ok(lib.body.sets.some((s: any) => s.contextName === "CFA Level II" && s.cardCount >= 20), "seeded CFA Level II set present with ~20 cards");

  // 3. File extraction (md + docx + pdf)
  const fd = new FormData();
  fd.append("files", new Blob([readFileSync("samples/cfa-level-2-notes.md")]), "cfa-level-2-notes.md");
  fd.append("files", new Blob([readFileSync("tests/fixtures/greeks.docx")]), "greeks.docx");
  fd.append("files", new Blob([readFileSync("tests/fixtures/fixed-income.pdf")]), "fixed-income.pdf");
  const ex = await json("/api/extract", { method: "POST", body: fd });
  ok(ex.status === 200 && ex.body.files.length === 3 && ex.body.errors.length === 0, "extract .md/.docx/.pdf");
  const [md, docx, pdf] = ex.body.files;
  ok(docx.text.includes("Gamma: rate of change of delta"), "docx text extracted via mammoth");
  ok(pdf.text.includes("Spot rate") && typeof pdf.pdfBase64 === "string", "pdf text extracted + base64 kept for native PDF input");

  // 3b. Image upload (slide screenshot): downscaled + re-encoded for vision
  const imgFd = new FormData();
  imgFd.append("files", new Blob([readFileSync("tests/fixtures/cfa-slide.png")]), "cfa-slide.png");
  const imgEx = await json("/api/extract", { method: "POST", body: imgFd });
  const slide = imgEx.body.files?.[0];
  ok(imgEx.status === 200 && slide?.kind === "image" && slide.mediaType === "image/jpeg" && slide.width === 1568, "image upload downscaled to 1568px JPEG");
  const imgCtx = await json("/api/context", post({ notesText: md.text, images: [slide] }));
  ok(imgCtx.status === 200 && imgCtx.body.context.name === "CFA Level II", "context detection accepts images");
  if (demo) ok(String(imgCtx.body.warning).includes("requires an Anthropic API key"), "demo mode: images-need-key notice on context");
  if (demo) {
    const onlyImg = await generate({ context: imgCtx.body.context, notes: [slide], count: "auto" });
    ok(onlyImg.events.some((e) => e.type === "error" && e.message.includes("ANTHROPIC_API_KEY")), "demo mode: image-only generation explains the API-key requirement");
    const mixed = await generate({ context: imgCtx.body.context, notes: [slide, { name: "n", kind: "paste", text: "Alpha: first letter\nBeta: second letter" }], count: "auto" });
    ok(mixed.done?.cards.length === 2 && mixed.events.some((e) => e.type === "warning" && e.message.includes("ANTHROPIC_API_KEY")), "demo mode: text + images still generates from text, with notice");
  }

  // 4. Context detection from notes only
  const ctx = await json("/api/context", post({ notesText: md.text }));
  ok(ctx.status === 200 && ctx.body.context.name === "CFA Level II", `context inferred from notes: "${ctx.body.context.name}" (${ctx.body.context.source})`);
  ok(ctx.body.context.topicAreas.includes("Fixed Income"), "context has CFA topic areas");
  const named = await json("/api/context", post({ examName: "MCAT" }));
  ok(named.body.context.name === "MCAT" && named.body.context.topicAreas.length > 0, "context from exam name (MCAT)");

  // 5. Generation (streamed)
  const context = { ...ctx.body.context, source: "user" };
  const gen = await generate({ context, notes: [{ name: md.name, kind: md.kind, text: md.text }, { name: pdf.name, kind: "pdf", text: pdf.text, pdfBase64: pdf.pdfBase64 }], count: 25 });
  ok(gen.status === 200 && gen.events[0].type === "start", "generation stream started");
  ok(gen.events.some((e) => e.type === "progress"), "progress events streamed");
  ok(gen.done && gen.done.cards.length >= 10, `generated ${gen.done?.cards.length} cards`);
  const cards = gen.done.cards;
  ok(cards.every((c: any) => c.front && c.back && c.topic && [1, 2, 3].includes(c.difficulty) && c.type), "cards have front/back/type/topic/difficulty");
  ok(cards.some((c: any) => c.type === "formula") && cards.every((c: any) => c.source), "formula cards + source excerpts present");
  ok(new Set(cards.map((c: any) => c.topic)).size >= 3, "cards tagged across ≥3 topic areas");

  // 6. Save the reviewed set (simulate edit/delete/add during review)
  const reviewed = cards.slice(1);
  reviewed[0] = { ...reviewed[0], back: reviewed[0].back + " (edited)" };
  reviewed.push({ front: "Smoke test term", back: "Smoke test definition", type: "definition", topic: "Derivatives", difficulty: 1, source: "" });
  const created = await json("/api/sets", post({ title: "Smoke test set", context, cards: reviewed, notes: [{ name: md.name, kind: "md", text: md.text }] }));
  ok(created.status === 201 && created.body.id, "set saved");
  const id = created.body.id as string;
  let set = await json(`/api/sets/${id}`);
  ok(set.body.cards.length === reviewed.length && set.body.context.name === "CFA Level II", `set has ${set.body.cards.length} cards and saved context`);

  for (const p of ["", "/flashcards", "/match", "/learn", "/add"]) {
    const r = await fetch(`${BASE}/sets/${id}${p}`);
    ok(r.status === 200, `page /sets/:id${p} renders`);
  }

  // 7. Add more notes → generate → de-dup against existing
  const more = await generate({ context, notes: [{ name: docx.name, kind: "docx", text: docx.text }], count: "auto", setId: id });
  ok(more.done && more.done.cards.length >= 2, `add-notes generation produced ${more.done?.cards.length} new cards`);
  const again = await generate({ context, notes: [{ name: md.name, kind: "md", text: md.text }], count: "auto", setId: id });
  ok(again.done && again.done.removedDuplicates > 0, `re-generating the same notes skips duplicates (${again.done?.removedDuplicates} removed, ${again.done?.cards.length} new)`);
  const added = await json(`/api/sets/${id}/cards`, post({ cards: more.done.cards, notes: [{ name: docx.name, kind: "docx", text: docx.text }] }));
  ok(added.status === 201 && added.body.added === more.done.cards.length, `appended ${added.body.added} cards`);
  const dupAdd = await json(`/api/sets/${id}/cards`, post({ cards: more.done.cards }));
  ok(dupAdd.body.added === 0 && dupAdd.body.skippedDuplicates === more.done.cards.length, "server-side de-dup on append");

  // 8. Card edit/delete
  set = await json(`/api/sets/${id}`);
  const first = set.body.cards[0];
  const patched = await json(`/api/cards/${first.id}`, post({ front: "Edited front" }, "PATCH"));
  ok(patched.body.card.front === "Edited front", "card edited");
  const del = await json(`/api/cards/${set.body.cards[1].id}`, { method: "DELETE" });
  ok(del.status === 200, "card deleted");

  // 9. Mastery tracking
  const ids = set.body.cards.slice(2, 5).map((c: any) => c.id);
  const prog = await json(`/api/sets/${id}/progress`, post({ results: [{ cardId: ids[0], result: "known" }, { cardId: ids[1], result: "correct" }, { cardId: ids[2], result: "learning" }] }));
  ok(prog.body.cards.find((c: any) => c.id === ids[0]).mastery === 3, "know-it marks card mastered");
  const lib2 = await json("/api/sets");
  const mine = lib2.body.sets.find((s: any) => s.id === id);
  ok(mine.progress.mastered === 1 && mine.progress.percent > 0, `library shows mastery (${mine.progress.percent}%)`);

  // 10. Match best time
  const b1 = await json(`/api/sets/${id}`, post({ bestMatchMs: 12000 }, "PATCH"));
  const b2 = await json(`/api/sets/${id}`, post({ bestMatchMs: 15000 }, "PATCH"));
  const b3 = await json(`/api/sets/${id}`, post({ bestMatchMs: 9000 }, "PATCH"));
  ok(b1.body.newBest && !b2.body.newBest && b3.body.newBest && b3.body.bestMatchMs === 9000, "match best time saved per set");

  // 11. CSV export + rename
  const csvRes = await fetch(`${BASE}/api/sets/${id}/export`);
  const csv = await csvRes.text();
  ok(csvRes.headers.get("content-type")?.includes("text/csv") && csv.trim().split("\n").length === set.body.cards.length - 1, "CSV export (one line per card)");
  const ren = await json(`/api/sets/${id}`, post({ title: "Smoke test set (renamed)" }, "PATCH"));
  ok(ren.body.title === "Smoke test set (renamed)", "set renamed");

  // 12. Validation + cleanup
  const bad = await json("/api/generate", post({ notes: [] }));
  ok(bad.status === 400, "invalid generate request rejected with 400");
  const gone = await json(`/api/sets/${id}`, { method: "DELETE" });
  ok(gone.status === 200 && (await fetch(`${BASE}/api/sets/${id}`)).status === 404, "set deleted");

  console.log(`\nAll ${passed} smoke checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
