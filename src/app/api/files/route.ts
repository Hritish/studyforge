import { after, NextResponse } from "next/server";
import { DeleteFilesZ } from "@/lib/api-schemas";
import { unauthorized } from "@/lib/auth/session";
import { kindFromName, MAX_UPLOAD_BYTES, newUploadKey, UNSUPPORTED_FILE_MESSAGE, contentTypeFor, type FileRef } from "@/lib/files/common";
import { ingestStoredFile } from "@/lib/files/ingest";
import { getFileStore, maybeSweep, storageMode } from "@/lib/files/store";
import { badRequest, parseBody } from "@/lib/http";

/**
 * Local mode (no BLOB_READ_WRITE_TOKEN): upload files (multipart field
 * "files") into the local file store (.uploads/) and extract them.
 * In hosted mode the browser uploads to Vercel Blob instead (see /api/upload).
 */
export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  if (storageMode() !== "local") return badRequest("Files are uploaded directly to Vercel Blob in this deployment.", 404);
  if (process.env.VERCEL) {
    // Vercel's filesystem is read-only (and requests are capped at 4.5 MB): uploads need Blob.
    return badRequest("File uploads need a Vercel Blob store: add one under Storage so BLOB_READ_WRITE_TOKEN is set, then redeploy. See docs/DEPLOY.md.", 503);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Expected multipart/form-data with one or more 'files'.");
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (files.length === 0) return badRequest("No files uploaded.");
  if (files.length > 60) return badRequest("Upload at most 60 files at once.");

  const store = getFileStore();
  const results: FileRef[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (!kindFromName(f.name)) {
      errors.push(`${f.name}: ${UNSUPPORTED_FILE_MESSAGE}`);
      continue;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      errors.push(`${f.name}: larger than 25 MB.`);
      continue;
    }
    try {
      const key = await store.put(newUploadKey(f.name), Buffer.from(await f.arrayBuffer()), contentTypeFor(f.name) ?? "application/octet-stream");
      const { file, warning } = await ingestStoredFile(store, key, f.name);
      results.push(file);
      if (warning) errors.push(warning);
    } catch (e) {
      errors.push(e instanceof Error ? `${f.name}: ${e.message}` : `${f.name}: failed to read file.`);
    }
  }
  after(() => maybeSweep(store));
  return NextResponse.json({ files: results, errors });
}

/** Best-effort delete of uploads the user removed. */
export async function DELETE(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const body = await parseBody(req, DeleteFilesZ);
  if ("error" in body) return body.error;
  await getFileStore().del(body.data.keys);
  return NextResponse.json({ deleted: body.data.keys.length });
}
