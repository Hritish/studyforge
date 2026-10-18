export const CARD_TYPES = [
  "definition",
  "concept",
  "formula",
  "calculation",
  "compare",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  definition: "Definition",
  concept: "Concept",
  formula: "Formula",
  calculation: "Calculation",
  compare: "Compare / contrast",
};

/** What the student is studying. Saved on each set and injected into every generation prompt. */
export interface StudyContext {
  /** Exam or course name, e.g. "CFA Level II". Empty when unknown. */
  name: string;
  /** Subject domain, e.g. "Finance / investment analysis". */
  domain: string;
  /** Level / difficulty, e.g. "Professional certification, intermediate–advanced". */
  level: string;
  /** Syllabus topic areas cards get tagged with. */
  topicAreas: string[];
  /** Terminology and notation conventions to follow. */
  conventions: string;
  /** Where the context came from. */
  source: "user" | "syllabus" | "inferred" | "none";
  /** 0..1 confidence when inferred. */
  confidence?: number;
}

export const EMPTY_CONTEXT: StudyContext = {
  name: "",
  domain: "",
  level: "",
  topicAreas: [],
  conventions: "",
  source: "none",
};

/** A card before it is saved. */
export interface CardDraft {
  front: string;
  back: string;
  type: CardType;
  topic: string;
  difficulty: 1 | 2 | 3;
  source: string;
}

/** A piece of notes text (pasted or extracted from a file). */
export interface NoteInput {
  name: string;
  kind: "paste" | "txt" | "md" | "pdf" | "docx";
  text: string;
  /** Base64 of the original PDF, so the Claude path can use native PDF input. */
  pdfBase64?: string;
}

export type CardCount = "auto" | 10 | 25 | 50;

export type GenerationEvent =
  | { type: "start"; mode: "demo" | "claude"; chunks: number; model?: string }
  | { type: "progress"; chunk: number; chunks: number; message: string }
  | { type: "cards"; chunk: number; cards: CardDraft[] }
  | { type: "warning"; message: string }
  | { type: "done"; cards: CardDraft[]; removedDuplicates: number }
  | { type: "error"; message: string };

/** A saved card as sent to client components. */
export interface ClientCard {
  id: string;
  front: string;
  back: string;
  type: string;
  topic: string;
  difficulty: number;
  source: string;
  mastery: number;
  status: string;
  correctCount: number;
  incorrectCount: number;
}
