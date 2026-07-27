/**
 * store.test.ts — state.json through the sink seam: path layout, serialized
 * tail, and the JSON round-trip that enforces JSON-serializable state.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	STATE_DIR_RELATIVE_PATH,
	createFileStateSink,
	createMemoryStateSink,
	readStateSnapshot,
	resolveStateSink,
	stateFilePath,
} from "./store";
import type { StateSnapshot } from "./types";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "agent-kernel-store-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function snapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
	return {
		containerId: "container-1",
		agentName: "layout-editor",
		version: 1,
		updatedAt: "2026-07-27T00:00:00.000Z",
		state: { boardId: "b1", ops: ["move", "connect"], lints: { errors: 0 } },
		...overrides,
	};
}

describe("state store — path layout", () => {
	test("snapshots land under .agent-kernel/state/<container>/<agent>/state.json", () => {
		expect(stateFilePath(root, "container-1", "layout-editor")).toBe(
			join(root, ...STATE_DIR_RELATIVE_PATH.split("/"), "container-1", "layout-editor", "state.json"),
		);
	});

	test("path segments are sanitized so an id cannot escape the tree", () => {
		const path = stateFilePath(root, "../../etc", "a/b");
		const base = join(root, ".agent-kernel", "state");
		expect(path.startsWith(base)).toBe(true);
		// Traversal survives only as inert characters inside one segment.
		expect(resolve(path).startsWith(resolve(base))).toBe(true);
		expect(path.slice(base.length).split(sep)).toEqual([
			"",
			".._.._etc",
			"a_b",
			"state.json",
		]);
	});
});

describe("state store — file sink", () => {
	test("writes the snapshot and round-trips it through JSON", async () => {
		const sink = createFileStateSink({ root });
		const written = snapshot({ runId: "run-1" });
		sink.submit(written);
		await sink.flush();

		const path = stateFilePath(root, "container-1", "layout-editor");
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
		expect(readStateSnapshot(root, "container-1", "layout-editor")).toEqual(
			written,
		);
	});

	test("later versions overwrite earlier ones in submit order", async () => {
		const sink = createFileStateSink({ root });
		sink.submit(snapshot({ version: 1, state: { ops: [] } }));
		sink.submit(snapshot({ version: 2, state: { ops: ["move"] } }));
		sink.submit(snapshot({ version: 3, state: { ops: ["move", "connect"] } }));
		await sink.flush();

		const read = readStateSnapshot(root, "container-1", "layout-editor");
		expect(read?.version).toBe(3);
		expect(read?.state).toEqual({ ops: ["move", "connect"] });
	});

	test("state is serialized at submit time, so later mutation cannot leak in", async () => {
		const sink = createFileStateSink({ root });
		const mutable = { ops: ["move"] };
		sink.submit(snapshot({ state: mutable }));
		mutable.ops.push("connect");
		await sink.flush();

		expect(
			(readStateSnapshot(root, "container-1", "layout-editor")?.state as {
				ops: string[];
			}).ops,
		).toEqual(["move"]);
	});

	test("a missing snapshot reads back as null", () => {
		expect(readStateSnapshot(root, "nope", "nobody")).toBeNull();
	});

	test("a serialize failure is logged, never thrown", async () => {
		const errors: string[] = [];
		const sink = createFileStateSink({
			root,
			logger: { error: (message) => errors.push(message) },
		});
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => sink.submit(snapshot({ state: cyclic }))).not.toThrow();
		await sink.flush();
		expect(errors).toEqual(["agent state serialize failed"]);
		expect(existsSync(stateFilePath(root, "container-1", "layout-editor"))).toBe(
			false,
		);
	});
});

describe("state store — resolveStateSink (D88: persistence default-ON)", () => {
	test("no sink and no root still persists, rooted at the spawn cwd", async () => {
		const sink = resolveStateSink({ cwd: root });
		sink.submit(snapshot());
		await sink.flush();
		expect(
			readStateSnapshot(root, "container-1", "layout-editor")?.version,
		).toBe(1);
	});

	test("an explicit root wins over the cwd", async () => {
		const elsewhere = mkdtempSync(join(tmpdir(), "agent-kernel-store-root-"));
		try {
			const sink = resolveStateSink({ root: elsewhere, cwd: root });
			sink.submit(snapshot());
			await sink.flush();
			expect(
				readStateSnapshot(elsewhere, "container-1", "layout-editor"),
			).not.toBeNull();
			expect(readStateSnapshot(root, "container-1", "layout-editor")).toBeNull();
		} finally {
			rmSync(elsewhere, { recursive: true, force: true });
		}
	});

	test("an explicit sink wins over both, and nothing touches the disk", async () => {
		const memory = createMemoryStateSink();
		const sink = resolveStateSink({ sink: memory, root, cwd: root });
		expect(sink).toBe(memory);
		sink.submit(snapshot());
		await sink.flush();
		expect(memory.snapshots).toHaveLength(1);
		expect(existsSync(stateFilePath(root, "container-1", "layout-editor"))).toBe(
			false,
		);
	});
});

describe("state store — memory sink", () => {
	test("captures deep copies so tests see the state as of submit", async () => {
		const sink = createMemoryStateSink();
		const mutable = { ops: ["move"] };
		sink.submit(snapshot({ state: mutable }));
		mutable.ops.push("connect");
		await sink.flush();
		expect((sink.snapshots[0].state as { ops: string[] }).ops).toEqual(["move"]);
	});
});
