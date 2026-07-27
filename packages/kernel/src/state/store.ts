/**
 * store.ts — state.json through the sink seam.
 *
 * v1 persistence is a single snapshot per agent, written after each update
 * batch (turn boundary) under
 *
 *   <root>/.agent-kernel/state/<containerId>/<agentName>/state.json
 *
 * Writes go through a StateSink with the same submit()/flush() contract as
 * TraceWriterSink and the same serialized-tail pattern as trace-writer.ts, so
 * the sandbox stage can drop in a remote sink without touching the extension.
 * `submit` is synchronous and never throws into the agent loop.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { StateLoggerLike, StateSink, StateSnapshot } from "./types";

export const STATE_DIR_RELATIVE_PATH = ".agent-kernel/state";
export const STATE_FILE_NAME = "state.json";

/** Keep one path segment inside its directory (ids are external input). */
function safeSegment(value: string): string {
	const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_");
	return cleaned.length > 0 && cleaned !== "." && cleaned !== ".."
		? cleaned
		: "_";
}

export function stateFilePath(
	root: string,
	containerId: string,
	agentName: string,
): string {
	return join(
		root,
		...STATE_DIR_RELATIVE_PATH.split("/"),
		safeSegment(containerId),
		safeSegment(agentName),
		STATE_FILE_NAME,
	);
}

export interface FileStateSinkOptions {
	/** Filesystem root the `.agent-kernel/state` tree hangs off. */
	root: string;
	logger?: StateLoggerLike;
}

export function createFileStateSink(opts: FileStateSinkOptions): StateSink {
	let tail: Promise<void> = Promise.resolve();

	return {
		submit(snapshot: StateSnapshot): void {
			const path = stateFilePath(
				opts.root,
				snapshot.containerId,
				snapshot.agentName,
			);
			// Serialize eagerly: the caller's state object may keep mutating
			// (agents are free to hand back the same object) while the tail is
			// backed up, and JSON-serializability is enforced from day one.
			let payload: string;
			try {
				payload = `${JSON.stringify(snapshot, null, 2)}\n`;
			} catch (error) {
				opts.logger?.error("agent state serialize failed", {
					error: error instanceof Error ? error.message : String(error),
					agentName: snapshot.agentName,
				});
				return;
			}
			tail = tail
				.then(async () => {
					mkdirSync(dirname(path), { recursive: true });
					writeFileSync(path, payload, "utf8");
				})
				.catch((error) => {
					opts.logger?.error("agent state write failed", {
						error: error instanceof Error ? error.message : String(error),
						path,
					});
				});
		},
		async flush(): Promise<void> {
			let current = tail;
			await current;
			while (current !== tail) {
				current = tail;
				await current;
			}
		},
	};
}

/**
 * Read a previously written snapshot — the explicit `prior` source for
 * `seed(ctx, prior)`. Nothing auto-loads this; a caller opts in.
 */
export function readStateSnapshot(
	root: string,
	containerId: string,
	agentName: string,
): StateSnapshot | null {
	try {
		const raw = readFileSync(stateFilePath(root, containerId, agentName), "utf8");
		return JSON.parse(raw) as StateSnapshot;
	} catch {
		return null;
	}
}

/**
 * The sink a spawn gets when the state extension is active. D88 makes v1
 * persistence default-ON: whenever state is active a `state.json` snapshot is
 * written, so the caller chooses *where*, never *whether*.
 *
 *   explicit sink  → used as-is (a remote sink, a test sink)
 *   explicit root  → file sink at <root>/.agent-kernel/state/…
 *   neither        → file sink at <cwd>/.agent-kernel/state/…
 *
 * Pass-through agents never reach here: no state extension, no sink, no file.
 */
export function resolveStateSink(input: {
	/** An explicitly supplied sink. Wins over everything. */
	sink?: StateSink | null;
	/** Explicit filesystem root for the `.agent-kernel` tree. */
	root?: string;
	/** The spawn's working directory — the default `.agent-kernel` root. */
	cwd: string;
	logger?: StateLoggerLike;
}): StateSink {
	if (input.sink) return input.sink;
	return createFileStateSink({
		root: input.root ?? input.cwd,
		...(input.logger ? { logger: input.logger } : {}),
	});
}

/** In-memory sink for tests and for spawns without a filesystem root. */
export function createMemoryStateSink(): StateSink & {
	snapshots: StateSnapshot[];
} {
	const snapshots: StateSnapshot[] = [];
	return {
		snapshots,
		submit(snapshot: StateSnapshot): void {
			snapshots.push(JSON.parse(JSON.stringify(snapshot)) as StateSnapshot);
		},
		async flush(): Promise<void> {},
	};
}
