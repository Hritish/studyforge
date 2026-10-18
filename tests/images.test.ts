import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildCardsRequest, buildContextRequest, generateCardsWithClaude, type ClaudeLike } from "@/lib/ai/claude";
import { batchImages, batchLabel, buildImageBlocks, IMAGE_MAX_BYTES, IMAGE_MAX_EDGE, toSlideImages, type SlideImage } from "@/lib/ai/images";
import { buildCardsUserContent, buildContextUserContent, CONTEXT_MAX_IMAGES } from "@/lib/ai/prompts";
import type { MessageLike } from "@/lib/ai/schema";
import { KNOWN_CONTEXTS, knownToStudyContext } from "@/lib/contexts";
import { kindFromName } from "@/lib/extract";
import { buildWorkItems, runGeneration, type ChunkGenerator } from "@/lib/generate";
import { prepareImage } from "@/lib/images";
import { demoGenerator } from "@/lib/engine";
import { EMPTY_CONTEXT, IMAGES_NEED_KEY_MESSAGE, type CardDraft, type GenerationEvent, type NoteInput } from "@/lib/types";

const ctx = knownToStudyContext(KNOWN_CONTEXTS.find((k) => k.name === "CFA Level II")!, "user", 1);
const fixture = readFileSync("tests/fixtures/cfa-slide.png");

const imgNote = (i: number, size = 100): NoteInput => ({
  name: `slide-${i}.png`,
  kind: "image",
  text: "",
  imageBase64: "A".repeat(size),
  mediaType: "image/jpeg",
});

describe("prepareImage (sharp)", () => {
  it("downscales the 2400×1350 fixture to ≤1568px and re-encodes as JPEG under the size limit", async () => {
    const img = await prepareImage(fixture);
    expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(IMAGE_MAX_EDGE);
    expect(img.width).toBe(1568);
    expect(img.mediaType).toBe("image/jpeg");
    expect(img.bytes).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
    const meta = await sharp(Buffer.from(img.base64, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1568);
  });

  it("keeps small images at their size and rejects non-images", async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#abcdef" } }).webp().toBuffer();
    const img = await prepareImage(small);
    expect([img.width, img.height]).toEqual([300, 200]);
    await expect(prepareImage(Buffer.from("not an image"))).rejects.toThrow();
  });

  it("recognizes image extensions", () => {
    for (const n of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif"]) expect(kindFromName(n)).toBe("image");
    expect(kindFromName("x.bmp")).toBeNull();
  });
});

describe("image blocks and batching", () => {
  it("numbers images globally and builds label + base64 image blocks", () => {
    const imgs = toSlideImages([imgNote(1), { name: "n", kind: "paste", text: "x" }, imgNote(2)]);
    expect(imgs.map((i) => i.label)).toEqual(["Slide image 1", "Slide image 2"]);
    const blocks = buildImageBlocks(imgs);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toEqual({ type: "text", text: "Slide image 1 (file: slide-1.png):" });
    expect(blocks[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "A".repeat(100) } });
  });

  it("batches by count and by total size", () => {
    const imgs = toSlideImages(Array.from({ length: 19 }, (_, i) => imgNote(i)));
    const byCount = batchImages(imgs, 8);
    expect(byCount.map((b) => b.length)).toEqual([8, 8, 3]);
    expect(batchLabel(byCount[1])).toBe("Slide images 9–16");
    const bySize = batchImages(toSlideImages(Array.from({ length: 5 }, (_, i) => imgNote(i, 1000))), 8, 2500);
    expect(bySize.map((b) => b.length)).toEqual([2, 2, 1]);
    // An oversized single image still gets its own batch.
    expect(batchImages(toSlideImages([imgNote(1, 5000)]), 8, 2500)).toHaveLength(1);
  });

  it("puts images before the text instruction and adds slide-reading instructions", () => {
    const images = toSlideImages([imgNote(1), imgNote(2)]);
    const blocks = buildCardsUserContent({ context: ctx, notesText: "", images, notesLabel: "Slide images 1–2", chunkIndex: 0, chunkCount: 1, target: null, existingFronts: [] });
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text", "image", "text"]);
    const instruction = (blocks[blocks.length - 1] as { text: string }).text;
    expect(instruction).toContain("lecture slides or screenshots");
    expect(instruction).toContain("Ignore UI chrome");
    expect(instruction).toContain('"Slide image 3: ');
    expect(instruction).toContain("Slide image 1, Slide image 2");
    expect(instruction).not.toContain("<notes");
    const req = buildCardsRequest({ context: ctx, notesText: "", images, notesLabel: "x", chunkIndex: 0, chunkCount: 1, target: 5, existingFronts: [] });
    expect(JSON.stringify(req.messages)).toContain('"media_type":"image/jpeg"');
  });

  it("context detection sends a sample of images before the text", () => {
    const images = toSlideImages(Array.from({ length: 10 }, (_, i) => imgNote(i)));
    const blocks = buildContextUserContent({ images });
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(CONTEXT_MAX_IMAGES);
    expect(blocks[blocks.length - 1].type).toBe("text");
    expect((blocks[blocks.length - 1] as { text: string }).text).toContain("lecture slides or screenshots");
    const req = buildContextRequest({ images }) as unknown as { output_config: { effort: string } };
    expect(req.output_config.effort).toBe("low");
  });
});

