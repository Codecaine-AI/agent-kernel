import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { KernelDatabase } from "../client";
import { traceBlobs } from "../schema/trace-blobs";
import type { NewTraceBlob, TraceBlob } from "../types";

/**
 * Content address for trace blob bytes: "b1-" + sha256hex of the raw bytes.
 * The kernel capture code hashes payloads with this before storing them.
 */
export function hashTraceBlobBytes(bytes: Uint8Array): string {
  return `b1-${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Idempotent multi-row insert keyed by hash. Blobs are content-addressed and
 * immutable, so a conflicting insert is benign — the existing row (including
 * its createdAt) is left untouched. Returns the number of rows actually
 * inserted (0 when every blob already existed).
 */
export async function upsertTraceBlobs(
  db: KernelDatabase,
  blobs: NewTraceBlob[],
): Promise<number> {
  if (blobs.length === 0) return 0;

  const inserted = await db
    .insert(traceBlobs)
    .values(blobs)
    .onConflictDoNothing({ target: traceBlobs.hash })
    .returning({ hash: traceBlobs.hash });
  return inserted.length;
}

export async function getTraceBlob(
  db: KernelDatabase,
  hash: string,
): Promise<TraceBlob | null> {
  const [row] = await db
    .select()
    .from(traceBlobs)
    .where(eq(traceBlobs.hash, hash))
    .limit(1);
  return row ?? null;
}

/** Blob row metadata — everything except the data payload. */
export type TraceBlobMeta = Omit<TraceBlob, "data">;

/**
 * Metadata rows (no data column) for the given hashes, for existence and
 * size checks without pulling payload bytes off disk. Missing hashes are
 * simply absent from the result.
 */
export async function getTraceBlobMetas(
  db: KernelDatabase,
  hashes: string[],
): Promise<TraceBlobMeta[]> {
  if (hashes.length === 0) return [];

  return db
    .select({
      hash: traceBlobs.hash,
      kind: traceBlobs.kind,
      mimeType: traceBlobs.mimeType,
      byteLength: traceBlobs.byteLength,
      createdAt: traceBlobs.createdAt,
    })
    .from(traceBlobs)
    .where(inArray(traceBlobs.hash, hashes));
}
