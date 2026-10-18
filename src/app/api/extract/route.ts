import { NextResponse } from "next/server";
import { hasApiKey } from "@/lib/ai/claude";
import { extractFile } from "@/lib/extract";
import { SCANNED_PDF_NEEDS_KEY_MESSAGE } from "@/lib/types";
import { badRequest } from "@/lib/http";

export const runtime = "nodejs";

/** Extract text from uploaded files (multipart field "files"). */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Expected multipart/form-data with one or more 'files'.");
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (files.length === 0) return badRequest("No files uploaded.");
  if (files.length > 60) return badRequest("Upload at most 60 files at once.");

  const results = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      const out = await extractFile(f.name, Buffer.from(await f.arrayBuffer()));
      // Scanned PDFs are fine with Claude: it reads each page as an image.
      const scannedPdf = out.kind === "pdf" && Boolean(out.pdfBase64);
      if (out.kind !== "image" && !out.text.trim() && !(scannedPdf && hasApiKey())) {
        errors.push(scannedPdf ? `${f.name}: ${SCANNED_PDF_NEEDS_KEY_MESSAGE}` : `${f.name}: no text could be extracted.`);
      }
      results.push({ ...out, chars: out.text.length });
    } catch (e) {
      errors.push(e instanceof Error ? `${f.name}: ${e.message}` : `${f.name}: failed to read file.`);
    }
  }
  return NextResponse.json({ files: results, errors });
}
