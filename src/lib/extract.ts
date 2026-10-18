import "server-only";
import { kindFromName, MAX_UPLOAD_BYTES, UNSUPPORTED_FILE_MESSAGE, type FileKind } from "./files/common";
import { prepareImage, type PreparedImage } from "./images";

export { kindFromName };
export const MAX_FILE_BYTES = MAX_UPLOAD_BYTES;

export type Extracted =
  | { kind: "image"; text: ""; image: PreparedImage }
  | { kind: Exclude<FileKind, "image">; text: string; pages?: number };

/** Extract plain text from a file (PDF page count too); images are downscaled with sharp. */
export async function extractFile(name: string, buf: Buffer): Promise<Extracted> {
  const kind = kindFromName(name);
  if (!kind) throw new Error(UNSUPPORTED_FILE_MESSAGE);
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error("larger than 25 MB.");

  if (kind === "image") {
    try {
      return { kind, text: "", image: await prepareImage(buf) };
    } catch {
      throw new Error("could not read this image.");
    }
  }
  if (kind === "txt" || kind === "md") {
    return { kind, text: buf.toString("utf8").replace(/\r\n/g, "\n") };
  }
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { kind, text: value.replace(/\n{3,}/g, "\n\n").trim() };
  }
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { kind, text: text.map((t) => t.trim()).filter(Boolean).join("\n\n"), pages: totalPages };
}
