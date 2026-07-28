/**
 * Per-turn request snapshot recorder — captures the system prompt plus the
 * message window one turn ran on into the content-addressed trace_blobs store
 * and emits a pi_request_snapshot trace event referencing the blobs (see
 * PiRequestSnapshotData in @agent-kernel/protocol for the sanitized-message
 * contract).
 *
 * TWO CAPTURE PATHS, chosen per run by `builderOwnsCapture` — never mixed:
 *
 *  1. Transcript path (no state extension). `handleEvent` snapshots at each
 *     `turn_start` from the live session, filtering messages through
 *     pi-coding-agent's convertToLlm selection contract. This is what the
 *     model sees because nothing rewrites the outgoing array.
 *
 *  2. Builder path (a state extension is registered). The three-section
 *     builder runs in Pi's `context` hook and rewrites the outgoing array, so
 *     the transcript is NOT the request; `recordBuiltRequest` records the
 *     assembled array verbatim, with its section tags. The transcript path is
 *     stood down for the whole run from construction — not lazily on the first
 *     built request — because Pi fires `turn_start` BEFORE the `context` hook,
 *     so a lazy switch would still emit one extra untagged turn-0 snapshot and
 *     shift every later turn_number by +1.
 *
 * Turn numbering: the counter is 0-based, resets on `agent_start`, and
 * increments once per captured request. The kernel emitter numbers
 * pi_turn_start events the same way (reset on agent_start, increment on
 * turn_end), so:
 *
 *  - Transcript path: snapshot.turn_number matches the emitter's
 *    pi_turn_start turn_number 1:1 — one capture per turn_start, and turn
 *    events alternate start/end within one agent invocation.
 *  - Builder path: the alignment holds turn-for-turn in the normal case,
 *    because `context` fires exactly once per turn. It is NOT a guarantee:
 *    `context` fires once per *provider request*, so a provider retry within
 *    one turn re-runs the hook and produces an EXTRA snapshot. That snapshot
 *    consumes a turn_number, after which snapshot numbering runs ahead of
 *    pi_turn_start for the rest of the agent invocation. Readers correlating
 *    the two must treat turn_number as "the nth captured request", not as a
 *    key into turn events. (The extra snapshot is itself accurate — it is a
 *    real request that really went out.)
 *
 * Safety contract: both entry points are synchronous and never throw. They
 * capture the session state (system prompt string + a shallow slice of the
 * messages — pi messages are immutable once persisted) synchronously, then
 * defer all hashing, blob upserts, and event emission behind an internal
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
	type PiRequestSnapshotSection,
	type PiRequestSnapshotTool,
	type TraceEventIds,
} from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../../subagents/types";
import type { KernelAgentSessionEventLike } from "../types";

/**
 * The slice of a live Pi AgentSession the recorder reads. The tool-roster
 * methods are optional: the real AgentSession has both, test fakes and older
 * session shapes may have neither, and a session missing either one simply
 * yields an uncaptured roster (see captureToolRoster).
 */
export interface RequestSnapshotSessionLike {
	messages: any[];
	systemPrompt?: string;
	/** Names of the tools active on the session right now, in roster order. */
	getActiveToolNames?(): string[];
	/** Every configured tool, with its description and parameter schema. */
	getAllTools?(): Array<{
		name: string;
		description?: string;
		parameters?: unknown;
	}>;
}

/**
 * Capture the tool roster the session would send with this request: the
 * active tool names, in the session's own order, resolved against the full
 * tool registry for descriptions and parameter schemas.
 *
 * Returns undefined — "not captured", never "zero tools" — when the session
 * does not expose both methods or either one throws. Capture must never break
 * a turn, so every failure degrades to absence.
 */
export function captureToolRoster(
	session: RequestSnapshotSessionLike,
): PiRequestSnapshotTool[] | undefined {
	try {
		if (
			typeof session?.getActiveToolNames !== "function" ||
			typeof session?.getAllTools !== "function"
		) {
			return undefined;
		}
		const all = session.getAllTools() ?? [];
		const byName = new Map<string, { description?: string; parameters?: unknown }>();
		for (const tool of all) {
			if (tool && typeof tool.name === "string") byName.set(tool.name, tool);
		}
		const names = session.getActiveToolNames() ?? [];
		// Active-name order is provider-visible order — preserved exactly, and a
		// name with no registry entry still records that the tool was offered.
		return names.map((name) => {
			const info = byName.get(name);
			return {
				name,
				...(info?.description !== undefined
					? { description: info.description }
					: {}),
				...(info?.parameters !== undefined
					? { parameters: info.parameters }
					: {}),
			};
		});
	} catch {
		return undefined;
	}
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
	/**
	 * A three-section builder owns capture for this run from the FIRST turn.
	 * Set it whenever the spawn registered a state extension: Pi fires
	 * `turn_start` BEFORE the `context` hook the builder runs in, so waiting
	 * for the first recordBuiltRequest() to stand the transcript path down
	 * would still record one extra, untagged turn-0 snapshot per run and shift
	 * every builder-tagged turn_number by +1 against pi_turn_start.
	 */
	builderOwnsCapture?: boolean;
	logger?: RequestSnapshotLoggerLike;
}

