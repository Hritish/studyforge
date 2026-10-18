import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/auth/session";
import { ALLOWED_CONTENT_TYPES, isValidFileKey, kindFromName, MAX_UPLOAD_BYTES, UNSUPPORTED_FILE_MESSAGE } from "@/lib/files/common";
import { storageMode } from "@/lib/files/store";
import { badRequest } from "@/lib/http";

/**
 * Issues Vercel Blob client-upload tokens (hosted mode). The browser then
 * uploads the file straight to Blob, so file bytes never pass through a
 * function and the 4.5 MB request limit doesn't apply.
 *
 * Only the token step is handled: no onUploadCompleted callback is registered,
 * so Vercel Blob never calls this route and it stays behind the password gate.
 */
export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  if (storageMode() !== "blob") return badRequest("Direct uploads need BLOB_READ_WRITE_TOKEN; local uploads go to /api/files.", 404);
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return badRequest("Request body must be JSON.");
  }
  if (body?.type !== "blob.generate-client-token") return badRequest("Unsupported upload event.");
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!isValidFileKey(pathname)) throw new Error("Invalid upload path.");
        if (!kindFromName(pathname)) throw new Error(UNSUPPORTED_FILE_MESSAGE);
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Could not start the upload.");
  }
}
