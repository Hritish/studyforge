import { describe, expect, it } from "vitest";
import { DetectContextZ, GenerateZ } from "@/lib/api-schemas";
import { knownToStudyContext, KNOWN_CONTEXTS } from "@/lib/contexts";
import { jsonBody, MAX_REQUEST_BYTES, newUploadKey, type NoteRef } from "@/lib/files/common";

const context = knownToStudyContext(KNOWN_CONTEXTS.find((k) => k.name === "CFA Level II")!, "user", 1);

describe("reference-only request payloads", () => {
  // A 60-page scanned PDF (no text layer) plus 30 slide screenshots.
  const notes: NoteRef[] = [
    { name: "Lecture 7 — scanned slides (60 pages).pdf", kind: "pdf", text: "", fileId: newUploadKey("Lecture 7 scanned slides.pdf") },
    ...Array.from({ length: 30 }, (_, i): NoteRef => ({
      name: `Screenshot 2026-10-18 at 10.${String(i).padStart(2, "0")}.12.png`,
      kind: "image",
      text: "",
      fileId: newUploadKey(`slide.jpg`),
      mediaType: "image/jpeg",
    })),
  ];

  it("keeps a 60-page PDF + 30 screenshots generate request tiny", () => {
    const body = jsonBody({ context, notes, count: 50 });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(20_000);
    expect(GenerateZ.safeParse(JSON.parse(body)).success).toBe(true);
  });

  it("keeps the context request tiny too", () => {
    const body = jsonBody({ notesText: "", notesPdf: notes[0].fileId, images: notes.filter((n) => n.kind === "image").slice(0, 6) });
    expect(body.length).toBeLessThan(5_000);
    expect(DetectContextZ.safeParse(JSON.parse(body)).success).toBe(true);
  });

  it("never forwards inline file bytes and rejects foreign file references", () => {
    const parsed = GenerateZ.parse({ context, notes: [{ name: "a.pdf", kind: "pdf", text: "", pdfBase64: "JVBERi0=", imageBase64: "x" }] });
    expect(parsed.notes[0]).not.toHaveProperty("pdfBase64");
    expect(parsed.notes[0]).not.toHaveProperty("imageBase64");
    expect(GenerateZ.safeParse({ context, notes: [{ name: "a.pdf", kind: "pdf", text: "", fileId: "../../.env" }] }).success).toBe(false);
  });

  it("refuses to build bodies over 4 MB", () => {
    expect(() => jsonBody({ notes: [{ name: "huge", kind: "paste", text: "x".repeat(MAX_REQUEST_BYTES) }] })).toThrow(/too large to send/);
  });
});
