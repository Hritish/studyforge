/**
 * Prompt building for context detection and card generation. Pure functions so
 * they can be unit-tested without the network.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { estimateTokens } from "../chunk";
import type { CardCount, StudyContext } from "../types";
import { buildImageBlocks, IMAGE_INSTRUCTIONS, type SlideImage } from "./images";

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

/** Stable system prompt (kept byte-identical across requests so it caches). */
export const CARDS_SYSTEM_PROMPT = `You are StudyForge, an expert exam-prep tutor who writes high-quality flashcards from a student's own notes.

Rules:
1. Ground every card in the notes. Do not add facts, numbers, or claims that are not in the notes. The study context only shapes framing, terminology, emphasis, and topic tags; it is never a source of new facts.
2. Use the study context's terminology and notation conventions (e.g. the exam's official names for concepts and symbols).
3. Emphasize what is testable on that exam: definitions examiners use, formulas, decision rules, distinctions between commonly confused ideas, and calculation steps.
4. Choose a card type for each card:
   - definition: a term and its meaning
   - concept: why/how something works
   - formula: the formula with each symbol explained
   - calculation: a worked numeric question that the notes support, with the answer and key steps
   - compare: compare/contrast two related ideas
5. When the notes contain a formula relevant to a card, include it on the back in plain-text notation (e.g. V0 = D1 / (r − g)).
6. Tag each card's "topic" with exactly one of the study context's topic areas. If none fit, use the closest one; if the context has no topic areas, use a short section name from the notes.
7. difficulty: 1 = recall, 2 = understanding, 3 = application/multi-step.
8. "source": copy a short verbatim excerpt (at most ~25 words) from the notes that supports the card.
9. Keep fronts concise (a term or a single question). Keep backs focused: usually 1–3 sentences or a formula with symbol definitions.
10. Do not duplicate cards listed under existing_cards, and do not produce two cards that test the same fact.
11. When the notes are images (lecture slides or screenshots), read the visible text, formulas, tables and diagrams; ignore UI chrome, slide numbers and footers; use only what is visible; and start "source" with the image label, e.g. "Slide image 3: …".
12. Return only the JSON object described by the output schema.`;

export const CONTEXT_SYSTEM_PROMPT = `You identify what a student is studying so flashcards can be tailored to it.
Given any of: an exam or course name, a syllabus/curriculum outline, and a sample of the student's notes, return the study context:
- name: the specific exam or course (e.g. "CFA Level II", "MCAT", "AWS Solutions Architect – Associate", "Organic Chemistry 201"). If the user gave a name, keep it (you may normalize spelling). If you cannot tell, return an empty string.
- domain: the subject domain.
- level: level/difficulty (e.g. "Professional certification, advanced").
- topicAreas: the official topic areas. Prefer the syllabus's own section names when a syllabus is given; otherwise use your knowledge of the exam's published topic areas; otherwise derive 3–10 areas from the notes.
- conventions: terminology and notation conventions specific to this exam/course that flashcards should follow (1–3 sentences).
- confidence: 0–1, how sure you are about the name (1 if the user stated it).`;

export function describeContext(ctx: StudyContext): string {
  const lines = [
    `name: ${ctx.name || "(unknown)"}`,
    `domain: ${ctx.domain || "(unknown)"}`,
    `level: ${ctx.level || "(unknown)"}`,
    `topic_areas: ${ctx.topicAreas.length ? ctx.topicAreas.join("; ") : "(none — derive short section names from the notes)"}`,
    `conventions: ${ctx.conventions || "(none specified)"}`,
  ];
  return lines.join("\n");
}

export function countInstruction(target: number | null): string {
  if (target === null) {
    return "Write as many cards as the notes genuinely support: roughly one per distinct testable fact, formula, or distinction (typically 8–40 for this amount of text). Do not pad.";
  }
  return `Write about ${target} cards. If the notes cannot support that many without padding or inventing facts, write fewer.`;
}

export interface CardsPromptInput {
  context: StudyContext;
  /** Text of this chunk of notes (ignored when pdfBase64 is given). */
  notesText: string;
  /** If set, the notes are sent as a native PDF document block instead of text. */
  pdfBase64?: string;
  /** If set, the notes are these slide images (sent as base64 image blocks before the instruction). */
  images?: SlideImage[];
  notesLabel: string;
  chunkIndex: number;
  chunkCount: number;
  target: number | null;
  existingFronts: string[];
}

