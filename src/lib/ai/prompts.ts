/**
 * Prompt building for context detection and card generation. Pure functions so
 * they can be unit-tested without the network.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { CardCount, StudyContext } from "../types";
import { buildImageBlocks, IMAGE_INSTRUCTIONS, type SlideImage } from "./images";

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

/** Stable system prompt (kept byte-identical across requests so it caches). */
export const CARDS_SYSTEM_PROMPT = `You are StudyForge, a friendly expert tutor who turns a student's rough notes into simple, easy-to-learn flashcards for their exam.

How to use the notes:
- The student's notes are often messy, incomplete, shorthand, or partly wrong. Treat them as a guide to WHAT the student is studying (which topics and concepts) and what their lecturer emphasized, not as the only source of facts.
- Use your own accurate knowledge of the subject and of the exam in the study context to explain each concept correctly and clearly. Fill in missing steps, definitions, and symbol meanings.
- If the notes are wrong or garbled, write the correct version. Never copy an error onto a card.
- Stay on the topics the notes cover. You may add a closely related core concept the exam expects for that topic (for example, a definition the notes use but never explain), but do not drift into topics the notes don't touch.
- Notes the student flagged (e.g. "exam", "memorize", "prof said", "!!", underlines) deserve cards.

How to write the cards:
1. Make them easy to learn. Use plain, everyday language and short sentences, the way a good tutor would explain it out loud. Avoid jargon unless it's the exam's own term, and if so explain it simply.
2. One idea per card. Split anything complicated into several small cards rather than one dense card.
3. Front: a short term or one clear question (ideally under 12 words).
4. Back: the simplest correct answer, usually 1–2 short sentences (about 30 words at most). When a formula matters, give it in plain-text notation (e.g. V0 = D1 / (r − g)), then say in plain words what each symbol means. A short memory hook or intuition ("think of it as…") is welcome when it genuinely helps.
5. Use the study context's official terminology and notation, so the cards match how the exam asks questions.
6. Choose a card type for each card:
   - definition: a term and its meaning
   - concept: why/how something works, explained simply
   - formula: the formula with each symbol explained
   - calculation: a small worked example with easy numbers, the answer, and the key steps
   - compare: how two easily confused ideas differ
7. Tag each card's "topic" with exactly one of the study context's topic areas. If none fit, use the closest one; if the context has no topic areas, use a short section name from the notes.
8. difficulty: 1 = recall, 2 = understanding, 3 = application/multi-step. Most cards should be 1 or 2.
9. "source": where in the notes this card's topic comes from, as a short excerpt of the notes (at most ~15 words), prefixed with the page or image label when there is one, e.g. "p. 4: forward rates = breakeven…". This shows the student which part of their notes the card covers; the card itself does not have to repeat the notes' wording.
10. Do not duplicate cards listed under existing_cards, and do not produce two cards that test the same fact.
11. When the notes are images or PDF pages (lecture slides or screenshots, often with the student's handwritten or typed notes beneath), read the slide text, formulas, tables, diagrams and the student's notes. Ignore UI chrome, slide numbers and footers.
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
    return "Write one simple card per important concept, formula, or distinction in the topics these notes cover (typically 8–40 for this amount of material). Do not pad with trivia.";
  }
  return `Write about ${target} cards. Stay on the topics these notes cover; if they can't support that many useful cards without trivia, write fewer.`;
}

export interface CardsPromptInput {
  context: StudyContext;
  /** Text of this chunk of notes (ignored when pdfBase64 is given). */
  notesText: string;
  /** If set, the notes are sent as a native PDF document block instead of text. */
  pdfBase64?: string;
  /** Page range of the original PDF that `pdfBase64` covers. */
  pdfPages?: { from: number; to: number; total: number };
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
    ? pdfNotesInstruction(input.notesLabel, input.pdfPages)
    : `<notes source="${escapeXml(input.notesLabel)}">\n${input.notesText}\n</notes>`;

  blocks.push({
    type: "text",
    text: `<study_context>\n${describeContext(input.context)}\n</study_context>

<existing_cards>
${existing}
</existing_cards>

${notes}

Create simple, easy-to-learn flashcards on the topics in these notes for a student preparing for ${input.context.name || "this subject"}. Use the notes to decide what to cover; use your own knowledge to make each card correct and clear.${part}
${countInstruction(input.target)}`,
  });
  return blocks;
}

export interface ContextPromptInput {
  examName?: string;
  syllabusText?: string;
  syllabusPdfBase64?: string;
  notesText?: string;
  /** First pages of a notes PDF (read as images, so scanned slides work). */
  notesPdfBase64?: string;
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
  if (input.notesPdfBase64) {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.notesPdfBase64 },
      title: "Notes (first pages)",
    });
  }
  const parts: string[] = [];
  parts.push(`<exam_or_course_name>${input.examName?.trim() ? escapeXml(input.examName.trim()) : "(not provided)"}</exam_or_course_name>`);
  if (input.syllabusPdfBase64) parts.push("The syllabus is the attached PDF document.");
  else if (input.syllabusText?.trim()) parts.push(`<syllabus>\n${input.syllabusText.trim()}\n</syllabus>`);
  else parts.push("<syllabus>(not provided)</syllabus>");
  if (input.notesText?.trim()) parts.push(`<notes_sample>\n${notesSampleForContext(input.notesText.trim())}\n</notes_sample>`);
  if (input.notesPdfBase64) {
    parts.push(
      `The attached "Notes (first pages)" document is the opening pages of the student's notes PDF, often lecture slide screenshots with handwritten or typed notes beneath. Read the slide titles, text, formulas and logos/branding when identifying the exam or course.`,
    );
  }
  if (images.length) {
    parts.push(
      `The ${images.length} image${images.length === 1 ? "" : "s"} above ${images.length === 1 ? "is a lecture slide or screenshot" : "are lecture slides or screenshots"} from the student's materials. Read their visible text, titles, formulas and logos/branding (ignore UI chrome) when identifying the exam or course.`,
    );
  }
  parts.push("Determine the study context.");
  blocks.push({ type: "text", text: parts.join("\n\n") });
  return blocks;
}

/** Instruction for notes sent as a native PDF: pages are often slide screenshots with the student's notes beneath. */
export function pdfNotesInstruction(label: string, pages?: { from: number; to: number; total: number }): string {
  const range =
    pages && (pages.from > 1 || pages.to < pages.total)
      ? ` It contains pages ${pages.from}–${pages.to} of a ${pages.total}-page file: page 1 of the attachment is page ${pages.from} of the original. Use original page numbers.`
      : "";
  return `The notes are the attached PDF document "${escapeXml(label)}".${range}
Its pages are often lecture slides or screenshots of slides, with the student's own handwritten or typed notes beneath or beside them. Read everything on each page: slide text, formulas, tables, diagrams and charts, and the student's notes. The student's notes show what the lecturer emphasized, so make sure those points get cards. Ignore UI chrome (browser bars, app toolbars), slide numbers, footers, logos and watermarks. In each card's "source", give the page followed by a short excerpt, e.g. "p. 4: forward rates = breakeven…".`;
}

export function targetFor(count: CardCount): number | null {
  return count === "auto" ? null : count;
}
