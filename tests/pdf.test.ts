import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildCardsUserContent } from "@/lib/ai/prompts";
import { buildWorkItems, runGeneration, type ChunkGenerator } from "@/lib/generate";
import { firstPages, pdfPageCount, splitPdf } from "@/lib/pdf";
import { EMPTY_CONTEXT, type GenerationEvent, type NoteInput } from "@/lib/types";

const SLIDE_PNG = readFileSync(path.join(__dirname, "fixtures", "cfa-slide.png"));
// JPEGs embed without decoding, which keeps 20+ page fixtures fast.
const SLIDE_JPG = sharp(SLIDE_PNG).resize(600).jpeg().toBuffer();

/** A "scanned" PDF: every page is just an image, with no text layer. */
async function scannedPdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    // Embed per page, like a real scan, so file size grows with page count.
    const img = await doc.embedJpg(await SLIDE_JPG);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return Buffer.from(await doc.save()).toString("base64");
}

const pdfNote = (base64: string, name = "lecture.pdf"): NoteInput => ({ name, kind: "pdf", text: "", pdfBase64: base64 });

describe("PDF page splitting", () => {
  it("keeps a short PDF whole and splits a long one into 10-page ranges", async () => {
    const short = await scannedPdf(4);
    expect(await splitPdf(short)).toEqual([{ base64: short, from: 1, to: 4 }]);

    const parts = await splitPdf(await scannedPdf(23));
    expect(parts.map((p) => [p.from, p.to])).toEqual([[1, 10], [11, 20], [21, 23]]);
    expect(await pdfPageCount(parts[2].base64)).toBe(3);
  });

  it("halves a range that is over the size limit, and rejects a single oversized page", async () => {
    const pdf = await scannedPdf(4);
    const onePage = (await splitPdf(pdf, 1)).map((p) => p.base64.length);
    const limit = Math.max(...onePage) * 2 + 10_000; // fits about two pages, not four
    const parts = await splitPdf(pdf, 10, limit);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].from).toBe(1);
    expect(parts[parts.length - 1].to).toBe(4);
    await expect(splitPdf(pdf, 10, 100)).rejects.toThrow(/too large/);
  });

  it("extracts the first pages for context detection", async () => {
    expect(await pdfPageCount(await firstPages(await scannedPdf(12), 5))).toBe(5);
  });
});

describe("scanned PDFs in generation", () => {
  it("sends scanned PDFs to Claude as page ranges with original page numbers", async () => {
    const items = await buildWorkItems([pdfNote(await scannedPdf(12))], { pdf: true, images: true });
    expect(items.map((i) => i.label)).toEqual(["lecture.pdf (pages 1–10 of 12)", "lecture.pdf (pages 11–12 of 12)"]);
    expect(items[1].pdfPages).toEqual({ from: 11, to: 12, total: 12 });

    const blocks = buildCardsUserContent({
      context: EMPTY_CONTEXT,
      notesText: "",
      pdfBase64: items[1].pdfBase64,
      pdfPages: items[1].pdfPages,
      notesLabel: items[1].label,
      chunkIndex: 1,
      chunkCount: 2,
      target: null,
      existingFronts: [],
    });
    expect(blocks[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    const text = blocks.find((b) => b.type === "text");
    expect(text && "text" in text ? text.text : "").toMatch(/page 1 of the attachment is page 11/);
    expect(text && "text" in text ? text.text : "").toMatch(/handwritten or typed notes/);
  });

  it("sends PDFs with a text layer as pages too, so slide images aren't lost", async () => {
    const items = await buildWorkItems([{ ...pdfNote(await scannedPdf(3)), text: "Typed notes under each slide" }], { pdf: true, images: true });
    expect(items).toHaveLength(1);
    expect(items[0].pdfBase64).toBeTruthy();
  });

  it("explains that scanned PDFs need an API key in demo mode", async () => {
    const gen: ChunkGenerator = { mode: "demo", supportsPdf: false, supportsImages: false, generate: async () => ({ ok: true, data: [] }) };
    const events: GenerationEvent[] = [];
    await runGeneration({ notes: [pdfNote(await scannedPdf(2))], context: EMPTY_CONTEXT, target: null, existing: [] }, gen, (e) => events.push(e));
    expect(events).toEqual([{ type: "error", message: expect.stringMatching(/no text layer.*ANTHROPIC_API_KEY/) }]);
  });
});
