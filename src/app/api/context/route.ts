import { NextResponse } from "next/server";
import { toSlideImages } from "@/lib/ai/images";
import { DetectContextZ } from "@/lib/api-schemas";
import { detectContext } from "@/lib/engine";
import { parseBody } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await parseBody(req, DetectContextZ);
  if ("error" in body) return body.error;
  const { examName, syllabus, notesText } = body.data;
  // Syllabus screenshots first, then note images.
  const images = toSlideImages([...(syllabus?.kind === "image" ? [syllabus] : []), ...(body.data.images ?? [])]);
  if (!examName?.trim() && !syllabus?.text.trim() && !syllabus?.pdfBase64 && !notesText?.trim() && images.length === 0) {
    return NextResponse.json({ error: "Provide an exam/course name, a syllabus, or some notes." }, { status: 400 });
  }
  const result = await detectContext({
    examName,
    syllabusText: syllabus?.text,
    syllabusPdfBase64: syllabus?.kind === "pdf" ? syllabus.pdfBase64 : undefined,
    notesText,
    images,
  });
  return NextResponse.json(result);
}
