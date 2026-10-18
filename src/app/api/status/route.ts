import { NextResponse } from "next/server";
import { getModel } from "@/lib/ai/claude";
import { engineMode } from "@/lib/engine";

export async function GET() {
  const mode = engineMode();
  return NextResponse.json({ mode, model: mode === "claude" ? getModel() : null });
}
