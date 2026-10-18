import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidFileKey, kindFromName, newUploadKey, sanitizeFileName } from "@/lib/files/common";
import { ingestStoredFile, resolveNotes } from "@/lib/files/ingest";
import { createLocalStore, type FileStore } from "@/lib/files/store";

let dir: string;
let store: FileStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "sf-store-"));
  store = createLocalStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("file keys", () => {
  it("generates safe, valid keys from user file names", () => {
    const k = newUploadKey("../../etc/My Lecture (week 3).PDF");
    expect(isValidFileKey(k)).toBe(true);
    expect(k).toMatch(/^uploads\/[0-9a-f]{24}\/etc-My-Lecture-week-3\.pdf$/);
    expect(sanitizeFileName("ünïcode slide.png")).toBe("unicode-slide.png");
    expect(kindFromName(k)).toBe("pdf");
  });

  it("rejects traversal and foreign keys", () => {
    for (const bad of ["../x", "uploads/../../etc/passwd", "uploads/abcdefgh/../x.pdf", "other/abcdefgh12/x.pdf", "uploads/short/x.pdf", "uploads/abcdefgh12/", "/uploads/abcdefgh12/x.pdf", "uploads/abcdefgh12/a/b.pdf", 42]) {
      expect(isValidFileKey(bad), String(bad)).toBe(false);
    }
  });
});

describe("local file store", () => {
  it("puts, gets and deletes bytes", async () => {
    const key = newUploadKey("a.txt");
    expect(await store.put(key, Buffer.from("hello"), "text/plain")).toBe(key);
    expect((await store.get(key))?.toString()).toBe("hello");
    await store.del([key, "../nope"]);
    expect(await store.get(key)).toBeNull();
    expect(await readdir(path.join(dir, "uploads"))).toEqual([]); // empty folder removed too
  });

  it("refuses invalid keys", async () => {
    await expect(store.put("uploads/abcdefgh12/../../evil.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid file reference/);
    await expect(store.get("../../etc/passwd")).rejects.toThrow(/Invalid file reference/);
  });

  it("sweeps uploads older than the TTL", async () => {
    const oldKey = newUploadKey("old.pdf");
    const newKey = newUploadKey("new.pdf");
    await store.put(oldKey, Buffer.from("o"), "application/pdf");
    await store.put(newKey, Buffer.from("n"), "application/pdf");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await utimes(path.join(dir, oldKey), twoDaysAgo, twoDaysAgo);
    expect(await store.sweep(24 * 3600 * 1000)).toBe(1);
    expect(await store.get(oldKey)).toBeNull();
    expect(await store.get(newKey)).not.toBeNull();
  });
});

describe("ingesting stored files", () => {
  it("extracts text files and drops the stored copy", async () => {
    const key = await store.put(newUploadKey("notes.md"), readFileSync("samples/cfa-level-2-notes.md"), "text/markdown");
    const { file } = await ingestStoredFile(store, key, "notes.md");
    expect(file.kind).toBe("md");
    expect(file.fileId).toBeUndefined();
    expect(file.text).toContain("Gordon growth model");
    expect(await store.get(key)).toBeNull();
  });

  it("extracts docx text with mammoth", async () => {
    const key = await store.put(newUploadKey("greeks.docx"), readFileSync("tests/fixtures/greeks.docx"), "application/octet-stream");
    const { file } = await ingestStoredFile(store, key, "greeks.docx");
    expect(file.text).toContain("Gamma: rate of change of delta");
  });

  it("keeps PDFs stored (for native page input) and returns their text", async () => {
    const key = await store.put(newUploadKey("fixed-income.pdf"), readFileSync("tests/fixtures/fixed-income.pdf"), "application/pdf");
    const { file } = await ingestStoredFile(store, key, "fixed-income.pdf");
    expect(file).toMatchObject({ kind: "pdf", fileId: key });
    expect(file.text).toContain("Spot rate");
    expect(file.pages).toBeGreaterThan(0);
    const [resolved] = await resolveNotes(store, [{ name: file.name, kind: "pdf", text: file.text, fileId: file.fileId }]);
    expect(Buffer.from(resolved.pdfBase64!, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    // Demo mode (no PDF support) doesn't fetch the bytes.
    const [demo] = await resolveNotes(store, [{ name: file.name, kind: "pdf", text: file.text, fileId: file.fileId }], { pdf: false, images: false });
    expect(demo.pdfBase64).toBeUndefined();
  });

  it("downscales images with sharp and replaces the original", async () => {
    const key = await store.put(newUploadKey("cfa-slide.png"), readFileSync("tests/fixtures/cfa-slide.png"), "image/png");
    const { file } = await ingestStoredFile(store, key, "cfa-slide.png");
    expect(file).toMatchObject({ kind: "image", mediaType: "image/jpeg", width: 1568 });
    expect(file.fileId).not.toBe(key);
    expect(await store.get(key)).toBeNull();
    const [img] = await resolveNotes(store, [{ name: file.name, kind: "image", text: "", fileId: file.fileId, mediaType: file.mediaType }]);
    expect(img.imageBase64!.length).toBeGreaterThan(1000);
    expect(img.mediaType).toBe("image/jpeg");
  });

  it("reports missing and unsupported files", async () => {
    await expect(ingestStoredFile(store, newUploadKey("gone.pdf"), "gone.pdf")).rejects.toThrow(/not found in storage/);
    await expect(resolveNotes(store, [{ name: "gone.pdf", kind: "pdf", text: "", fileId: newUploadKey("gone.pdf") }])).rejects.toThrow(/gone\.pdf was not found/);
    const key = await store.put(newUploadKey("x.exe"), Buffer.from("MZ"), "application/octet-stream");
    await expect(ingestStoredFile(store, key, "x.exe")).rejects.toThrow(/Unsupported file type/);
    expect(await store.get(key)).toBeNull();
  });
});
