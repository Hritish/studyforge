import { NextResponse } from "next/server";
import { toSlideImages } from "@/lib/ai/images";
import { DetectContextZ } from "@/lib/api-schemas";
import { detectContext } from "@/lib/engine";
import { parseBody } from "@/lib/http";
import { firstPages } from "@/lib/pdf";

const CONTEXT_PDF_PAGES = 5;

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await parseBody(req, DetectContextZ);
  if ("error" in body) return body.error;
  const { examName, syllabus, notesText, notesPdf } = body.data;
  // Syllabus screenshots first, then note images.
  const images = toSlideImages([...(syllabus?.kind === "image" ? [syllabus] : []), ...(body.data.images ?? [])]);
  if (!examName?.trim() && !syllabus?.text.trim() && !syllabus?.pdfBase64 && !notesText?.trim() && !notesPdf && images.length === 0) {
    return NextResponse.json({ error: "Provide an exam/course name, a syllabus, or some notes." }, { status: 400 });
  }
  // A few pages are enough to recognize the course; skip if the PDF can't be split.
  const notesPdfBase64 = notesPdf ? await firstPages(notesPdf, CONTEXT_PDF_PAGES).catch(() => undefined) : undefined;
  const result = await detectContext({
    examName,
    syllabusText: syllabus?.text,
    syllabusPdfBase64: syllabus?.kind === "pdf" ? syllabus.pdfBase64 : undefined,
    notesText,
    notesPdfBase64,
    images,
  });
  return NextResponse.json(result);
}
