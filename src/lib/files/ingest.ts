import "server-only";
import { hasApiKey } from "../ai/claude";
import { extractFile } from "../extract";
import { SCANNED_PDF_NEEDS_KEY_MESSAGE, type NoteInput } from "../types";
import { isValidFileKey, type FileRef, type NoteRef } from "./common";
import type { FileStore } from "./store";

export const MISSING_FILE_MESSAGE = "was not found in storage (uploads expire after 24 hours). Remove it and upload it again.";

/**
 * Read an uploaded file from the store and extract it:
 *  - text files (.txt/.md/.docx): text is returned and the stored file is deleted (no longer needed);
 *  - PDFs: text + page count; the PDF stays stored so Claude can read its pages;
 *  - images: downscaled with sharp, the small JPEG replaces the original in the store.
 */
export async function ingestStoredFile(store: FileStore, key: string, name: string): Promise<{ file: FileRef; warning?: string }> {
  if (!isValidFileKey(key)) throw new Error("invalid file reference.");
  const buf = await store.get(key);
  if (!buf) throw new Error(MISSING_FILE_MESSAGE);
  let out;
  try {
    out = await extractFile(name, buf);
  } catch (e) {
    await store.del([key]);
    throw e;
  }
  if (out.kind === "image") {
    const dir = key.slice(0, key.lastIndexOf("/"));
    const small = await store.put(`${dir}/slide.jpg`, Buffer.from(out.image.base64, "base64"), out.image.mediaType);
    if (small !== key) await store.del([key]);
    return {
      file: { fileId: small, name, kind: "image", text: "", chars: 0, mediaType: out.image.mediaType, width: out.image.width, height: out.image.height },
    };
  }
  if (out.kind === "pdf") {
    // Scanned PDFs are fine with Claude: it reads each page as an image.
    const warning = !out.text.trim() && !hasApiKey() ? `${name}: ${SCANNED_PDF_NEEDS_KEY_MESSAGE}` : undefined;
    return { file: { fileId: key, name, kind: "pdf", text: out.text, chars: out.text.length, pages: out.pages }, warning };
  }
  await store.del([key]);
  const warning = out.text.trim() ? undefined : `${name}: no text could be extracted.`;
  return { file: { name, kind: out.kind, text: out.text, chars: out.text.length }, warning };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Turn note references into NoteInputs with the stored bytes loaded as base64.
 * Only fetches what the generator can use (`caps`), so demo mode reads nothing.
 */
export async function resolveNotes(store: FileStore, notes: NoteRef[], caps: { pdf: boolean; images: boolean } = { pdf: true, images: true }): Promise<NoteInput[]> {
  return mapLimit(notes, 6, async (n): Promise<NoteInput> => {
    const base: NoteInput = { name: n.name, kind: n.kind, text: n.text };
    const wanted = n.fileId && ((n.kind === "pdf" && caps.pdf) || (n.kind === "image" && caps.images));
    if (!wanted) return base;
    const buf = await store.get(n.fileId!);
    if (!buf) throw new Error(`${n.name} ${MISSING_FILE_MESSAGE}`);
    const b64 = buf.toString("base64");
    return n.kind === "pdf" ? { ...base, pdfBase64: b64 } : { ...base, imageBase64: b64, mediaType: n.mediaType ?? "image/jpeg" };
  });
}
