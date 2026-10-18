import { NextResponse } from "next/server";
import { toSlideImages } from "@/lib/ai/images";
import { DetectContextZ } from "@/lib/api-schemas";
import { unauthorized } from "@/lib/auth/session";
import { detectContext, engineMode } from "@/lib/engine";
import { resolveNotes } from "@/lib/files/ingest";
import { getFileStore } from "@/lib/files/store";
import { parseBody } from "@/lib/http";
import { firstPages } from "@/lib/pdf";

const CONTEXT_PDF_PAGES = 5;

export const runtime = "nodejs";
// One Claude call, but it reads PDF pages and images; 300 s is the Hobby maximum.
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const body = await parseBody(req, DetectContextZ);
  if ("error" in body) return body.error;
  const { examName, syllabus, notesText, notesPdf } = body.data;
  const imageRefs = body.data.images ?? [];
  if (!examName?.trim() && !syllabus?.text.trim() && !syllabus?.fileId && !notesText?.trim() && !notesPdf && imageRefs.length === 0) {
    return NextResponse.json({ error: "Provide an exam/course name, a syllabus, or some notes." }, { status: 400 });
  }
  const store = getFileStore();
  // Demo mode reads neither PDFs nor images, so don't fetch them.
  const caps = engineMode() === "claude" ? { pdf: true, images: true } : { pdf: false, images: false };
  let resolvedSyllabus, resolvedImages, notesPdfBase64: string | undefined;
  try {
    [resolvedSyllabus] = syllabus ? await resolveNotes(store, [syllabus], caps) : [undefined];
    resolvedImages = await resolveNotes(store, imageRefs, caps);
    if (notesPdf && caps.pdf) {
      const [pdf] = await resolveNotes(store, [{ name: "notes.pdf", kind: "pdf", text: "", fileId: notesPdf }], caps);
      // A few pages are enough to recognize the course; skip if the PDF can't be split.
      notesPdfBase64 = pdf.pdfBase64 ? await firstPages(pdf.pdfBase64, CONTEXT_PDF_PAGES).catch(() => undefined) : undefined;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the uploaded files." }, { status: 422 });
  }
  // Syllabus screenshots first, then note images.
  const images = toSlideImages([...(resolvedSyllabus?.kind === "image" ? [resolvedSyllabus] : []), ...resolvedImages]);
  const imageCount = imageRefs.length + (syllabus?.kind === "image" ? 1 : 0);
  const result = await detectContext({
    examName,
    syllabusText: resolvedSyllabus?.text,
    syllabusPdfBase64: resolvedSyllabus?.kind === "pdf" ? resolvedSyllabus.pdfBase64 : undefined,
    notesText,
    notesPdfBase64,
    images,
  }, imageCount);
  return NextResponse.json(result);
}
