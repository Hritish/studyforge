import { z } from "zod";
import { isValidFileKey } from "./files/common";
import { CARD_TYPES } from "./types";

const FileKeyZ = z.string().refine(isValidFileKey, "is not a valid file reference");

export const ContextZ = z.object({
  name: z.string().max(200).default(""),
  domain: z.string().max(300).default(""),
  level: z.string().max(300).default(""),
  topicAreas: z.array(z.string().max(120)).max(40).default([]),
  conventions: z.string().max(2000).default(""),
  source: z.enum(["user", "syllabus", "inferred", "none"]).default("user"),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * A note as sent by the browser. File bytes are never inlined: PDFs and images
 * are referenced by `fileId` (a file-store key) and fetched by the server.
 * Unknown keys (e.g. a legacy `pdfBase64`) are stripped.
 */
export const NoteZ = z.object({
  name: z.string().max(300),
  kind: z.enum(["paste", "txt", "md", "pdf", "docx", "image"]),
  text: z.string().max(3_000_000),
  fileId: FileKeyZ.optional(),
  mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]).optional(),
});

/** Notes as stored in the DB (text only). */
const SavedNoteZ = NoteZ.omit({ fileId: true, mediaType: true });

/** Store keys to delete once the set is saved. */
const FilesToDeleteZ = z.array(FileKeyZ).max(200).default([]);

export const CardDraftZ = z.object({
  front: z.string().trim().min(1).max(1000),
  back: z.string().trim().min(1).max(4000),
  type: z.enum(CARD_TYPES).default("definition"),
  topic: z.string().max(200).default("General"),
  difficulty: z.number().int().min(1).max(3).default(2),
  source: z.string().max(1000).default(""),
});

export const GenerateZ = z.object({
  context: ContextZ,
  notes: z.array(NoteZ).min(1).max(100),
  count: z.union([z.literal("auto"), z.literal(10), z.literal(25), z.literal(50)]).default("auto"),
  setId: z.string().optional(),
});

export const DetectContextZ = z.object({
  examName: z.string().max(200).optional(),
  syllabus: NoteZ.optional(),
  notesText: z.string().optional(),
  /** File reference of the first notes PDF; its first pages are read for context. */
  notesPdf: FileKeyZ.optional(),
  /** Slide images from notes (a sample is used). */
  images: z.array(NoteZ).max(20).optional(),
});

export const CreateSetZ = z.object({
  title: z.string().trim().max(200).optional(),
  context: ContextZ,
  contextConfirmed: z.boolean().default(true),
  cards: z.array(CardDraftZ).max(1000),
  notes: z.array(SavedNoteZ).max(100).default([]),
  files: FilesToDeleteZ,
});

export const AddCardsZ = z.object({
  cards: z.array(CardDraftZ).max(1000),
  notes: z.array(SavedNoteZ).max(100).default([]),
  files: FilesToDeleteZ,
});

export const IngestZ = z.object({ key: FileKeyZ, name: z.string().min(1).max(300) });
export const DeleteFilesZ = z.object({ keys: z.array(FileKeyZ).max(200) });

export const PatchSetZ = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  context: ContextZ.optional(),
  bestMatchMs: z.number().int().positive().optional(),
});

export const PatchCardZ = CardDraftZ.partial().extend({
  status: z.enum(["new", "learning", "known"]).optional(),
});

export const ProgressZ = z.object({
  results: z
    .array(z.object({ cardId: z.string(), result: z.enum(["known", "learning", "correct", "incorrect"]) }))
    .max(500),
});
