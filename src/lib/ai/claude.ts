/**
 * Claude API integration (real mode). Only used when ANTHROPIC_API_KEY is set.
 * The client is injected so tests can pass a mock.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { CardDraft, StudyContext } from "../types";
import {
  buildCardsUserContent,
  buildContextUserContent,
  CARDS_SYSTEM_PROMPT,
  CONTEXT_SYSTEM_PROMPT,
  type CardsPromptInput,
  type ContextPromptInput,
} from "./prompts";
import {
  CardsOutputSchema,
  ContextOutputSchema,
  parseCardsMessage,
  parseContextMessage,
  type MessageLike,
  type ParseResult,
} from "./schema";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const CARDS_MAX_TOKENS = 32_000;
export const CONTEXT_MAX_TOKENS = 8_000;

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function createClient(): Anthropic {
  // Keys not scoped to a workspace must name one on every request.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {});
}

/**
 * JSON-schema output format without the SDK's auto-parse hook: we parse
 * ourselves after checking stop_reason, so a truncated (max_tokens) response
 * never throws inside finalMessage().
 */
function jsonFormat(schema: Parameters<typeof betaZodOutputFormat>[0]) {
  const f = betaZodOutputFormat(schema);
  return { type: "json_schema" as const, schema: f.schema };
}

export function buildCardsRequest(input: CardsPromptInput, model = getModel()): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: CARDS_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: jsonFormat(CardsOutputSchema) },
    system: [{ type: "text", text: CARDS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildCardsUserContent(input) }],
  };
}

export function buildContextRequest(input: ContextPromptInput, model = getModel()): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: CONTEXT_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: jsonFormat(ContextOutputSchema) },
    system: CONTEXT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildContextUserContent(input) }],
  };
}

/** The subset of the SDK client we use (makes mocking easy). */
export interface ClaudeLike {
  beta: {
    messages: {
      create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<MessageLike>;
      stream(
        params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        options?: { signal?: AbortSignal },
      ): {
        on(event: "text", cb: (delta: string) => void): unknown;
        finalMessage(): Promise<MessageLike>;
      };
    };
  };
}

/** Stream one generation request and parse the final message. */
export async function generateCardsWithClaude(
  client: ClaudeLike,
  input: CardsPromptInput,
  onDelta?: (charsSoFar: number) => void,
  signal?: AbortSignal,
): Promise<ParseResult<CardDraft[]>> {
  const stream = client.beta.messages.stream(buildCardsRequest(input), signal ? { signal } : undefined);
  let chars = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    onDelta?.(chars);
  });
  const msg = await stream.finalMessage();
  return parseCardsMessage(msg, input.context);
}

export async function detectContextWithClaude(client: ClaudeLike, input: ContextPromptInput): Promise<ParseResult<StudyContext>> {
  const msg = await client.beta.messages.create(buildContextRequest(input));
  const source: StudyContext["source"] = input.examName?.trim()
    ? "user"
    : input.syllabusText?.trim() || input.syllabusPdfBase64
      ? "syllabus"
      : "inferred";
  return parseContextMessage(msg, source);
}

/**
 * Map SDK errors to friendly messages, most specific first:
 * auth → rate limit → API status errors → connection errors.
 * (In the TS SDK APIConnectionError extends APIError with an undefined
 * status, so the status branch only matches errors that carry an HTTP status.)
 */
export function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env and restart the server.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your API key doesn't have access to this model. Check ANTHROPIC_MODEL or your account's model access.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Claude is rate-limiting requests right now. Wait a minute and try again.";
  }
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    if (err.status === 400) return `Claude rejected the request: ${err.message}`;
    if (err.status === 413) return "The notes are too large for a single request. Try splitting them into smaller files.";
    if (err.status === 529 || err.status >= 500) return "Claude is temporarily overloaded or unavailable. Please try again shortly.";
    return `Claude API error (${err.status}). Please try again.`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the Claude API. Check your internet connection and try again.";
  }
  return err instanceof Error ? `Unexpected error: ${err.message}` : "Unexpected error.";
}
