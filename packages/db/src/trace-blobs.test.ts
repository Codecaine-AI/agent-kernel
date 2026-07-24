import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getTraceBlob,
  getTraceBlobMetas,
  hashTraceBlobBytes,
  upsertTraceBlobs,
} from "./actions";
import { ensureKernelObservabilitySchema } from "./bootstrap";
import {
  kernelDatabasePath,
  openKernelDatabase,
  type KernelDatabaseHandle,
} from "./client";
import type { NewTraceBlob } from "./types";

let dir: string;
let handle: KernelDatabaseHandle;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "agent-kernel-blob-test-"));
  handle = openKernelDatabase({ path: kernelDatabasePath(dir) });
  await ensureKernelObservabilitySchema(handle.db);
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeBlob(bytes: Uint8Array, kind: string, mimeType: string): NewTraceBlob {
  return {
    hash: hashTraceBlobBytes(bytes),
    kind,
    mimeType,
    byteLength: bytes.byteLength,
    data: Buffer.from(bytes),
    createdAt: new Date().toISOString(),
  };
}

describe("hashTraceBlobBytes", () => {
  test('produces "b1-<sha256hex>" of the raw bytes', () => {
    const hash = hashTraceBlobBytes(new TextEncoder().encode("hello"));
    // sha256("hello")
    expect(hash).toBe(
      "b1-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(hash).toMatch(/^b1-[0-9a-f]{64}$/);
  });

  test("identical bytes hash identically, different bytes differ", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([1, 2, 4]);
    expect(hashTraceBlobBytes(a)).toBe(hashTraceBlobBytes(b));
    expect(hashTraceBlobBytes(a)).not.toBe(hashTraceBlobBytes(c));
  });
});

describe("trace blob round-trip", () => {
  test("bytes survive upsert and get", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x7f]);
    const blob = makeBlob(bytes, "image", "image/png");

    const inserted = await upsertTraceBlobs(handle.db, [blob]);
    expect(inserted).toBe(1);

    const row = await getTraceBlob(handle.db, blob.hash);
    expect(row).not.toBeNull();
    expect(row?.kind).toBe("image");
    expect(row?.mimeType).toBe("image/png");
    expect(row?.byteLength).toBe(bytes.byteLength);
    expect(new Uint8Array(row!.data)).toEqual(bytes);
  });

  test("get returns null for a missing hash", async () => {
    expect(await getTraceBlob(handle.db, "b1-deadbeef")).toBeNull();
  });
});

describe("dedup on double insert", () => {
  test("re-inserting the same hash is a no-op", async () => {
    const bytes = new TextEncoder().encode('{"role":"user"}');
    const blob = makeBlob(bytes, "message", "application/json");

    expect(await upsertTraceBlobs(handle.db, [blob])).toBe(1);
    expect(await upsertTraceBlobs(handle.db, [blob])).toBe(0);

    const metas = await getTraceBlobMetas(handle.db, [blob.hash]);
    expect(metas).toHaveLength(1);
  });

  test("mixed batch inserts only the new rows", async () => {
    const existing = makeBlob(new Uint8Array([1]), "text", "text/plain");
    const fresh = makeBlob(new Uint8Array([2]), "text", "text/plain");

    expect(await upsertTraceBlobs(handle.db, [existing])).toBe(1);
    expect(await upsertTraceBlobs(handle.db, [existing, fresh])).toBe(1);
    expect(await upsertTraceBlobs(handle.db, [])).toBe(0);
  });
});

describe("getTraceBlobMetas", () => {
  test("returns metadata without the data column, skipping unknown hashes", async () => {
    const a = makeBlob(new TextEncoder().encode("system prompt"), "text", "text/plain");
    const b = makeBlob(new Uint8Array([9, 9, 9]), "image", "image/jpeg");
    await upsertTraceBlobs(handle.db, [a, b]);

    const metas = await getTraceBlobMetas(handle.db, [a.hash, b.hash, "b1-missing"]);
    expect(metas).toHaveLength(2);

    const byHash = new Map(metas.map((m) => [m.hash, m]));
    expect(byHash.get(a.hash)?.kind).toBe("text");
    expect(byHash.get(a.hash)?.byteLength).toBe(13);
    expect(byHash.get(b.hash)?.mimeType).toBe("image/jpeg");
    for (const meta of metas) {
      expect("data" in meta).toBe(false);
    }
  });
});
