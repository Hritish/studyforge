import { GenerateZ } from "@/lib/api-schemas";
import { prisma } from "@/lib/db";
import { getGenerator } from "@/lib/engine";
import { runGeneration } from "@/lib/generate";
import { parseBody } from "@/lib/http";
import type { GenerationEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

/** Streams generation progress as NDJSON (one GenerationEvent per line). */
export async function POST(req: Request) {
  const body = await parseBody(req, GenerateZ);
  if ("error" in body) return body.error;
  const { context, notes, count, setId } = body.data;

  const existing = setId
    ? await prisma.card.findMany({ where: { setId }, select: { front: true, back: true } })
    : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastProgress = 0;
      const emit = (e: GenerationEvent) => {
        // Throttle the high-frequency streaming progress events.
        if (e.type === "progress" && e.message.includes("k chars")) {
          const now = Date.now();
          if (now - lastProgress < 400) return;
          lastProgress = now;
        }
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        await runGeneration(
          { notes, context, target: count === "auto" ? null : count, existing },
          getGenerator(),
          emit,
        );
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Generation failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
