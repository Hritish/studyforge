import { after, NextResponse } from "next/server";
import { AddCardsZ } from "@/lib/api-schemas";
import { dedupeCards } from "@/lib/chunk";
import { prisma } from "@/lib/db";
import { getFileStore } from "@/lib/files/store";
import { badRequest, parseBody } from "@/lib/http";

export const runtime = "nodejs";

/** Append cards (and the notes they came from) to an existing set, skipping duplicates. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, AddCardsZ);
  if ("error" in body) return body.error;
  const set = await prisma.studySet.findUnique({ where: { id }, include: { cards: { select: { front: true, back: true, position: true } } } });
  if (!set) return badRequest("Set not found.", 404);
  const { cards, removed } = dedupeCards(body.data.cards, set.cards);
  const start = set.cards.reduce((m, c) => Math.max(m, c.position + 1), 0);
  await prisma.$transaction([
    ...cards.map((c, i) => prisma.card.create({ data: { ...c, setId: id, position: start + i } })),
    ...body.data.notes.map((n) => prisma.noteSource.create({ data: { setId: id, name: n.name, kind: n.kind, text: n.text } })),
    prisma.studySet.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);
  if (body.data.files.length) after(() => getFileStore().del(body.data.files));
  return NextResponse.json({ added: cards.length, skippedDuplicates: removed }, { status: 201 });
}