const card = (front: string, source = ""): CardDraft => ({ front, back: `${front} def`, type: "definition", topic: "Equity Valuation", difficulty: 1, source });

describe("generation with images", () => {
  it("creates image batches alongside text chunks when vision is supported", async () => {
    const notes = [{ name: "n", kind: "paste" as const, text: "Alpha: first" }, ...Array.from({ length: 10 }, (_, i) => imgNote(i))];
    const items = await buildWorkItems(notes, { pdf: true, images: true });
    expect(items.map((i) => i.label)).toEqual(["Notes", "Slide images 1–8", "Slide images 9–10"]);
    expect((await buildWorkItems(notes, { pdf: false, images: false })).map((i) => i.label)).toEqual(["Notes"]);
  });

  it("de-dupes cards across image batches using a mocked SDK", async () => {
    const replies = [
      [card("Gordon growth model", "Slide image 1: V0 = D1 / (r − g)"), card("Residual income", "Slide image 2: RI")],
      [card("The Gordon Growth Model", "Slide image 9: V0"), card("Z-spread", "Slide image 10: spread")],
    ];
    const requests: unknown[] = [];
    const client: ClaudeLike = {
      beta: {
        messages: {
          create: async () => ({ stop_reason: "end_turn", content: [] }),
          stream: (p) => {
            requests.push(p);
            const reply = replies[requests.length - 1];
            return {
              on: () => undefined,
              finalMessage: async (): Promise<MessageLike> => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ cards: reply }) }] }),
            };
          },
        },
      },
    };
    const gen: ChunkGenerator = {
      mode: "claude",
      supportsPdf: true,
      supportsImages: true,
      generate: ({ item, index, count, target, context, existingFronts }) =>
        generateCardsWithClaude(client, { context, notesText: item.text, images: item.images, notesLabel: item.label, chunkIndex: index, chunkCount: count, target, existingFronts }),
    };
    const events: GenerationEvent[] = [];
    // Sequential, so the second request can be told about the first batch's cards.
    const out = await runGeneration({ notes: Array.from({ length: 10 }, (_, i) => imgNote(i)), context: ctx, target: null, existing: [], concurrency: 1 }, gen, (e) => events.push(e));
    expect(requests).toHaveLength(2);
    const firstContent = (requests[0] as { messages: { content: { type: string }[] }[] }).messages[0].content;
    expect(firstContent.filter((b) => b.type === "image")).toHaveLength(8);
    expect(firstContent[firstContent.length - 1].type).toBe("text");
    // second request is told about the first batch's cards
    expect(JSON.stringify(requests[1])).toContain("- Gordon growth model");
    expect(out.map((c) => c.front)).toEqual(["Gordon growth model", "Residual income", "Z-spread"]);
    expect(out[0].source).toMatch(/^Slide image 1:/);
    expect(events.find((e) => e.type === "done")).toMatchObject({ removedDuplicates: 1 });
  });

  it("demo mode skips images with a notice but still uses the text notes", async () => {
    const events: GenerationEvent[] = [];
    const out = await runGeneration(
      { notes: [imgNote(1), { name: "n", kind: "paste", text: "Alpha: the first letter\nBeta: the second letter" }], context: EMPTY_CONTEXT, target: null, existing: [] },
      demoGenerator(),
      (e) => events.push(e),
    );
    expect(out).toHaveLength(2);
    const warning = events.find((e) => e.type === "warning");
    expect(warning && "message" in warning && warning.message).toContain(IMAGES_NEED_KEY_MESSAGE);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("demo mode with only images reports the API-key message", async () => {
    const events: GenerationEvent[] = [];
    await runGeneration({ notes: [imgNote(1)], context: EMPTY_CONTEXT, target: null, existing: [] }, demoGenerator(), (e) => events.push(e));
    expect(events).toEqual([{ type: "error", message: `${IMAGES_NEED_KEY_MESSAGE}.` }]);
  });

  it("halves an image batch that hits max_tokens", async () => {
    let calls = 0;
    const seen: (SlideImage[] | undefined)[] = [];
    const gen: ChunkGenerator = {
      mode: "claude",
      supportsPdf: true,
      supportsImages: true,
      generate: async ({ item }) => {
        calls++;
        seen.push(item.images);
        if (calls === 1) return { ok: false, reason: "max_tokens", message: "limit" };
        return { ok: true, data: [card(calls === 2 ? "Alpha" : "Omega")] };
      },
    };
    const out = await runGeneration({ notes: Array.from({ length: 4 }, (_, i) => imgNote(i)), context: ctx, target: null, existing: [] }, gen, () => {});
    expect(seen.map((s) => s?.length)).toEqual([4, 2, 2]);
    expect(out).toHaveLength(2);
  });
});
