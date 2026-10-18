import "server-only";
import type { NoteInput } from "./types";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function kindFromName(name: string): NoteInput["kind"] | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "txt" || ext === "text") return "txt";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return null;
}

/** Extract plain text from an uploaded file. PDFs also return base64 for native Claude input. */
export async function extractFile(name: string, buf: Buffer): Promise<NoteInput & { pages?: number }> {
  const kind = kindFromName(name);
  if (!kind) throw new Error(`Unsupported file type: ${name}. Use .txt, .md, .pdf or .docx.`);
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error(`${name} is larger than 25 MB.`);

  if (kind === "txt" || kind === "md") {
    return { name, kind, text: buf.toString("utf8").replace(/\r\n/g, "\n") };
  }
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { name, kind, text: value.replace(/\n{3,}/g, "\n\n").trim() };
  }
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const joined = text.map((t) => t.trim()).filter(Boolean).join("\n\n");
  return { name, kind, text: joined, pdfBase64: buf.toString("base64"), pages: totalPages };
}
