import "server-only";
import { createClient, detectContextWithClaude, friendlyError, generateCardsWithClaude, getModel, hasApiKey, type ClaudeLike } from "./ai/claude";
import type { ContextPromptInput } from "./ai/prompts";
import { detectDemoContext, generateDemoCards } from "./demo/generator";
import type { ChunkGenerator } from "./generate";
import type { StudyContext } from "./types";

export type EngineMode = "demo" | "claude";

export function engineMode(): EngineMode {
  return hasApiKey() ? "claude" : "demo";
}

export function demoGenerator(): ChunkGenerator {
  return {
    mode: "demo",
    supportsPdf: false,
    async generate({ item, target, context }) {
      const cards = generateDemoCards(item.text, context, { target: target ?? undefined });
      if (cards.length === 0) {
        return {
          ok: false,
          reason: "empty",
          message:
            "Demo mode couldn't find any 'Term: definition' lines or headings with bullets in this part. Add an ANTHROPIC_API_KEY for full AI generation.",
        };
      }
      return { ok: true, data: cards };
    },
  };
}

export function claudeGenerator(client: ClaudeLike = createClient() as unknown as ClaudeLike): ChunkGenerator {
  return {
    mode: "claude",
    model: getModel(),
    supportsPdf: true,
    async generate({ item, index, count, target, context, existingFronts, onDelta }) {
      try {
        return await generateCardsWithClaude(
          client,
          {
            context,
            notesText: item.text,
            pdfBase64: item.pdfBase64,
            notesLabel: item.label,
            chunkIndex: index,
            chunkCount: count,
            target,
            existingFronts,
          },
          onDelta,
        );
      } catch (err) {
        return { ok: false, reason: "invalid", message: friendlyError(err) };
      }
    },
  };
}

export function getGenerator(): ChunkGenerator {
  return engineMode() === "claude" ? claudeGenerator() : demoGenerator();
}

export async function detectContext(
  input: ContextPromptInput,
): Promise<{ context: StudyContext; mode: EngineMode; warning?: string }> {
  if (engineMode() === "demo") {
    return { context: detectDemoContext(input), mode: "demo" };
  }
  try {
    const client = createClient() as unknown as ClaudeLike;
    const res = await detectContextWithClaude(client, input);
    if (res.ok) return { context: res.data, mode: "claude" };
    return { context: detectDemoContext(input), mode: "claude", warning: `${res.message} Used a basic keyword guess instead.` };
  } catch (err) {
    return { context: detectDemoContext(input), mode: "claude", warning: `${friendlyError(err)} Used a basic keyword guess instead.` };
  }
}
