import { NextResponse } from "next/server";
import { DetectContextZ } from "@/lib/api-schemas";
import { detectContext } from "@/lib/engine";
import { parseBody } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await parseBody(req, DetectContextZ);
  if ("error" in body) return body.error;
  const { examName, syllabus, notesText } = body.data;
  if (!examName?.trim() && !syllabus?.text.trim() && !syllabus?.pdfBase64 && !notesText?.trim()) {
    return NextResponse.json({ error: "Provide an exam/course name, a syllabus, or some notes." }, { status: 400 });
  }
  const result = await detectContext({
    examName,
    syllabusText: syllabus?.text,
    syllabusPdfBase64: syllabus?.kind === "pdf" ? syllabus.pdfBase64 : undefined,
    notesText,
  });
  return NextResponse.json(result);
}
