import { NextResponse } from "next/server";
import { ProgressZ } from "@/lib/api-schemas";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/http";
import { applyResult, statusFor } from "@/lib/study/mastery";

export const runtime = "nodejs";

/** Record study results (know it / still learning / correct / incorrect) and update mastery. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, ProgressZ);
  if ("error" in body) return body.error;
  const ids = [...new Set(body.data.results.map((r) => r.cardId))];
  const cards = await prisma.card.findMany({ where: { setId: id, id: { in: ids } } });
  const byId = new Map(cards.map((c) => [c.id, { ...c }]));
  for (const r of body.data.results) {
    const c = byId.get(r.cardId);
    if (!c) continue;
    c.mastery = applyResult(c.mastery, r.result);
    c.status = statusFor(r.result, c.status);
    if (r.result === "correct") c.correctCount++;
    if (r.result === "incorrect") c.incorrectCount++;
  }
  const now = new Date();
  await prisma.$transaction(
    [...byId.values()].map((c) =>
      prisma.card.update({
        where: { id: c.id },
        data: { mastery: c.mastery, status: c.status, correctCount: c.correctCount, incorrectCount: c.incorrectCount, lastStudiedAt: now },
      }),
    ),
  );
  return NextResponse.json({
    cards: [...byId.values()].map((c) => ({ id: c.id, mastery: c.mastery, status: c.status })),
  });
}
