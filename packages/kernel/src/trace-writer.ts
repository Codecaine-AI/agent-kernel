/**
 * Default kernel trace writer — a TraceWriterSink that inserts protocol
 * events straight into the kernel's local SQLite trace db (idempotent by
 * event_id). Writes are serialized behind an internal tail so the sync
 * `submit()` contract holds; read paths call `flush()` before serving.
 */
import {
	insertTraceEventsBatch,
	upsertPromotableTraceEvent,
	type KernelDatabase,
} from "@agent-kernel/db";
import type { TraceEvent } from "@agent-kernel/protocol";

import type { TraceWriterSink } from "./subagents/types";

export interface TraceWriterLoggerLike {
	error(message: string, data?: Record<string, unknown>): void;
}

export interface KernelTraceWriter extends TraceWriterSink {
	/** Await all queued trace-event inserts (read paths flush before serving). */
	flush(): Promise<void>;
}

export function createDbTraceWriter(
	db: KernelDatabase,
	logger?: TraceWriterLoggerLike,
): KernelTraceWriter {
	let tail: Promise<void> = Promise.resolve();

	// Both write kinds share one tail, so a promotable end never overtakes
	// the start it pairs with.
	function enqueue(event: TraceEvent, write: () => Promise<unknown>): void {
		tail = tail
			.then(async () => {
				await write();
			})
			.catch((error) => {
				logger?.error("kernel trace write failed", {
					error: error instanceof Error ? error.message : String(error),
					eventId: event.eventId,
					type: event.type,
				});
			});
	}

	return {
		submit(event: TraceEvent): void {
			enqueue(event, () => insertTraceEventsBatch(db, [event]));
		},
		submitPromotable(event: TraceEvent): void {
			enqueue(event, () => upsertPromotableTraceEvent(db, event));
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
