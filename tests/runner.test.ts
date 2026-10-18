import { describe, expect, it } from "vitest";
import { runGeneration, type ChunkGenerator } from "@/lib/generate";
import { generationDeadline } from "@/lib/time-budget";
import { EMPTY_CONTEXT, type CardDraft, type GenerationEvent, type NoteInput } from "@/lib/types";

const card = (front: string): CardDraft => ({ front, back: `${front} means something`, type: "definition", topic: "T", difficulty: 1, source: "" });
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"];
/** A distinct card front per work item ("Notes (part 3 of 9)" → "Card charlie"). */
const frontFor = (label: string) => `Card ${WORDS[Number(/part (\d+)/.exec(label)![1]) - 1]}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function section(i: number) {
  return `## Section ${i}\n\n` + Array.from({ length: 300 }, (_, k) => `w${i}_${k}`).join(" ");
}
const notes = (n: number): NoteInput[] => [{ name: "n.md", kind: "md", text: Array.from({ length: n }, (_, i) => section(i)).join("\n\n") }];
const opts = (n: number, extra: Partial<Parameters<typeof runGeneration>[0]> = {}) => ({
  notes: notes(n),
  context: EMPTY_CONTEXT,
  target: null,
  existing: [],
  maxChunkTokens: 700, // one ~525-token section per chunk
  ...extra,
});

describe("concurrent runner", () => {
  it("runs 3 at a time but commits results in work-item order", async () => {
    let inFlight = 0;
    let peak = 0;
    const finishOrder: number[] = [];
    const gen: ChunkGenerator = {
      mode: "claude",
      supportsPdf: true,
      supportsImages: true,
      async generate({ item }) {
        const i = Number(/part (\d+)/.exec(item.label)![1]) - 1;
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep((6 - i) * 8); // later parts finish first
        inFlight--;
        finishOrder.push(i);
        return { ok: true, data: [card(`Card ${i}`)] };
      },
    };
    const events: GenerationEvent[] = [];
    const out = await runGeneration(opts(6), gen, (e) => events.push(e));
    expect(peak).toBe(3);
    expect(finishOrder).not.toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.map((c) => c.front)).toEqual(["Card 0", "Card 1", "Card 2", "Card 3", "Card 4", "Card 5"]);
    const cardEvents = events.filter((e) => e.type === "cards");
    expect(cardEvents.map((e) => e.chunk)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events[0]).toMatchObject({ type: "start", chunks: 6 });
    expect(events.at(-1)).toMatchObject({ type: "done", removedDuplicates: 0 });
    // progress "done" counts never go backwards and stay within the total
    const done = events.flatMap((e) => (e.type === "progress" ? [e.done] : []));
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(Math.max(...done)).toBeLessThan(6);
  });

  it("de-dups across concurrent parts deterministically (earlier part wins)", async () => {
    const gen: ChunkGenerator = {
      mode: "claude",
      supportsPdf: true,
      supportsImages: true,
      async generate({ item }) {
        const i = Number(/part (\d+)/.exec(item.label)![1]) - 1;
        await sleep(i === 0 ? 30 : 1); // part 1 finishes last
        const shared = { ...card("Gordon growth model"), back: `V0 = D1 / (r − g) (from part ${i})` };
        return { ok: true, data: i === 2 ? [card("Unique")] : [shared, card(`Only ${i}`)] };
      },
    };
    const events: GenerationEvent[] = [];
    const out = await runGeneration(opts(3, { existing: [{ front: "Only 1", back: "Only 1 means something" }] }), gen, (e) => events.push(e));
    expect(out.map((c) => c.front)).toEqual(["Gordon growth model", "Only 0", "Unique"]);
    expect(out[0].back).toContain("part 0");
    expect(events.find((e) => e.type === "done")).toMatchObject({ removedDuplicates: 2 });
  });

  it("stops starting parts when the time budget runs low and returns what it has", async () => {
    let clock = 0;
    const started: string[] = [];
    const gen: ChunkGenerator = {
      mode: "claude",
      supportsPdf: true,
      supportsImages: true,
      async generate({ item }) {
        started.push(item.label);
        await sleep(2);
        clock += 70_000; // each part "takes" 70 s
        return { ok: true, data: [card(frontFor(item.label))] };
      },
    };
    const events: GenerationEvent[] = [];
    // deadline 280 s, reserve 100 s → nothing starts after t = 180 s.
    const out = await runGeneration(opts(9, { deadline: 280_000, reserveMs: 100_000, now: () => clock }), gen, (e) => events.push(e));
    // 3 start at t=0; as they finish (t=70, 140, 210 s) two more start, then the budget is too low.
    expect(started).toHaveLength(5);
    expect(out).toHaveLength(started.length);
    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.skipped?.length).toBe(9 - started.length);
    const warn = events.find((e) => e.type === "warning" && e.message.startsWith("Ran out of time"));
    expect(warn && warn.type === "warning" && warn.message).toMatch(/add the remaining pages separately/);
    expect(out.map((c) => c.front)).toEqual(started.map(frontFor).sort());
  });

  it("aborts parts still running at the hard deadline", async () => {
    let aborted = false;
    const gen: ChunkGenerator = {
      mode: "claude",
      supportsPdf: true,
      supportsImages: true,
      generate: ({ item, signal }) =>
        item.label.includes("part 2")
          ? new Promise((resolve) => {
              signal?.addEventListener("abort", () => {
                aborted = true;
                resolve({ ok: false, reason: "invalid", message: "aborted" });
              });
            })
          : Promise.resolve({ ok: true, data: [card(frontFor(item.label))] }),
    };
    const events: GenerationEvent[] = [];
    const out = await runGeneration(opts(3, { deadline: Date.now() + 80, reserveMs: 0 }), gen, (e) => events.push(e));
    expect(aborted).toBe(true);
    expect(out.map((c) => c.front)).toEqual(["Card alpha", "Card charlie"]);
    expect(events.find((e) => e.type === "done")).toMatchObject({ skipped: ["Notes (part 2 of 3)"] });
  });

  it("errors with a time message if nothing finished", async () => {
    const gen: ChunkGenerator = { mode: "claude", supportsPdf: true, supportsImages: true, generate: async () => ({ ok: true, data: [card("x")] }) };
    const events: GenerationEvent[] = [];
    const out = await runGeneration(opts(2, { deadline: 1000, reserveMs: 500, now: () => 900 }), gen, (e) => events.push(e));
    expect(out).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/Ran out of time/) });
  });
});

describe("generation time budget", () => {
  it("applies only on Vercel (or when overridden)", () => {
    expect(generationDeadline(1000, 300, {})).toBeUndefined();
    expect(generationDeadline(1000, 300, { VERCEL: "1" })).toBe(1000 + 280_000);
    expect(generationDeadline(1000, 300, { GENERATION_TIME_BUDGET_SECONDS: "60" })).toBe(61_000);
  });
});
