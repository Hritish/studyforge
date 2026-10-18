/**
 * File store behind one interface:
 *  - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (hosted),
 *  - a local directory (default `.uploads/`, git-ignored) otherwise (dev).
 * Keys always look like `uploads/<id>/<name>` (see isValidFileKey).
 */
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidFileKey, UPLOAD_PREFIX, UPLOAD_TTL_MS, type UploadConfig } from "./common";

export interface FileStore {
  mode: "blob" | "local";
  /** Store bytes. Returns the final key (Blob may add a random suffix). */
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  /** Bytes for a key, or null if it doesn't exist (e.g. expired). */
  get(key: string): Promise<Buffer | null>;
  /** Best-effort delete; invalid keys are ignored. */
  del(keys: string[]): Promise<void>;
  /** Delete uploads older than `maxAgeMs`. Returns how many were deleted. */
  sweep(maxAgeMs?: number, now?: number): Promise<number>;
}

function assertKey(key: string): void {
  if (!isValidFileKey(key)) throw new Error("Invalid file reference.");
}

export function createLocalStore(dir: string): FileStore {
  const root = path.resolve(dir);
  const full = (key: string) => {
    assertKey(key);
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error("Invalid file reference.");
    return p;
  };
  return {
    mode: "local",
    async put(key, data) {
      const p = full(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data);
      return key;
    },
    async get(key) {
      try {
        return await readFile(full(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async del(keys) {
      for (const key of keys.filter(isValidFileKey)) {
        const p = full(key);
        await rm(p, { force: true }).catch(() => undefined);
        await rmdir(path.dirname(p)).catch(() => undefined); // only succeeds when empty
      }
    },
    async sweep(maxAgeMs = UPLOAD_TTL_MS, now = Date.now()) {
      const base = path.join(root, UPLOAD_PREFIX);
      let removed = 0;
      let dirs: string[];
      try {
        dirs = await readdir(base);
      } catch {
        return 0;
      }
      for (const d of dirs) {
        const dirPath = path.join(base, d);
        let files: string[];
        try {
          files = await readdir(dirPath);
        } catch {
          continue;
        }
        for (const f of files) {
          const p = path.join(dirPath, f);
          const s = await stat(p).catch(() => null);
          if (s && now - s.mtimeMs > maxAgeMs) {
            await rm(p, { force: true }).catch(() => undefined);
            removed++;
          }
        }
        await rmdir(dirPath).catch(() => undefined);
      }
      return removed;
    },
  };
}

export function blobAccess(): "private" | "public" {
  return process.env.BLOB_ACCESS?.trim().toLowerCase() === "public" ? "public" : "private";
}

export function createBlobStore(token: string, access = blobAccess()): FileStore {
  // Loaded lazily so local dev never touches the Blob SDK.
  const sdk = () => import("@vercel/blob");
  return {
    mode: "blob",
    async put(key, data, contentType) {
      assertKey(key);
      const { put } = await sdk();
      const res = await put(key, data, { access, contentType, token, addRandomSuffix: true });
      return res.pathname;
    },
    async get(key) {
      assertKey(key);
      const { get } = await sdk();
      const res = await get(key, { access, token, useCache: false }).catch((e: unknown) => {
        if (e instanceof Error && e.name === "BlobNotFoundError") return null;
        throw e;
      });
      if (!res || res.statusCode !== 200) return null;
      return Buffer.from(await new Response(res.stream).arrayBuffer());
    },
    async del(keys) {
      const valid = keys.filter(isValidFileKey);
      if (!valid.length) return;
      const { del } = await sdk();
      await del(valid, { token }).catch(() => undefined);
    },
    async sweep(maxAgeMs = UPLOAD_TTL_MS, now = Date.now()) {
      const { list, del } = await sdk();
      let cursor: string | undefined;
      let removed = 0;
      do {
        const page = await list({ prefix: UPLOAD_PREFIX, cursor, limit: 1000, token });
        const old = page.blobs.filter((b) => now - new Date(b.uploadedAt).getTime() > maxAgeMs).map((b) => b.url);
        if (old.length) {
          await del(old, { token });
          removed += old.length;
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return removed;
    },
  };
}

export function storageMode(): "blob" | "local" {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() ? "blob" : "local";
}

/** Passed to the create page so the browser knows how to upload. */
export function uploadConfig(): UploadConfig {
  return { mode: storageMode(), access: blobAccess() };
}

let cached: { sig: string; store: FileStore } | undefined;

export function getFileStore(): FileStore {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  const dir = process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), ".uploads");
  const sig = token ? `blob:${blobAccess()}` : `local:${dir}`;
  if (!cached || cached.sig !== sig) cached = { sig, store: token ? createBlobStore(token) : createLocalStore(dir) };
  return cached.store;
}

let lastSweep = 0;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/** Delete expired uploads, at most once every 10 minutes per server instance. Never throws. */
export async function maybeSweep(store = getFileStore(), now = Date.now()): Promise<void> {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  await store.sweep(UPLOAD_TTL_MS, now).catch((e) => console.warn("Upload sweep failed:", e instanceof Error ? e.message : e));
}
