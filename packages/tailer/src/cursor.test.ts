import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CursorStore } from "./cursor";

describe("CursorStore", () => {
  test("normalizes watched files to relative keys and migrates moved absolute snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-kernel-cursors-"));
    const watchDir = join(root, "agent-kernel", ".agent-kernel", "pi-sessions");
    const oldWatchDir = join(root, "pi-agent-kernel", ".agent-kernel", "pi-sessions");
    const snapshotPath = join(root, "tailer-cursors.json");
    const relPath = join(
      "app-session",
      "research-coordinator",
      "2026-06-23T19-04-09.jsonl",
    );

    await writeFile(
      snapshotPath,
      JSON.stringify(
        {
          [join(oldWatchDir, relPath)]: 120,
          [join(watchDir, relPath)]: 90,
        },
        null,
        2,
      ),
    );

    const store = new CursorStore({
      watchDir,
      snapshotPath,
      snapshotIntervalMs: 1000,
    });

    await store.loadSnapshot();

    expect(store.get(join(watchDir, relPath))).toBe(120);
    expect(store.hasFile(join(watchDir, relPath))).toBe(true);
    expect(store.entries()).toEqual([[relPath, 120]]);

    store.set(join(watchDir, relPath), 140);
    await store.saveSnapshot();

    const saved = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<string, number>;
    expect(saved).toEqual({ [relPath]: 140 });
  });
});
