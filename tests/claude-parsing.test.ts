import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildCardsRequest,
  buildContextRequest,
  detectContextWithClaude,
  FALLBACK_BETA,
  friendlyError,
  generateCardsWithClaude,
  type ClaudeLike,
} from "@/lib/ai/claude";
import { buildCardsUserContent, notesSampleForContext } from "@/lib/ai/prompts";
import { matchTopic, parseCardsMessage, parseContextMessage, type MessageLike } from "@/lib/ai/schema";
import { KNOWN_CONTEXTS, knownToStudyContext } from "@/lib/contexts";

const ctx = knownToStudyContext(KNOWN_CONTEXTS.find((k) => k.name === "CFA Level II")!, "user", 1);

const promptInput = {
  context: ctx,
  notesText: "Z-spread: constant spread over the spot curve.",
  notesLabel: "Notes",
  chunkIndex: 0,
  chunkCount: 1,
  target: 10,
  existingFronts: ["Gordon growth model"],
};

function msg(text: string, stop_reason = "end_turn", extra: Partial<MessageLike> = {}): MessageLike {
  return { stop_reason, content: [{ type: "thinking", text: undefined }, { type: "text", text }], ...extra };
}

const goodCards = JSON.stringify({
  cards: [
    { front: "Z-spread", back: "Constant spread over spot curve.", type: "definition", topic: "Fixed Income", difficulty: 2, source: "Z-spread: constant spread" },
    { front: "OAS", back: "OAS = Z-spread − option cost", type: "formula", topic: "fixed income valuation", difficulty: 7, source: "" },
    { front: "  ", back: "empty front is dropped", type: "definition", topic: "Fixed Income", difficulty: 1, source: "" },
  ],
});

describe("request building", () => {
  it("builds a valid Opus 5.5 cards request", () => {
    const req = buildCardsRequest(promptInput, "claude-opus-5-5") as unknown as Record<string, unknown>;
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(req.betas).toEqual([FALLBACK_BETA]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(req.fallbacks).toBe("default");
    // Params that 400 on Opus 5.5 must not be sent.
    for (const k of ["temperature", "top_p", "top_k", "tool_choice"]) expect(req).not.toHaveProperty(k);
    expect(JSON.stringify(req)).not.toContain("budget_tokens");
    const messages = req.messages as { role: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[messages.length - 1].role).toBe("user"); // no assistant prefill
    const schema = (req.output_config as { format: { schema: { properties: Record<string, unknown> } } }).format.schema;
    expect(Object.keys(schema.properties)).toEqual(["cards"]);
  });

  it("context detection uses low effort", () => {
    const req = buildContextRequest({ examName: "CFA Level II" }) as unknown as Record<string, unknown>;
    expect(req.output_config).toMatchObject({ effort: "low" });
    expect(req.model).toBe(process.env.ANTHROPIC_MODEL || "claude-opus-5-5");
  });

  it("honours ANTHROPIC_MODEL", () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-test-model");
    expect((buildCardsRequest(promptInput) as { model: string }).model).toBe("claude-test-model");
    vi.unstubAllEnvs();
  });

  it("injects the study context, existing cards and target into the prompt", () => {
    const blocks = buildCardsUserContent(promptInput);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain("name: CFA Level II");
    expect(text).toContain("Fixed Income");
    expect(text).toContain("- Gordon growth model");
    expect(text).toContain("about 10 cards");
    expect(text).toContain("<notes");
  });

  it("sends PDFs as base64 document blocks", () => {
    const blocks = buildCardsUserContent({ ...promptInput, pdfBase64: "JVBERi0=" });
    expect(blocks[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } });
    expect((blocks[1] as { text: string }).text).not.toContain("<notes");
  });

  it("samples long notes for context detection without dropping headings", () => {
    const long = "intro ".repeat(10000) + "\n## Late Section\n" + "x".repeat(100);
    const s = notesSampleForContext(long, 5000);
    expect(s.length).toBeLessThan(long.length);
    expect(s).toContain("## Late Section");
  });
});

