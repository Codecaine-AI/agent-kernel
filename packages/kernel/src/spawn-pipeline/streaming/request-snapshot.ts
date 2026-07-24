/**
 * Per-turn request snapshot recorder — captures the system prompt and session
 * messages selected by pi-coding-agent's convertToLlm contract at each
 * turn_start into the content-addressed trace_blobs store and emits a
 * pi_request_snapshot trace event referencing the blobs (see
 * PiRequestSnapshotData in @agent-kernel/protocol for the sanitized-message
 * contract).
 *
 * Turn-number alignment: the kernel emitter numbers pi_turn_start events with
 * a 0-based turnIndex that resets on agent_start and increments on turn_end.
 * This recorder mirrors that exactly — its counter resets on agent_start and
 * increments per turn_start — so snapshot.turn_number matches the emitter's
 * pi_turn_start turn_number 1:1 (turn events alternate start/end within one
 * agent invocation).
 *
 * Safety contract: `handleEvent` is synchronous and never throws. It captures
 * the session state (system prompt string + a shallow slice of the completed
 * messages — pi messages are immutable once persisted) synchronously, then
 * defers all hashing, blob upserts, and event emission behind an internal
 * serialized promise tail (same pattern as trace-writer). Every failure is
 * caught and logged, never thrown into the agent loop.
 */
import {
	hashTraceBlobBytes,
	upsertTraceBlobs,
	type KernelDatabase,
	type NewTraceBlob,
} from "@agent-kernel/db";
import {
	createPiRequestSnapshotEvent,
	type PiRequestSnapshotData,
	type PiRequestSnapshotMessageRef,
	type TraceEventIds,
} from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../../subagents/types";
import type { KernelAgentSessionEventLike } from "../types";

/** The slice of a live Pi AgentSession the recorder reads. */
export interface RequestSnapshotSessionLike {
	messages: any[];
	systemPrompt?: string;
}

export interface RequestSnapshotLoggerLike {
	error(message: string, data?: Record<string, unknown>): void;
}

export interface RequestSnapshotRecorderOptions {
	db: KernelDatabase;
	traceWriter: TraceWriterSink;
	/**
	 * Envelope identity for the run — the SAME ids object spawn-agent stamps
	 * on the emitter's turn events (containerId, runId, piSessionUuid,
	 * userId?), so snapshots land in the run's trace alongside them.
	 */
	ids: TraceEventIds;
	/** ResolvedAgent prompt hash ("pk1-..."); null when not content-addressed. */
	promptHash?: string | null;
	logger?: RequestSnapshotLoggerLike;
}

export interface RequestSnapshotRecorder {
	/**
	 * Feed one live Pi session event. Snapshots on "turn_start"; resets the
	 * turn counter on "agent_start" (emitter parity). Synchronous, never
	 * throws.
	 */
	handleEvent(
		event: KernelAgentSessionEventLike,
		session: RequestSnapshotSessionLike,
	): void;
	/** Await all queued snapshot work (blob upserts + event submission). */
	flush(): Promise<void>;
}

interface MessageLike {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}

/**
 * Mirrors pi-coding-agent's convertToLlm selection contract, which defines
 * which session messages are forwarded to the model.
 */
function isSentToModel(message: MessageLike): boolean {
	switch (message?.role) {
		case "user":
		case "assistant":
		case "toolResult":
		case "custom":
		case "branchSummary":
		case "compactionSummary":
			return true;
		case "bashExecution":
			return !message.excludeFromContext;
		default:
			return false;
	}
}

interface BlockLike {
	type?: string;
	text?: string;
	thinking?: string;
	data?: string;
	mimeType?: string;
	[key: string]: unknown;
}

interface TurnCapture {
	turnNumber: number;
	systemPrompt: string | null;
	messages: MessageLike[];
}

