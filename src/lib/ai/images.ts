/**
 * Pure helpers for sending images (slide screenshots) to Claude's vision:
 * size limits, batching and content-block building. No sharp/network here.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ImageMediaType, NoteInput } from "../types";

/** Longest side after downscaling. */
export const IMAGE_MAX_EDGE = 1568;
/**
 * Max encoded bytes per image. The API's per-image limit is 5 MB; base64 adds
 * ~33%, so 3.75 MB of JPEG keeps the base64 payload at or under ~5 MB.
 */
export const IMAGE_MAX_BYTES = 3_750_000;
/** Images per generation request, and a cap on a batch's total base64 size. */
export const IMAGES_PER_BATCH = 8;
export const BATCH_MAX_BASE64 = 16_000_000;

export interface SlideImage {
  /** Label Claude uses in source excerpts, e.g. "Slide image 3". */
  label: string;
  fileName: string;
  base64: string;
  mediaType: ImageMediaType;
}

/** Number images globally in upload order: "Slide image 1", "Slide image 2", … */
export function toSlideImages(notes: NoteInput[]): SlideImage[] {
  return notes
    .filter((n) => n.kind === "image" && n.imageBase64)
    .map((n, i) => ({ label: `Slide image ${i + 1}`, fileName: n.name, base64: n.imageBase64!, mediaType: n.mediaType ?? "image/jpeg" }));
}

/** Split images into batches of at most `perBatch` images and `maxBase64` total base64 chars. */
export function batchImages(images: SlideImage[], perBatch = IMAGES_PER_BATCH, maxBase64 = BATCH_MAX_BASE64): SlideImage[][] {
  const batches: SlideImage[][] = [];
  let cur: SlideImage[] = [];
  let size = 0;
  for (const img of images) {
    if (cur.length > 0 && (cur.length >= perBatch || size + img.base64.length > maxBase64)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(img);
    size += img.base64.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export function batchLabel(batch: SlideImage[]): string {
  if (batch.length === 1) return batch[0].label;
  const first = batch[0].label.replace("Slide image ", "");
  const last = batch[batch.length - 1].label.replace("Slide image ", "");
  return `Slide images ${first}–${last}`;
}

/** Label text block followed by the base64 image block, for each image. */
export function buildImageBlocks(images: SlideImage[]): Anthropic.Beta.BetaContentBlockParam[] {
  return images.flatMap((img): Anthropic.Beta.BetaContentBlockParam[] => [
    { type: "text", text: `${img.label} (file: ${img.fileName}):` },
    { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } },
  ]);
}

export const IMAGE_INSTRUCTIONS = `The notes above are images: lecture slides or screenshots. Read their text, formulas, tables and diagrams. Ignore UI chrome (browser bars, app toolbars, window controls), slide numbers, footers, logos and watermarks. Ground every card only in what is visible in the images. In each card's "source", name the image it came from followed by a short excerpt, e.g. "Slide image 3: V0 = D1 / (r − g)".`;
