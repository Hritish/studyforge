/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON in a test script */
/**
 * End-to-end smoke test against a running server (local file store mode).
 *   npm run build && npm start   (port 3100)
 *   npm run smoke                 (BASE_URL=http://localhost:3100 by default)
 *
 * Env:
 *   BASE_URL           server to test
 *   SMOKE_PASSWORD     the server's APP_PASSWORD, if it has one: the gate is tested and the
 *                      rest runs with a session cookie
 *   UPLOAD_DIR         the server's upload dir (default .uploads), to check uploads get deleted
 *
 * Demo mode (no API key on the server) runs the full flow. Claude mode runs a reduced
 * flow with exactly one small real generation (and no context detection), to keep
 * API spend negligible.
 * Creates a temporary set and deletes it at the end.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PASSWORD = process.env.SMOKE_PASSWORD;
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? ".uploads";
let passed = 0;
let cookie = "";

function ok(cond: unknown, label: string): asserts cond {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

const withCookie = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) } });
const get = (p: string, init?: RequestInit) => fetch(BASE + p, withCookie(init));

async function json<T = any>(p: string, init?: RequestInit): Promise<{ status: number; body: T; bytesSent: number }> {
  const res = await get(p, init);
  const bytesSent = typeof init?.body === "string" ? Buffer.byteLength(init.body) : 0;
  return { status: res.status, body: (await res.json()) as T, bytesSent };
}

const post = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function generate(body: unknown) {
  const init = post(body);
  const res = await get("/api/generate", init);
  const text = await res.text();
  const events = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { status: res.status, events, done: events.find((e) => e.type === "done"), bytesSent: Buffer.byteLength(init.body as string) };
}

/** Upload files through the local file store (multipart → /api/files). */
async function upload(files: [path: string, name: string][]) {
  const fd = new FormData();
  for (const [p, name] of files) fd.append("files", new Blob([readFileSync(p)]), name);
  return json("/api/files", { method: "POST", body: fd });
}

const stored = (key: string) => existsSync(path.join(UPLOAD_DIR, key));