function escapeXml(s: string): string {
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build the user-message content blocks for one generation request. */
export function buildCardsUserContent(input: CardsPromptInput): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const hasImages = Boolean(input.images?.length);
  if (hasImages) blocks.push(...buildImageBlocks(input.images!));
  if (input.pdfBase64) {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 },
      title: input.notesLabel,
    });
  }
  const existing = input.existingFronts.length
    ? input.existingFronts.slice(0, 400).map((f) => `- ${escapeXml(f)}`).join("\n")
    : "(none)";
  const part = input.chunkCount > 1 ? ` This is part ${input.chunkIndex + 1} of ${input.chunkCount} of the notes; only cover this part.` : "";
  const notes = hasImages
    ? `The notes are the ${input.images!.length} slide image${input.images!.length === 1 ? "" : "s"} above (${input.images!.map((i) => i.label).join(", ")}).\n${IMAGE_INSTRUCTIONS}`
    : input.pdfBase64
    ? `The notes are the attached PDF document "${escapeXml(input.notesLabel)}".`
    : `<notes source="${escapeXml(input.notesLabel)}">\n${input.notesText}\n</notes>`;

  blocks.push({
    type: "text",
    text: `<study_context>\n${describeContext(input.context)}\n</study_context>

<existing_cards>
${existing}
</existing_cards>

${notes}

Create flashcards from these notes for a student preparing for ${input.context.name || "this subject"}.${part}
${countInstruction(input.target)}`,
  });
  return blocks;
}

export interface ContextPromptInput {
  examName?: string;
  syllabusText?: string;
  syllabusPdfBase64?: string;
  notesText?: string;
  /** Slide images from the notes and/or syllabus (a sample is sent). */
  images?: SlideImage[];
}

/** At most this many images are sent for context detection. */
export const CONTEXT_MAX_IMAGES = 6;

/** Sample of notes for context detection: the opening plus every heading, so the whole document is represented. */
export function notesSampleForContext(notes: string, maxChars = 24_000): string {
  if (notes.length <= maxChars) return notes;
  const headings = notes
    .split("\n")
    .filter((l) => /^#{1,6}\s/.test(l.trim()))
    .slice(0, 200)
    .join("\n");
  const head = notes.slice(0, Math.max(4000, maxChars - headings.length));
  return `${head}\n\n[... notes continue; headings from the full notes follow ...]\n${headings}`;
}

export function buildContextUserContent(input: ContextPromptInput): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const images = (input.images ?? []).slice(0, CONTEXT_MAX_IMAGES);
  if (images.length) blocks.push(...buildImageBlocks(images));
  if (input.syllabusPdfBase64) {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.syllabusPdfBase64 },
      title: "Syllabus",
    });
  }
  const parts: string[] = [];
  parts.push(`<exam_or_course_name>${input.examName?.trim() ? escapeXml(input.examName.trim()) : "(not provided)"}</exam_or_course_name>`);
  if (input.syllabusPdfBase64) parts.push("The syllabus is the attached PDF document.");
  else if (input.syllabusText?.trim()) parts.push(`<syllabus>\n${input.syllabusText.trim()}\n</syllabus>`);
  else parts.push("<syllabus>(not provided)</syllabus>");
  if (input.notesText?.trim()) parts.push(`<notes_sample>\n${notesSampleForContext(input.notesText.trim())}\n</notes_sample>`);
  if (images.length) {
    parts.push(
      `The ${images.length} image${images.length === 1 ? "" : "s"} above ${images.length === 1 ? "is a lecture slide or screenshot" : "are lecture slides or screenshots"} from the student's materials. Read their visible text, titles, formulas and logos/branding (ignore UI chrome) when identifying the exam or course.`,
    );
  }
  parts.push("Determine the study context.");
  blocks.push({ type: "text", text: parts.join("\n\n") });
  return blocks;
}

/** Whether a PDF's extracted text is small enough to send as one native document block. */
export function pdfFitsOneChunk(extractedText: string, maxTokens: number): boolean {
  return estimateTokens(extractedText) <= maxTokens;
}

export function targetFor(count: CardCount): number | null {
  return count === "auto" ? null : count;
}
