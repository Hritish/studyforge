import { after, NextResponse } from "next/server";
import { IngestZ } from "@/lib/api-schemas";
import { unauthorized } from "@/lib/auth/session";
import { ingestStoredFile } from "@/lib/files/ingest";
import { getFileStore, maybeSweep } from "@/lib/files/store";
import { parseBody } from "@/lib/http";

export const maxDuration = 60;

/**
 * Extract a file that is already in the store (hosted mode: uploaded by the
 * browser straight to Vercel Blob). Returns text + metadata and a reference;
 * images are downscaled with sharp and the original replaced.
 */
export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const body = await parseBody(req, IngestZ);
  if ("error" in body) return body.error;
  const store = getFileStore();
  after(() => maybeSweep(store));
  try {
    const { file, warning } = await ingestStoredFile(store, body.data.key, body.data.name);
    return NextResponse.json({ file, errors: warning ? [warning] : [] });
  } catch (e) {
    return NextResponse.json({ error: `${body.data.name}: ${e instanceof Error ? e.message : "failed to read file."}` }, { status: 422 });
  }
}
