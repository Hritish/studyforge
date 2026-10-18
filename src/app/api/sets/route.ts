import { after, NextResponse } from "next/server";
import { CreateSetZ } from "@/lib/api-schemas";
import { prisma } from "@/lib/db";
import { getFileStore } from "@/lib/files/store";
import { parseBody } from "@/lib/http";
import { summarize } from "@/lib/study/mastery";

export const runtime = "nodejs";

export async function GET() {
  const sets = await prisma.studySet.findMany({
    orderBy: { updatedAt: "desc" },
    include: { cards: { select: { mastery: true, status: true } } },
  });
  return NextResponse.json({
    sets: sets.map((s) => ({
      id: s.id,
      title: s.title,
      contextName: s.contextName,
      cardCount: s.cards.length,
      progress: summarize(s.cards),
      updatedAt: s.updatedAt,
    })),
  });
}

export async function POST(req: Request) {
  const body = await parseBody(req, CreateSetZ);
  if ("error" in body) return body.error;
  const { title, context, contextConfirmed, cards, notes, files } = body.data;
  if (cards.length === 0) return NextResponse.json({ error: "Add at least one card before saving." }, { status: 400 });
  const set = await prisma.studySet.create({
    data: {
      title: title || (context.name ? `${context.name} set` : "Untitled set"),
      contextName: context.name,
      contextJson: JSON.stringify(context),
      contextConfirmed,
      notes: { create: notes.map((n) => ({ name: n.name, kind: n.kind, text: n.text })) },
      cards: { create: cards.map((c, i) => ({ ...c, position: i })) },
    },
  });
  // The uploads were only needed for generation; drop them (best effort).
  if (files.length) after(() => getFileStore().del(files));
  return NextResponse.json({ id: set.id }, { status: 201 });
}