export function createRequestSnapshotRecorder(
	opts: RequestSnapshotRecorderOptions,
): RequestSnapshotRecorder {
	const { db, traceWriter, ids } = opts;
	const promptHash = opts.promptHash ?? null;

	let turnNumber = 0;
	let tail: Promise<void> = Promise.resolve();
	/** Blob hashes already upserted by this recorder (skip repeat writes — the transcript is prefix-stable across turns). */
	const writtenHashes = new Set<string>();

	function logError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (opts.logger) {
			opts.logger.error(`request snapshot ${context} failed`, {
				error: message,
				runId: ids.runId,
			});
		} else {
			console.error(`request snapshot ${context} failed: ${message}`);
		}
	}

	/**
	 * Sanitize one message per the PiRequestSnapshotData contract: image
	 * blocks lose their base64 `data` in favor of {blob_hash, byte_length};
	 * everything else passes through. Also tallies the ref counters.
	 */
	function sanitizeMessage(
		message: MessageLike,
		addBlob: (bytes: Buffer, kind: string, mimeType: string) => string,
	): {
		sanitized: MessageLike;
		textChars: number;
		imageCount: number;
		toolCallCount: number;
	} {
		let textChars = 0;
		let imageCount = 0;
		let toolCallCount = 0;
		const content = message.content;
		let sanitizedContent: unknown = content;

		if (typeof content === "string") {
			textChars = content.length;
		} else if (Array.isArray(content)) {
			sanitizedContent = content.map((raw) => {
				const block = raw as BlockLike;
				if (block?.type === "text") {
					textChars += block.text?.length ?? 0;
					return block;
				}
				if (block?.type === "thinking") {
					textChars += block.thinking?.length ?? 0;
					return block;
				}
				if (block?.type === "toolCall") {
					toolCallCount += 1;
					return block;
				}
				if (block?.type === "image" && typeof block.data === "string") {
					imageCount += 1;
					const bytes = Buffer.from(block.data, "base64");
					const mimeType =
						typeof block.mimeType === "string"
							? block.mimeType
							: "application/octet-stream";
					const blobHash = addBlob(bytes, "image", mimeType);
					const { data: _data, ...rest } = block;
					return {
						...rest,
						type: "image",
						blob_hash: blobHash,
						mimeType,
						byte_length: bytes.byteLength,
					};
				}
				return block;
			});
		}
		if (typeof message.summary === "string") {
			textChars += message.summary.length;
		}

		const sanitized =
			sanitizedContent === content
				? message
				: { ...message, content: sanitizedContent };
		return { sanitized, textChars, imageCount, toolCallCount };
	}

	async function writeSnapshot(capture: TurnCapture): Promise<void> {
		const now = new Date().toISOString();
		const newBlobs: NewTraceBlob[] = [];
		const pendingHashes = new Set<string>();

		function addBlob(bytes: Buffer, kind: string, mimeType: string): string {
			const hash = hashTraceBlobBytes(bytes);
			if (!writtenHashes.has(hash) && !pendingHashes.has(hash)) {
				pendingHashes.add(hash);
				newBlobs.push({
					hash,
					kind,
					mimeType,
					byteLength: bytes.byteLength,
					data: bytes,
					createdAt: now,
				});
			}
			return hash;
		}

		let systemPromptBlobHash: string | null = null;
		if (capture.systemPrompt !== null) {
			systemPromptBlobHash = addBlob(
				Buffer.from(capture.systemPrompt, "utf8"),
				"text",
				"text/plain",
			);
		}

		const refs: PiRequestSnapshotMessageRef[] = [];
		let totalTextChars = 0;
		let totalImageCount = 0;
		capture.messages.forEach((message, index) => {
			const { sanitized, textChars, imageCount, toolCallCount } =
				sanitizeMessage(message, addBlob);
			const blobHash = addBlob(
				Buffer.from(JSON.stringify(sanitized), "utf8"),
				"message",
				"application/json",
			);
			refs.push({
				blob_hash: blobHash,
				role: message.role ?? "unknown",
				index,
				text_chars: textChars,
				image_count: imageCount,
				tool_call_count: toolCallCount,
			});
			totalTextChars += textChars;
			totalImageCount += imageCount;
		});

		if (newBlobs.length > 0) {
			await upsertTraceBlobs(db, newBlobs);
			for (const hash of pendingHashes) writtenHashes.add(hash);
		}

		const data: PiRequestSnapshotData = {
			turn_number: capture.turnNumber,
			system_prompt_blob_hash: systemPromptBlobHash,
			prompt_hash: promptHash,
			message_count: refs.length,
			message_refs: refs,
			total_text_chars: totalTextChars,
			total_image_count: totalImageCount,
		};
		traceWriter.submit(createPiRequestSnapshotEvent(ids, data));
	}

	function record(session: RequestSnapshotSessionLike): void {
		// Synchronous capture: the message array can grow while the tail is
		// backed up, but completed messages themselves are stable, so a
		// convertToLlm-filtered slice taken here preserves the message set sent
		// to the model for this turn.
		let capture: TurnCapture;
		try {
			const rawMessages = Array.isArray(session.messages)
				? session.messages
				: [];
			capture = {
				turnNumber,
				systemPrompt:
					typeof session.systemPrompt === "string"
						? session.systemPrompt
						: null,
				messages: rawMessages.filter((m) =>
					isSentToModel(m as MessageLike),
				),
			};
		} catch (error) {
			logError("capture", error);
			return;
		}
		turnNumber += 1;
		tail = tail
			.then(() => writeSnapshot(capture))
			.catch((error) => logError("write", error));
	}

	return {
		handleEvent(event, session): void {
			try {
				const type = (event as { type?: string })?.type;
				if (type === "agent_start") {
					// Emitter parity: turn numbering restarts per agent invocation.
					turnNumber = 0;
					return;
				}
				if (type === "turn_start") record(session);
			} catch (error) {
				logError("handleEvent", error);
			}
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