describe("response parsing", () => {
  it("parses and normalizes cards", () => {
    const r = parseCardsMessage(msg(goodCards), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(2);
    expect(r.data[1].difficulty).toBe(3); // clamped
    expect(r.data[1].topic).toBe("Fixed Income"); // matched to a context topic area
  });

  it("handles refusal before reading content", () => {
    const r = parseCardsMessage({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }, ctx);
    expect(r).toMatchObject({ ok: false, reason: "refusal" });
    if (!r.ok) expect(r.message).toContain("cyber");
  });

  it("handles max_tokens truncation", () => {
    const r = parseCardsMessage(msg('{"cards":[{"front":"A"', "max_tokens"), ctx);
    expect(r).toMatchObject({ ok: false, reason: "max_tokens" });
  });

  it("rejects invalid JSON and schema mismatches", () => {
    expect(parseCardsMessage(msg("not json"), ctx)).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseCardsMessage(msg('{"cards":[{"front":1}]}'), ctx)).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseCardsMessage(msg(""), ctx)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("ignores fallback/thinking blocks and reads text", () => {
    const m: MessageLike = { stop_reason: "end_turn", content: [{ type: "fallback" }, { type: "text", text: goodCards }] };
    expect(parseCardsMessage(m, ctx).ok).toBe(true);
  });

  it("parses context output", () => {
    const r = parseContextMessage(
      msg(JSON.stringify({ name: " CFA Level II ", domain: "Finance", level: "Advanced", topicAreas: ["Equity", "Equity", "Fixed Income"], conventions: "CFA terms", confidence: 1.4 })),
      "inferred",
    );
    expect(r).toMatchObject({ ok: true, data: { name: "CFA Level II", topicAreas: ["Equity", "Fixed Income"], confidence: 1, source: "inferred" } });
  });

  it("matchTopic falls back sensibly", () => {
    expect(matchTopic("Derivatives", ctx)).toBe("Derivatives");
    expect(matchTopic("Totally unrelated", { ...ctx, topicAreas: [] })).toBe("Totally unrelated");
  });
});

describe("mocked SDK calls", () => {
  function mockClient(final: MessageLike, deltas: string[] = []): ClaudeLike & { calls: unknown[] } {
    const calls: unknown[] = [];
    return {
      calls,
      beta: {
        messages: {
          create: async (p) => {
            calls.push(p);
            return final;
          },
          stream: (p) => {
            calls.push(p);
            let cb: ((d: string) => void) | undefined;
            return {
              on: (_e: "text", f: (d: string) => void) => {
                cb = f;
              },
              finalMessage: async () => {
                deltas.forEach((d) => cb?.(d));
                return final;
              },
            };
          },
        },
      },
    };
  }

  it("streams generation and reports progress", async () => {
    const client = mockClient(msg(goodCards), ["{\"ca", "rds\":"]);
    const progress: number[] = [];
    const r = await generateCardsWithClaude(client, promptInput, (n) => progress.push(n));
    expect(r.ok).toBe(true);
    expect(progress).toEqual([4, 9]);
    expect(client.calls).toHaveLength(1);
  });

  it("detects context via create()", async () => {
    const client = mockClient(msg(JSON.stringify({ name: "CFA Level II", domain: "Finance", level: "L2", topicAreas: ["Ethics"], conventions: "", confidence: 0.9 })));
    const r = await detectContextWithClaude(client, { notesText: "FCFE and residual income" });
    expect(r).toMatchObject({ ok: true, data: { name: "CFA Level II", source: "inferred" } });
  });
});

describe("friendlyError", () => {
  const headers = new Headers();
  it("maps typed SDK errors most-specific-first", () => {
    expect(friendlyError(new Anthropic.AuthenticationError(401, {}, "bad key", headers))).toMatch(/API key/);
    expect(friendlyError(new Anthropic.RateLimitError(429, {}, "slow down", headers))).toMatch(/rate-limiting/);
    expect(friendlyError(new Anthropic.InternalServerError(529, {}, "overloaded", headers))).toMatch(/overloaded/);
    expect(friendlyError(new Anthropic.BadRequestError(400, {}, "bad", headers))).toMatch(/rejected the request/);
    expect(friendlyError(new Anthropic.APIConnectionError({ message: "down" }))).toMatch(/Couldn't reach/);
    expect(friendlyError(new Error("boom"))).toMatch(/boom/);
  });
});
