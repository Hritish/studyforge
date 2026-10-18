import { describe, expect, it } from "vitest";
import { chunkNotes, dedupeCards, distributeCount, estimateTokens, isDuplicate } from "@/lib/chunk";
import { buildWorkItems, runGeneration, type ChunkGenerator } from "@/lib/generate";
import { EMPTY_CONTEXT, type CardDraft, type GenerationEvent } from "@/lib/types";

function section(i: number, words: number) {
  return `## Section ${i}\n\n` + Array.from({ length: words }, (_, k) => `word${i}_${k}`).join(" ");
}

describe("chunkNotes", () => {
  it("returns one chunk for short notes", () => {
    expect(chunkNotes("short notes")).toEqual(["short notes"]);
    expect(chunkNotes("   ")).toEqual([]);
  });

  it("splits at section boundaries and never drops content", () => {
    const text = Array.from({ length: 6 }, (_, i) => section(i, 400)).join("\n\n");
    const chunks = chunkNotes(text, 1500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokens(c)).toBeLessThanOrEqual(1500);
      expect(c.startsWith("## Section")).toBe(true); // boundaries at headings
    }
    const allWords = text.split(/\s+/).filter(Boolean);
    const joined = chunks.join("\n\n").split(/\s+/).filter(Boolean);
    expect(joined).toEqual(allWords);
  });

  it("hard-splits a single enormous paragraph without losing characters", () => {
    const text = "a".repeat(50_000);
    const chunks = chunkNotes(text, 2000);
    expect(chunks.join("")).toBe(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(8000);
  });
});

describe("distributeCount", () => {
  it("sums to the total and is proportional", () => {
    const d = distributeCount(["a".repeat(300), "b".repeat(100)], 20);
    expect(d.reduce((a, b) => a + b, 0)).toBe(20);
    expect(d[0]).toBeGreaterThan(d[1]);
  });
});

describe("dedupe", () => {
  it("detects near-duplicate fronts", () => {
    expect(isDuplicate({ front: "What is the Z-spread?", back: "x" }, { front: "Z-spread", back: "y" })).toBe(true);
    expect(isDuplicate({ front: "Callable bond", back: "a" }, { front: "Putable bond", back: "b" })).toBe(false);
  });

  it("removes duplicates within new cards and against existing ones", () => {
    const cards = [
      { front: "Gordon growth model", back: "V0 = D1/(r-g)" },
      { front: "The Gordon Growth Model", back: "V0 = D1 / (r − g)" },
      { front: "Z-spread", back: "constant spread" },
      { front: "OAS", back: "Z-spread minus option cost" },
    ];
    const r = dedupeCards(cards, [{ front: "OAS", back: "option-adjusted spread" }]);
    expect(r.cards.map((c) => c.front)).toEqual(["Gordon growth model", "Z-spread"]);
    expect(r.removed).toBe(2);
  });
});

const card = (front: string): CardDraft => ({ front, back: `${front} def`, type: "definition", topic: "T", difficulty: 1, source: "" });

describe("runGeneration", () => {
  it("chunks, dedupes across chunks and existing cards, and emits events", async () => {
    const gen: ChunkGenerator = {
      mode: "demo",
      supportsPdf: false,
      supportsImages: false,
      generate: async ({ index }) => ({ ok: true, data: index === 0 ? [card("Alpha"), card("Beta")] : [card("Beta"), card("Gamma"), card("Delta")] }),
    };
    const events: GenerationEvent[] = [];
    const text = Array.from({ length: 4 }, (_, i) => section(i, 300)).join("\n\n");
    const out = await runGeneration(
      { notes: [{ name: "n.md", kind: "md", text }], context: EMPTY_CONTEXT, target: null, existing: [{ front: "Delta", back: "" }], maxChunkTokens: 2500 },
      gen,
      (e) => events.push(e),
    );
    expect(out.map((c) => c.front)).toEqual(["Alpha", "Beta", "Gamma"]);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ removedDuplicates: 2 });
    expect(events[0]).toMatchObject({ type: "start" });
  });

  it("splits a chunk and retries when the model hits max_tokens", async () => {
    let calls = 0;
    const gen: ChunkGenerator = {
      mode: "claude",
      supportsPdf: true,
      supportsImages: true,
      generate: async ({ item }) => {
        calls++;
        if (calls === 1) return { ok: false, reason: "max_tokens", message: "limit" };
        return { ok: true, data: [card(["Alpha", "Omega"][calls - 2] + item.label.length)] };
      },
    };
    const events: GenerationEvent[] = [];
    const text = Array.from({ length: 4 }, (_, i) => section(i, 300)).join("\n\n");
    const out = await runGeneration({ notes: [{ name: "n", kind: "paste", text }], context: EMPTY_CONTEXT, target: null, existing: [] }, gen, (e) => events.push(e));
    expect(calls).toBe(3);
    expect(out).toHaveLength(2);
    expect(events.some((e) => e.type === "warning")).toBe(true);
  });

  it("reports refusals as warnings and errors when nothing was generated", async () => {
    const gen: ChunkGenerator = { mode: "claude", supportsPdf: true, supportsImages: true, generate: async () => ({ ok: false, reason: "refusal", message: "declined" }) };
    const events: GenerationEvent[] = [];
    const out = await runGeneration({ notes: [{ name: "n", kind: "paste", text: "a: b" }], context: EMPTY_CONTEXT, target: 10, existing: [] }, gen, (e) => events.push(e));
    expect(out).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["start", "progress", "warning", "error"]);
  });

  it("sends small PDFs natively and large PDFs as text chunks", () => {
    const small = buildWorkItems([{ name: "a.pdf", kind: "pdf", text: "short", pdfBase64: "AAA" }], { pdf: true, images: true });
    expect(small).toEqual([{ label: "a.pdf", text: "short", pdfBase64: "AAA" }]);
    const big = buildWorkItems([{ name: "b.pdf", kind: "pdf", text: section(1, 3000), pdfBase64: "AAA" }], { pdf: true, images: true }, 2000);
    expect(big.length).toBeGreaterThan(1);
    expect(big.every((i) => !i.pdfBase64)).toBe(true);
    const demo = buildWorkItems([{ name: "a.pdf", kind: "pdf", text: "short", pdfBase64: "AAA" }], { pdf: false, images: false });
    expect(demo[0].pdfBase64).toBeUndefined();
  });
});
