import { NextResponse } from "next/server";
import { PatchCardZ } from "@/lib/api-schemas";
import { prisma } from "@/lib/db";
import { badRequest, parseBody } from "@/lib/http";
import { serializeCard } from "@/lib/sets";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await parseBody(req, PatchCardZ);
  if ("error" in body) return body.error;
  const exists = await prisma.card.findUnique({ where: { id } });
  if (!exists) return badRequest("Card not found.", 404);
  const card = await prisma.card.update({ where: { id }, data: body.data });
  return NextResponse.json({ card: serializeCard(card) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await prisma.card.deleteMany({ where: { id } });
  if (r.count === 0) return badRequest("Card not found.", 404);
  return NextResponse.json({ ok: true });
}
