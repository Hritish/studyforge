/**
 * Split PDFs into page ranges so each range can be sent to Claude as its own
 * native document block. Claude reads every page as an image, so scanned
 * pages, slide screenshots and handwriting all work without separate OCR.
 */
import { PDFDocument } from "pdf-lib";

export interface PdfPart {
  base64: string;
  /** 1-based page range of the original PDF. */
  from: number;
  to: number;
}

/** Pages per request: slide-heavy pages produce many cards, so keep batches small. */
export const PDF_PAGES_PER_REQUEST = 10;
/** Stay well under the API's 32 MB request limit (base64 inflates by ~4/3). */
export const PDF_MAX_BASE64 = 20_000_000;

async function load(base64: string): Promise<PDFDocument> {
  return PDFDocument.load(Buffer.from(base64, "base64"), { ignoreEncryption: true });
}

async function extractRange(src: PDFDocument, from: number, to: number): Promise<string> {
  const out = await PDFDocument.create();
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save()).toString("base64");
}

export async function pdfPageCount(base64: string): Promise<number> {
  return (await load(base64)).getPageCount();
}

/**
 * Split into ranges of at most `pagesPer` pages, halving a range whenever it
 * exceeds `maxBase64`. A single page that is still too large throws.
 */
export async function splitPdf(
  base64: string,
  pagesPer = PDF_PAGES_PER_REQUEST,
  maxBase64 = PDF_MAX_BASE64,
): Promise<PdfPart[]> {
  const src = await load(base64);
  const total = src.getPageCount();
  if (total === 0) return [];
  if (total <= pagesPer && base64.length <= maxBase64) return [{ base64, from: 1, to: total }];

  const parts: PdfPart[] = [];
  const pushRange = async (from: number, to: number): Promise<void> => {
    const b64 = await extractRange(src, from, to);
    if (b64.length <= maxBase64) {
      parts.push({ base64: b64, from, to });
      return;
    }
    if (from === to) throw new Error(`page ${from} is too large to send (over ${Math.round(maxBase64 / 1_333_333)} MB).`);
    const mid = Math.floor((from + to) / 2);
    await pushRange(from, mid);
    await pushRange(mid + 1, to);
  };
  for (let from = 1; from <= total; from += pagesPer) await pushRange(from, Math.min(total, from + pagesPer - 1));
  return parts;
}

/** The first `n` pages, for context detection. */
export async function firstPages(base64: string, n: number): Promise<string> {
  const src = await load(base64);
  if (src.getPageCount() <= n) return base64;
  return extractRange(src, 1, n);
}
