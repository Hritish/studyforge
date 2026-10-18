/**
 * File-reference helpers shared by the browser and the server (no Node APIs).
 *
 * Uploaded files live in a file store (Vercel Blob when BLOB_READ_WRITE_TOKEN
 * is set, otherwise `.uploads/` on local disk). Requests from the browser only
 * carry small references to them (`fileId` = the store key) plus metadata and
 * extracted text, so no request body comes close to Vercel's 4.5 MB limit.
 */
import type { NoteInput } from "../types";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Keep browser → server request bodies under this (Vercel's hard limit is 4.5 MB). */
export const MAX_REQUEST_BYTES = 4_000_000;
/** Stored uploads older than this are deleted by the background sweep. */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_PREFIX = "uploads/";

export type FileKind = Exclude<NoteInput["kind"], "paste">;

/** Supported extensions → the content type used for uploads. */
export const CONTENT_TYPES: Record<string, string> = {
  txt: "text/plain",
  text: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export const ALLOWED_CONTENT_TYPES = [...new Set(Object.values(CONTENT_TYPES))];
export const ACCEPT_ATTR = Object.keys(CONTENT_TYPES)
  .filter((e) => e !== "text")
  .map((e) => `.${e}`)
  .join(",");

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function kindFromName(name: string): FileKind | null {
  const e = ext(name);
  if (e === "txt" || e === "text") return "txt";
  if (e === "md" || e === "markdown") return "md";
  if (e === "pdf") return "pdf";
  if (e === "docx") return "docx";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(e)) return "image";
  return null;
}

export function contentTypeFor(name: string): string | null {
  return CONTENT_TYPES[ext(name)] ?? null;
}

export const UNSUPPORTED_FILE_MESSAGE = "Unsupported file type. Use .txt, .md, .pdf, .docx or an image (.png, .jpg, .webp, .gif).";

/** A safe single path segment derived from a user's file name (keeps the extension). */
export function sanitizeFileName(name: string): string {
  const e = ext(name);
  const base = (e ? name.slice(0, -(e.length + 1)) : name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "file"}${e ? `.${e.replace(/[^a-z0-9]/g, "")}` : ""}`;
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh store key for an upload: `uploads/<random id>/<sanitized name>`. */
export function newUploadKey(name: string, id = randomId()): string {
  return `${UPLOAD_PREFIX}${id}/${sanitizeFileName(name)}`;
}

const FILE_KEY_RE = /^uploads\/[A-Za-z0-9_-]{8,64}\/[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/;

/** Only keys we hand out are accepted (no traversal, no other blobs in the store). */
export function isValidFileKey(key: unknown): key is string {
  return typeof key === "string" && FILE_KEY_RE.test(key) && !key.includes("..");
}

/** A stored, extracted file as returned to the browser. */
export interface FileRef {
  /** Store key of the bytes the server still needs (PDFs and downscaled images); absent for text files. */
  fileId?: string;
  name: string;
  kind: FileKind;
  /** Extracted text ("" for images and scanned PDFs). */
  text: string;
  chars: number;
  mediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  pages?: number;
  width?: number;
  height?: number;
}

/** What the create page needs to know to upload files. */
export interface UploadConfig {
  mode: "blob" | "local";
  /** Blob access level of the store (blob mode only). */
  access: "private" | "public";
}

/** A note as sent from the browser: text plus an optional reference to stored bytes. */
export interface NoteRef {
  name: string;
  kind: NoteInput["kind"];
  text: string;
  fileId?: string;
  mediaType?: FileRef["mediaType"];
}

/** JSON-encode a request body, refusing anything near Vercel's 4.5 MB request limit. */
export function jsonBody(value: unknown): string {
  const body = JSON.stringify(value);
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > MAX_REQUEST_BYTES) {
    throw new Error(`This request is too large to send (${(bytes / 1e6).toFixed(1)} MB of text; the limit is 4 MB). Split your notes into smaller parts.`);
  }
  return body;
}
