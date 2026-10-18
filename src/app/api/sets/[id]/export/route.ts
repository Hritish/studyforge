import { prisma } from "@/lib/db";
import { cardsToCsv, safeFilename } from "@/lib/csv";
import { badRequest } from "@/lib/http";

export const runtime = "nodejs";

/** CSV export that Quizlet can import (comma between term/definition, newline between cards). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const set = await prisma.studySet.findUnique({ where: { id }, include: { cards: { orderBy: { position: "asc" } } } });
  if (!set) return badRequest("Set not found.", 404);
  return new Response(cardsToCsv(set.cards), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(set.title)}.csv"`,
    },
  });
}
