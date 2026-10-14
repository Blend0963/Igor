/**
 * Files the assistant produced for the chat panel: charts from the code
 * interpreter, generated images. Kept on disk next to the conversation
 * database so a thread still shows them after a restart, and served by
 * `GET /api/media/:id` behind the same auth as the rest of the API.
 *
 * Ids are random UUIDs, the only thing a request can name, so a path can
 * never be built from user input. Only raster images are served inline;
 * anything else (an SVG could carry script) goes out as a download.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Files kept; the oldest go first past this. */
export const MAX_MEDIA_FILES = 500;
/** Largest file kept, in bytes. */
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "text/csv": "csv",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/plain": "txt",
};
const MIME_BY_EXTENSION = Object.fromEntries(Object.entries(EXTENSIONS).map(([m, e]) => [e, m]));
const INLINE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The media type of a file, from what the provider said or its name. */
export function mediaTypeOf(mime: string | undefined, fileName?: string): string {
  const declared = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (EXTENSIONS[declared]) return declared;
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpeg") return "image/jpeg";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export interface StoredMedia {
  data: Buffer;
  mime: string;
  inline: boolean;
}

export class MediaStore {
  private dir: string | undefined;
  private memory = new Map<string, { data: Buffer; mime: string }>();

  /** `dir` undefined keeps files in memory only (tests, in-memory storage). */
  constructor(dir?: string) {
    if (dir) {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        this.dir = dir;
      } catch (error) {
        console.warn(`[media] cannot use ${dir}, keeping files in memory:`, error instanceof Error ? error.message : error);
      }
    }
  }

  /** Stores a file and returns its id, or undefined when it is too large. */
  save(data: Buffer, mime: string, fileName?: string): string | undefined {
    if (data.length === 0 || data.length > MAX_MEDIA_BYTES) return undefined;
    const type = mediaTypeOf(mime, fileName);
    const ext = EXTENSIONS[type] ?? "bin";
    const id = randomUUID();
    if (this.dir) {
      writeFileSync(path.join(this.dir, `${id}.${ext}`), data, { mode: 0o600 });
      this.prune();
    } else {
      this.memory.set(id, { data, mime: type });
      while (this.memory.size > MAX_MEDIA_FILES) {
        const oldest = this.memory.keys().next().value;
        if (oldest === undefined) break;
        this.memory.delete(oldest);
      }
    }
    return id;
  }

  get(id: string): StoredMedia | undefined {
    if (!ID_PATTERN.test(id)) return undefined;
    if (!this.dir) {
      const hit = this.memory.get(id);
      return hit ? { ...hit, inline: INLINE.has(hit.mime) } : undefined;
    }
    const name = readdirSync(this.dir).find((f) => f.startsWith(`${id}.`));
    if (!name) return undefined;
    const ext = name.slice(id.length + 1);
    const mime = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
    return { data: readFileSync(path.join(this.dir, name)), mime, inline: INLINE.has(mime) };
  }

  private prune(): void {
    if (!this.dir || !existsSync(this.dir)) return;
    const files = readdirSync(this.dir)
      .map((name) => {
        const full = path.join(this.dir!, name);
        return { full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    for (const file of files.slice(0, Math.max(0, files.length - MAX_MEDIA_FILES))) {
      try {
        unlinkSync(file.full);
      } catch {
        // already gone
      }
    }
  }
}

let shared = new MediaStore();

/** Called once at startup with the directory the files live in. */
export function configureMediaStore(dir?: string): MediaStore {
  shared = new MediaStore(dir);
  return shared;
}

export function getMediaStore(): MediaStore {
  return shared;
}

/** The panel-relative link to a stored file. */
export function mediaLink(id: string): string {
  return `api/media/${id}`;
}