export interface RequestSnapshotRecorder {
	/**
	 * Feed one live Pi session event. Resets the turn counter on
	 * "agent_start" (emitter parity); snapshots the live transcript on
	 * "turn_start" — unless a builder owns capture for this run, in which case
	 * turn_start is ignored entirely. Synchronous, never throws.
	 */
	handleEvent(
		event: KernelAgentSessionEventLike,
		session: RequestSnapshotSessionLike,
	): void;
	/**
	 * Record the exact message array a three-section builder assembled, with
	 * its section boundaries — the built request IS the request. Also latches
	 * the transcript path off, which is belt-and-braces: a spawn that has a
	 * builder should already have been constructed with `builderOwnsCapture`,
	 * because turn_start fires before the builder's hook. Synchronous, never
	 * throws.
	 */
	recordBuiltRequest(
		session: RequestSnapshotSessionLike,
		built: { messages: any[]; sections?: PiRequestSnapshotSection[] },
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
	sections?: PiRequestSnapshotSection[];
	/** Undefined = roster not captured for this turn (never "zero tools"). */
	tools?: PiRequestSnapshotTool[];
}

export function createRequestSnapshotRecorder(
	opts: RequestSnapshotRecorderOptions,
): RequestSnapshotRecorder {
	const { db, traceWriter, ids } = opts;
	const promptHash = opts.promptHash ?? null;

	let turnNumber = 0;
	let tail: Promise<void> = Promise.resolve();
	/** Set once a builder starts supplying requests — see recordBuiltRequest. */
	let builtRequestSource = opts.builderOwnsCapture === true;
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

		// Tool roster: one JSON blob per distinct roster. writtenHashes dedupes
		// across turns for free, so a run whose tools never change writes one.
		let toolsBlobHash: string | null = null;
		let toolCount: number | undefined;
		if (capture.tools) {
			try {
				const json = JSON.stringify(capture.tools);
				toolsBlobHash = addBlob(
					Buffer.from(json, "utf8"),
					"tools",
					"application/json",
				);
				toolCount = capture.tools.length;
			} catch (error) {
				// An unserializable parameter schema drops the roster to
				// "not captured" rather than losing the whole snapshot.
				logError("tools serialize", error);
				toolsBlobHash = null;
				toolCount = undefined;
			}
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
			// Absent on transcript-captured turns — readers treat that as
			// "untagged", exactly like every snapshot written before sections.
			...(capture.sections ? { sections: capture.sections } : {}),
			// Both fields are omitted entirely when the roster was not
			// captured: absence is the signal, and null would read as an
			// empty roster.
			...(toolsBlobHash !== null && toolCount !== undefined
				? { tools_blob_hash: toolsBlobHash, tool_count: toolCount }
				: {}),
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
			// The roster is read off the session, like the system prompt — it
			// is what this request goes out with, not what the run started on.
			const tools = captureToolRoster(session);
			capture = {
				turnNumber,
				systemPrompt:
					typeof session.systemPrompt === "string"
						? session.systemPrompt
						: null,
				messages: rawMessages.filter((m) =>
					isSentToModel(m as MessageLike),
				),
				...(tools ? { tools } : {}),
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
				// When a builder owns capture, the transcript is not the
				// request — turn_start captures nothing at all for this run.
				if (type === "turn_start" && !builtRequestSource) record(session);
			} catch (error) {
				logError("handleEvent", error);
			}
		},

		recordBuiltRequest(session, built): void {
			let capture: TurnCapture;
			try {
				builtRequestSource = true;
				const messages = Array.isArray(built.messages) ? built.messages : [];
				// Tools come from the session even on the builder path — the
				// builder assembles messages, it does not own the roster.
				const tools = captureToolRoster(session);
				capture = {
					turnNumber,
					systemPrompt:
						typeof session.systemPrompt === "string"
							? session.systemPrompt
							: null,
					messages: messages as MessageLike[],
					...(built.sections ? { sections: built.sections } : {}),
					...(tools ? { tools } : {}),
				};
			} catch (error) {
				logError("built capture", error);
				return;
			}
			turnNumber += 1;
			tail = tail
				.then(() => writeSnapshot(capture))
				.catch((error) => logError("write", error));
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