async function gateChecks() {
  console.log("— password gate —");
  const page = await fetch(`${BASE}/sets/x?y=1`, { redirect: "manual" });
  ok(page.status === 307 && page.headers.get("location")?.includes("/login?next=%2Fsets%2Fx%3Fy%3D1"), "unauthenticated page redirects to /login with next");
  for (const p of ["/api/sets", "/api/status", "/api/files", "/api/upload", "/api/generate"]) {
    const r = await fetch(BASE + p, { method: p === "/api/sets" || p === "/api/status" ? "GET" : "POST", redirect: "manual" });
    ok(r.status === 401, `unauthenticated ${p} → 401`);
  }
  const login = await fetch(`${BASE}/login`);
  ok(login.status === 200 && (await login.text()).includes("Log in to StudyForge"), "login page is public");
  const forged = await fetch(`${BASE}/api/sets`, { headers: { cookie: "sf_session=v1.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } });
  ok(forged.status === 401, "forged session cookie rejected");

  const attempt = (password: string, ip = "198.51.100.7") =>
    fetch(`${BASE}/api/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
      body: new URLSearchParams({ password, next: "/new" }),
    });
  const wrong = await attempt("definitely-wrong");
  ok(wrong.status === 303 && wrong.headers.get("location")?.includes("error=invalid") && !wrong.headers.get("set-cookie"), "wrong password rejected, no cookie");
  const right = await attempt(PASSWORD!);
  const setCookie = right.headers.get("set-cookie") ?? "";
  ok(right.status === 303 && right.headers.get("location")?.endsWith("/new"), "correct password redirects to next");
  ok(/HttpOnly/i.test(setCookie) && /SameSite=lax/i.test(setCookie) && /Max-Age=2592000/.test(setCookie), "session cookie is HttpOnly, SameSite=Lax, 30 days");
  ok(!setCookie.includes(PASSWORD!), "cookie doesn't contain the password");
  cookie = setCookie.split(";")[0];

  const home = await get("/");
  ok(home.status === 200 && (await home.text()).includes('data-testid="logout"'), "signed-in home page shows Log out");
}

async function gateFinalChecks() {
  console.log("— logout + rate limit —");
  const out = await get("/api/logout", { method: "POST", redirect: "manual" });
  ok(out.status === 303 && /sf_session=;/.test(out.headers.get("set-cookie") ?? ""), "logout clears the cookie");
  const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  let last: Response | undefined;
  for (let i = 0; i < 6; i++) {
    last = await fetch(`${BASE}/api/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
      body: new URLSearchParams({ password: `guess-${i}` }),
    });
  }
  ok(last!.headers.get("location")?.includes("error=rate") && Number(last!.headers.get("retry-after")) > 0, "login attempts are rate-limited");
  const blocked = await fetch(`${BASE}/api/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: new URLSearchParams({ password: PASSWORD! }),
  });
  ok(blocked.headers.get("location")?.includes("error=rate") && !blocked.headers.get("set-cookie"), "even the right password is refused while rate-limited");
}

async function main() {
  console.log(`StudyForge smoke test → ${BASE}${PASSWORD ? " (password gate on)" : ""}\n`);
  if (PASSWORD) await gateChecks();
  else {
    const r = await fetch(`${BASE}/api/sets`);
    ok(r.status === 200, "no password gate when APP_PASSWORD is unset");
  }

  // 1. Status + pages
  const status = await json("/api/status");
  ok(status.status === 200 && ["demo", "claude"].includes(status.body.mode), `status endpoint (mode: ${status.body.mode})`);
  const demo = status.body.mode === "demo";
  const home = await get("/").then((r) => r.text());
  ok(home.includes("StudyForge") && home.includes("Your library"), "home page renders library");
  if (demo) ok(home.includes("Demo mode"), "home page shows Demo mode label");
  const newPage = await get("/new").then((r) => r.text());
  ok(newPage.includes("CFA Level II"), "new-set page uses CFA Level II placeholder");

  // 2. Library contains the seeded CFA set
  const lib = await json("/api/sets");
  ok(lib.body.sets.some((s: any) => s.contextName === "CFA Level II" && s.cardCount >= 20), "seeded CFA Level II set present with ~20 cards");

  // 3. Uploads into the local file store (md + docx + pdf), extracted on the server
  const up = await upload([
    ["samples/cfa-level-2-notes.md", "cfa-level-2-notes.md"],
    ["tests/fixtures/greeks.docx", "greeks.docx"],
    ["tests/fixtures/fixed-income.pdf", "fixed-income.pdf"],
  ]);
  ok(up.status === 200 && up.body.files.length === 3 && up.body.errors.length === 0, "upload .md/.docx/.pdf to the file store");
  const [md, docx, pdf] = up.body.files;
  ok(docx.text.includes("Gamma: rate of change of delta") && !docx.fileId, "docx text extracted via mammoth (stored copy dropped)");
  ok(pdf.text.includes("Spot rate") && typeof pdf.fileId === "string" && !("pdfBase64" in pdf) && stored(pdf.fileId), "pdf text extracted; PDF kept in the store, only a reference returned");
  const direct = await json("/api/upload", post({ type: "blob.generate-client-token", payload: { pathname: "uploads/abcdefgh12/x.pdf", clientPayload: null, multipart: false } }));
  ok(direct.status === 404, "Blob token route is off without BLOB_READ_WRITE_TOKEN");
  const bad = await upload([["package.json", "evil.exe"]]);
  ok(bad.body.files.length === 0 && /Unsupported file type/.test(bad.body.errors[0]), "unsupported file types rejected");

  // 3b. Image upload (slide screenshot): downscaled + re-encoded with sharp
  const imgUp = await upload([["tests/fixtures/cfa-slide.png", "cfa-slide.png"]]);
  const slide = imgUp.body.files?.[0];
  ok(imgUp.status === 200 && slide?.kind === "image" && slide.mediaType === "image/jpeg" && slide.width === 1568 && stored(slide.fileId), "image downscaled to 1568px JPEG in the store");
  const slideRef = { name: slide.name, kind: "image", text: "", fileId: slide.fileId, mediaType: slide.mediaType };

  let context: any;
  if (demo) {
    const imgCtx = await json("/api/context", post({ notesText: md.text, images: [slideRef] }));
    ok(imgCtx.status === 200 && imgCtx.body.context.name === "CFA Level II", "context detection accepts image references");
    ok(String(imgCtx.body.warning).includes("requires an Anthropic API key"), "demo mode: images-need-key notice on context");
    const onlyImg = await generate({ context: imgCtx.body.context, notes: [slideRef], count: "auto" });
    ok(onlyImg.events.some((e) => e.type === "error" && e.message.includes("ANTHROPIC_API_KEY")), "demo mode: image-only generation explains the API-key requirement");
    const mixed = await generate({ context: imgCtx.body.context, notes: [slideRef, { name: "n", kind: "paste", text: "Alpha: first letter\nBeta: second letter" }], count: "auto" });
    ok(mixed.done?.cards.length === 2 && mixed.events.some((e) => e.type === "warning" && e.message.includes("ANTHROPIC_API_KEY")), "demo mode: text + images still generates from text, with notice");

    // 4. Context detection from notes only
    const ctx = await json("/api/context", post({ notesText: md.text, notesPdf: pdf.fileId }));
    ok(ctx.status === 200 && ctx.body.context.name === "CFA Level II", `context inferred from notes: "${ctx.body.context.name}" (${ctx.body.context.source})`);
    ok(ctx.body.context.topicAreas.includes("Fixed Income"), "context has CFA topic areas");
    const named = await json("/api/context", post({ examName: "MCAT" }));
    ok(named.body.context.name === "MCAT" && named.body.context.topicAreas.length > 0, "context from exam name (MCAT)");
    context = { ...ctx.body.context, source: "user" };
  } else {
    // Claude mode: skip context detection (it calls Claude); use a fixed context.
    context = {
      name: "CFA Level II",
      domain: "Finance / investment analysis",
      level: "Professional certification",
      topicAreas: ["Equity Valuation", "Fixed Income", "Derivatives"],
      conventions: "",
      source: "user",
    };
  }

  // 5. Generation (streamed). Requests carry references, never file bytes.
  const pdfRef = { name: pdf.name, kind: "pdf", text: pdf.text, fileId: pdf.fileId };
  let cards: any[];
  if (demo) {
    const gen = await generate({ context, notes: [{ name: md.name, kind: md.kind, text: md.text }, pdfRef], count: 25 });
    ok(gen.status === 200 && gen.events[0].type === "start", "generation stream started");
    ok(gen.bytesSent < 50_000, `generate request is reference-only (${gen.bytesSent} bytes)`);
    ok(gen.events.some((e) => e.type === "progress" && typeof e.done === "number"), "progress events streamed (with done count)");
    ok(gen.done && gen.done.cards.length >= 10, `generated ${gen.done?.cards.length} cards`);
    cards = gen.done.cards;
    ok(cards.every((c: any) => c.front && c.back && c.topic && [1, 2, 3].includes(c.difficulty) && c.type), "cards have front/back/type/topic/difficulty");
    ok(cards.some((c: any) => c.type === "formula") && cards.every((c: any) => c.source), "formula cards + source excerpts present");
    ok(new Set(cards.map((c: any) => c.topic)).size >= 3, "cards tagged across ≥3 topic areas");
  } else {
    // The one real Claude call: a tiny pasted note, ~10 cards.
    const gen = await generate({ context, notes: [{ name: "Pasted notes", kind: "paste", text: "Gordon growth model: V0 = D1 / (r − g)\nOAS = Z-spread − option cost" }], count: 10 });
    ok(gen.status === 200 && gen.events[0].type === "start" && gen.events[0].mode === "claude", `Claude generation started (${gen.events[0].model})`);
    ok(gen.done && gen.done.cards.length >= 1, `Claude generated ${gen.done?.cards.length} cards`);
    cards = gen.done.cards;
    ok(cards.every((c: any) => c.front && c.back && c.topic && [1, 2, 3].includes(c.difficulty) && c.type), "cards have front/back/type/topic/difficulty");
  }

  // 6. Save the reviewed set (simulate edit/delete/add during review); uploads get deleted
  const reviewed = cards.length > 1 ? cards.slice(1) : cards.slice();
  reviewed[0] = { ...reviewed[0], back: reviewed[0].back + " (edited)" };
  reviewed.push({ front: "Smoke test term", back: "Smoke test definition", type: "definition", topic: "Derivatives", difficulty: 1, source: "" });
  const created = await json("/api/sets", post({ title: "Smoke test set", context, cards: reviewed, notes: [{ name: md.name, kind: "md", text: md.text }], files: [pdf.fileId] }));
  ok(created.status === 201 && created.body.id, "set saved");
  const id = created.body.id as string;
  let set = await json(`/api/sets/${id}`);
  ok(set.body.cards.length === reviewed.length && set.body.context.name === "CFA Level II", `set has ${set.body.cards.length} cards and saved context`);
  for (let i = 0; i < 20 && stored(pdf.fileId); i++) await new Promise((r) => setTimeout(r, 100));
  ok(!stored(pdf.fileId), "stored PDF deleted after the set was saved");
  const delImg = await json("/api/files", post({ keys: [slide.fileId] }, "DELETE"));
  ok(delImg.status === 200 && !stored(slide.fileId), "removed upload deleted from the store");
  if (!demo) {
    // Fails while loading the file, before any Claude call.
    const gone = await generate({ context, notes: [pdfRef], count: "auto" });
    ok(gone.events.some((e) => e.type === "error" && /not found in storage/.test(e.message)), "generation explains a missing (expired) upload");
  }

  for (const p of ["", "/flashcards", "/match", "/learn", "/add"]) {
    const r = await get(`/sets/${id}${p}`);
    ok(r.status === 200, `page /sets/:id${p} renders`);
  }

  if (demo) {
    // 7. Add more notes → generate → de-dup against existing
    const more = await generate({ context, notes: [{ name: docx.name, kind: "docx", text: docx.text }], count: "auto", setId: id });
    ok(more.done && more.done.cards.length >= 2, `add-notes generation produced ${more.done?.cards.length} new cards`);
    const again = await generate({ context, notes: [{ name: md.name, kind: "md", text: md.text }], count: "auto", setId: id });
    ok(again.done && again.done.removedDuplicates > 0, `re-generating the same notes skips duplicates (${again.done?.removedDuplicates} removed, ${again.done?.cards.length} new)`);
    const added = await json(`/api/sets/${id}/cards`, post({ cards: more.done.cards, notes: [{ name: docx.name, kind: "docx", text: docx.text }] }));
    ok(added.status === 201 && added.body.added === more.done.cards.length, `appended ${added.body.added} cards`);
    const dupAdd = await json(`/api/sets/${id}/cards`, post({ cards: more.done.cards }));
    ok(dupAdd.body.added === 0 && dupAdd.body.skippedDuplicates === more.done.cards.length, "server-side de-dup on append");
  }

  // 8. Card edit/delete
  set = await json(`/api/sets/${id}`);
  const first = set.body.cards[0];
  const patched = await json(`/api/cards/${first.id}`, post({ front: "Edited front" }, "PATCH"));
  ok(patched.body.card.front === "Edited front", "card edited");
  const del = await json(`/api/cards/${set.body.cards[1].id}`, { method: "DELETE" });
  ok(del.status === 200, "card deleted");

  // 9. Mastery tracking
  set = await json(`/api/sets/${id}`);
  const ids = set.body.cards.slice(0, 1).map((c: any) => c.id);
  const prog = await json(`/api/sets/${id}/progress`, post({ results: [{ cardId: ids[0], result: "known" }] }));
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
  const csvRes = await get(`/api/sets/${id}/export`);
  const csv = await csvRes.text();
  ok(csvRes.headers.get("content-type")?.includes("text/csv") && csv.trim().split("\n").length === set.body.cards.length, "CSV export (one line per card)");
  const ren = await json(`/api/sets/${id}`, post({ title: "Smoke test set (renamed)" }, "PATCH"));
  ok(ren.body.title === "Smoke test set (renamed)", "set renamed");

  // 12. Validation + cleanup
  const badGen = await json("/api/generate", post({ notes: [] }));
  ok(badGen.status === 400, "invalid generate request rejected with 400");
  const badRef = await json("/api/generate", post({ context, notes: [{ name: "x", kind: "pdf", text: "", fileId: "../../.env" }] }));
  ok(badRef.status === 400, "foreign file reference rejected with 400");
  const removed = await json(`/api/sets/${id}`, { method: "DELETE" });
  ok(removed.status === 200 && (await get(`/api/sets/${id}`)).status === 404, "set deleted");

  if (PASSWORD) await gateFinalChecks();

  console.log(`\nAll ${passed} smoke checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
