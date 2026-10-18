import "server-only";
import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE } from "./ai/images";
import type { ImageMediaType } from "./types";

export interface PreparedImage {
  base64: string;
  mediaType: ImageMediaType;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Downscale an uploaded image so its longest side is ≤ IMAGE_MAX_EDGE (1568px)
 * and re-encode it under IMAGE_MAX_BYTES. Screenshots/slides are re-encoded as
 * JPEG (flattened on white; first frame for GIFs); quality steps down, then
 * dimensions shrink, until the size fits.
 */
export async function prepareImage(buf: Buffer): Promise<PreparedImage> {
  const sharp = (await import("sharp")).default;
  let edge = IMAGE_MAX_EDGE;
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const quality of [85, 75, 65, 55]) {
      const { data, info } = await sharp(buf, { animated: false })
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength <= IMAGE_MAX_BYTES) {
        return { base64: data.toString("base64"), mediaType: "image/jpeg", width: info.width, height: info.height, bytes: data.byteLength };
      }
    }
    edge = Math.round(edge * 0.8);
  }
  throw new Error("Image could not be compressed under the size limit.");
}
