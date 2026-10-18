import { NextResponse } from "next/server";
import type { z } from "zod";

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { error: badRequest("Request body must be JSON.") };
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { error: badRequest(`Invalid request: ${issue?.path.join(".") || "body"} ${issue?.message ?? ""}`.trim()) };
  }
  return { data: r.data };
}
