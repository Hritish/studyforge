import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Serves samples/cfa-level-2-notes.md so the "Use sample notes" button works. */
export async function GET() {
  try {
    const text = await readFile(path.join(process.cwd(), "samples", "cfa-level-2-notes.md"), "utf8");
    return NextResponse.json({ name: "cfa-level-2-notes.md", text });
  } catch {
    return NextResponse.json({ error: "Sample notes not found." }, { status: 404 });
  }
}
