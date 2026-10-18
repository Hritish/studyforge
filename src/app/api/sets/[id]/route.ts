import { NextResponse } from "next/server";
import { PatchSetZ } from "@/lib/api-schemas";
import { prisma } from "@/lib/db";
import { badRequest, parseBody } from "@/lib/http";
import { getSetWithCards, serializeCard } from "@/lib/sets";
import { isNewBest } from "@/lib/study/match";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const set = await getSetWithCards(id);
  if (!set) return badRequest("Set not found.", 404);
  return NextResponse.json({
    id: set.id,
    title: set.title,
    context: set.context,
    bestMatchMs: set.bestMatchMs,
    cards: set.cards.map(serializeCard),
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await parseBody(req, PatchSetZ);
  if ("error" in body) return body.error;
  const set = await prisma.studySet.findUnique({ where: { id } });
  if (!set) return badRequest("Set not found.", 404);
  const { title, context, bestMatchMs } = body.data;
  const newBest = bestMatchMs !== undefined && isNewBest(bestMatchMs, set.bestMatchMs);
  const updated = await prisma.studySet.update({
    where: { id },
    data: {
      ...(title ? { title } : {}),
      ...(context ? { contextJson: JSON.stringify(context), contextName: context.name, contextConfirmed: true } : {}),
      ...(newBest ? { bestMatchMs } : {}),
    },
  });
  return NextResponse.json({ id: updated.id, title: updated.title, bestMatchMs: updated.bestMatchMs, newBest });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await prisma.studySet.deleteMany({ where: { id } });
  if (r.count === 0) return badRequest("Set not found.", 404);
  return NextResponse.json({ ok: true });
}
