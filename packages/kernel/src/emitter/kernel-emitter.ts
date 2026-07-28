/**
 * In-process kernel emitter — maps live Pi session events to protocol trace
 * events with identity from the run context. This is the primary emission
 * path; transcript recovery (backfill) re-derives the same rows from JSONL.
 *
 * Id compatibility with backfill: the transcript-recovery EventMapper derives event ids
 * from (piSessionUuid, JSONL entry id, ordinal, type) via the shared
 * `piEntryEventId` helper in @agent-kernel/protocol. This emitter derives the
 * IDENTICAL ids by recovering each JSONL entry id at emit time, so a later
 * backfill of the same session inserts zero duplicate rows:
 *
 * - session header entry: its id IS the Pi session uuid — known up front.
 * - lifecycle custom entries (kernel:pi-lifecycle): the pipeline's lifecycle
 *   logger subscribes BEFORE this emitter and appends the custom entry
 *   synchronously, so when we observe agent/turn events the session leaf
 *   entry is that lifecycle entry.
 * - message entries: AgentSession persists messages AFTER notifying
 *   subscribers (listener runs, then `sessionManager.appendMessage`), so the
 *   entry id does not exist yet inside the listener. We defer one microtask —
 *   the persistence call is in the same synchronous continuation, so by the
 *   time the microtask runs the leaf entry is the just-persisted message
 *   (verified by object identity on `.message`).
 *
 * If the leaf entry cannot be verified (e.g. Pi changes persistence order),
 * we fall back to a deterministic id from (piSessionUuid, turn ordinal, type,
 * index-within-turn) — never randomUUID — and log a warning: ids stay stable,
 * but a backfill of that entry would not dedupe against the live row.
 */

import {
	createAgentSessionStartEvent,
	createAssistantMessageEvent,
	createPiAgentEndEvent,
	createPiAgentStartEvent,
	createPiTurnEndEvent,
	createPiTurnStartEvent,
	createToolCallEndEvent,
	createToolCallStartEvent,
	createUserMessageEvent,
	liveFallbackEventId,
	piEntryEventId,
	turnUsageFromPiMessage,
	type RunTraceEventIds,
	type TraceEvent,
	type TurnUsage,
} from "@agent-kernel/protocol";

import type { TraceWriterSink } from "../subagents/types";
import type { KernelAgentSessionEventLike } from "../spawn-pipeline/types";

export const DEFAULT_EMITTER_LIFECYCLE_CUSTOM_TYPE = "kernel:pi-lifecycle";

const TOOL_OUTPUT_LIMIT = 10_000;

/** The slice of Pi's SessionManager the emitter reads (entry-id recovery). */
export interface EmitterSessionEntryLike {
	type: string;
	id: string;
	customType?: string;
	data?: unknown;
	message?: unknown;
}

export interface EmitterSessionManagerLike {
	getLeafEntry(): EmitterSessionEntryLike | undefined | null;
}

export interface KernelEmitterLoggerLike {
	warn(message: string, data?: Record<string, unknown>): void;
}

export interface KernelEmitterOptions {
	traceWriter: TraceWriterSink;
	/** Envelope identity for this run (containerId, runId, piSessionUuid, userId?). */
	ids: RunTraceEventIds & { piSessionUuid: string };
	agentName: string;
	/** Resolved model label — used until per-message model info is observed. */
	model?: string;
	/** Run phase stamped onto user_message eventData. */
	phase?: string;
	/**
	 * The agent's harvested spawner map (tool name → `spawns` allowlist, D77).
	 * Tool calls whose name is in this map are marked with
	 * `toolKind: "spawner"` + `spawns` so viewers can render agent dispatch
	 * differently from ordinary tools.
	 */
	spawnerTools?: Record<string, string[]>;
	/** Custom type the pipeline's lifecycle logger writes (JSONL parity check). */
	lifecycleCustomType?: string;
	/** Session manager of the live Pi session, for JSONL entry-id recovery. */
	sessionManager?: EmitterSessionManagerLike;
	/** Called once per pi_turn_end that carried usage (run rollup increments). */
	onTurnUsage?: (usage: TurnUsage) => void;
	/** Called when the first user_message of the run is emitted. */
	onInboundEvent?: (eventId: string) => void;
	/**
	 * Model price table keyed by resolved model string. When the provider does
	 * not report a cost, per-turn costEstimate is derived from these prices.
	 */
	prices?: ModelPriceTable;
	logger?: KernelEmitterLoggerLike;
}

export type ModelPriceTable = Record<
	string,
	{ inputPerMTok?: number; outputPerMTok?: number }
>;

/**
 * Fill usage.costEstimate from a price table when the provider did not
 * report a cost. Returns the input unchanged when a cost is already present
 * or no price entry matches the turn's model.
 */
export function applyPriceEstimate(
	usage: TurnUsage,
	prices: ModelPriceTable | undefined,
): TurnUsage {
	if (usage.costEstimate !== undefined) return usage;
	const price = prices?.[usage.model];
	if (!price) return usage;
	const cost =
		(usage.inputTokens * (price.inputPerMTok ?? 0) +
			usage.outputTokens * (price.outputPerMTok ?? 0)) /
		1_000_000;
	return { ...usage, costEstimate: cost };
}

export interface KernelEmitter {
	/** Emit agent_session_start (id derived from the session header entry). */
	emitSessionStart(): void;
	/** Feed one live Pi session event (from the pipeline's session subscription). */
	handleEvent(event: KernelAgentSessionEventLike): void;
	/** Await deferred message mapping — call before closing the run. */
	settle(): Promise<void>;
	/** Event id of the first user_message observed in this run. */
	inboundEventId(): string | undefined;
	/** Event id of the last assistant_message observed in this run. */
	outboundEventId(): string | undefined;
	/** Usage totals across this run's turns; undefined when nothing observed. */
	runUsage(): TurnUsage | undefined;
}

interface PiContentBlockLike {
	type?: string;
	text?: string;
	id?: string;
	name?: string;
	arguments?: string;
}

interface PiMessageLike {
	role?: string;
	content?: unknown;
	usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
	model?: string;
	stopReason?: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
}

export function createKernelEmitter(opts: KernelEmitterOptions): KernelEmitter {
	const {
		traceWriter,
		ids,
		agentName,
		sessionManager,
		onTurnUsage,
		onInboundEvent,
		logger,
	} = opts;
	const piSessionUuid = ids.piSessionUuid;
	const lifecycleCustomType =
		opts.lifecycleCustomType ?? DEFAULT_EMITTER_LIFECYCLE_CUSTOM_TYPE;
	const model = opts.model ?? "unknown";

	let turnIndex = 0;
	let fallbackIndexWithinTurn = 0;
	let warnedFallback = false;
	let currentTurnUsage: TurnUsage | null = null;
	let inboundId: string | undefined;
	let outboundId: string | undefined;
	const pendingWork: Promise<void>[] = [];
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	let totalCost: number | undefined;
	let totalsModel: string | undefined;
	let sawUsage = false;

	function fallbackId(type: string): string {
		if (!warnedFallback) {
			warnedFallback = true;
			logger?.warn(
				"kernel emitter could not recover a JSONL entry id; using deterministic live fallback ids (backfill of this session may not fully dedupe)",
				{ piSessionUuid, type },
			);
		}
		return liveFallbackEventId(piSessionUuid, turnIndex, type, fallbackIndexWithinTurn++);
	}

	/**
	 * Re-stamp a factory-built event exactly like the backfill mapper does:
	 * deterministic id, agent source, current pi session uuid.
	 */
	function submitAsEntryEvent(evt: TraceEvent, entryId: string | undefined, ordinal: number): string {
		const eventId =
			entryId !== undefined
				? piEntryEventId(piSessionUuid, entryId, ordinal, String(evt.type))
				: fallbackId(String(evt.type));
		traceWriter.submit({
			...evt,
			eventId,
			source: "agent",
			piSessionUuid,
		});
		return eventId;
	}

	/** Leaf entry id when the leaf is the lifecycle custom entry for `phase`. */
	function lifecycleEntry(phase: string): { entryId?: string; data?: Record<string, unknown> } {
		const leaf = sessionManager?.getLeafEntry();
		if (
			leaf &&
			leaf.type === "custom" &&
			leaf.customType === lifecycleCustomType &&
			typeof leaf.data === "object" &&
			leaf.data !== null &&
			(leaf.data as Record<string, unknown>).phase === phase
		) {
			return { entryId: leaf.id, data: leaf.data as Record<string, unknown> };
		}
		return {};
	}

	/** Leaf entry id when the leaf is the just-persisted message entry. */
	function messageEntryId(message: PiMessageLike): string | undefined {
		const leaf = sessionManager?.getLeafEntry();
		if (leaf && leaf.type === "message" && leaf.message === message) return leaf.id;
		return undefined;
	}

	/** toolKind/spawns marking for declared spawner tools (D77). */
	function spawnerMarking(
		toolName: string,
	): { toolKind: "spawner"; spawns: string[] } | undefined {
		const spawns = opts.spawnerTools?.[toolName];
		return spawns ? { toolKind: "spawner", spawns } : undefined;
	}

	function normalizedContent(message: PiMessageLike): PiContentBlockLike[] {
		const content = message.content;
		// Pi persists user prompts as either a string or content blocks —
		// normalize the same way the backfill mapper does.
		if (typeof content === "string") return [{ type: "text", text: content }];
		if (Array.isArray(content)) return content as PiContentBlockLike[];
		return [];
	}

	/**
	 * Map one persisted message to trace events. Block iteration and ordinal
	 * assignment mirror the transcript-recovery EventMapper.mapMessage exactly — that is
	 * what keeps live ids identical to backfill ids.
	 */
	function emitMessageEvents(message: PiMessageLike, entryId: string | undefined): void {
		const role = message.role;
		let ordinal = 0;
		const content = normalizedContent(message);

		if (role === "toolResult") {
			const toolName = message.toolName ?? "unknown";
			const toolCallId = message.toolCallId ?? "unknown";
			const output = content
				.map((b) => (b.type === "text" ? (b.text ?? "") : ""))
				.join("")
				.slice(0, TOOL_OUTPUT_LIMIT);
			submitAsEntryEvent(
				createToolCallEndEvent(ids, toolName, toolCallId, {
					toolOutput: output || undefined,
					isError: message.isError,
					spanId: toolCallId,
					...spawnerMarking(toolName),
				}),
				entryId,
				ordinal++,
			);
			return;
		}

		for (const block of content) {
			if (role === "user" && block.type === "text") {
				const eventId = submitAsEntryEvent(
					createUserMessageEvent(ids, block.text ?? "", opts.phase ?? "unknown"),
					entryId,
					ordinal++,
				);
				if (inboundId === undefined) {
					inboundId = eventId;
					onInboundEvent?.(eventId);
				}
			}

			if (role === "assistant" && block.type === "text") {
				outboundId = submitAsEntryEvent(
					createAssistantMessageEvent(ids, block.text ?? "", "text"),
					entryId,
					ordinal++,
				);
			}

			if (role === "assistant" && block.type === "toolCall") {
				let toolInput: Record<string, unknown> | undefined;
				try {
					toolInput = JSON.parse(block.arguments ?? "");
				} catch {
					toolInput = { raw: block.arguments };
				}
				submitAsEntryEvent(
					createToolCallStartEvent(ids, block.name ?? "unknown", block.id ?? "unknown", {
						toolInput,
						spanId: block.id,
						...spawnerMarking(block.name ?? "unknown"),
					}),
					entryId,
					ordinal++,
				);
			}
		}
	}

	function handleMessageEnd(message: PiMessageLike): void {
		const role = message.role;
		if (role !== "user" && role !== "assistant" && role !== "toolResult") return;

		if (role === "assistant") {
			const usage = turnUsageFromPiMessage(
				message as { usage?: PiMessageLike["usage"]; model?: string },
				model,
			);
			if (usage) currentTurnUsage = applyPriceEstimate(usage, opts.prices);
		}

		// Defer one microtask: AgentSession persists the message right after
		// notifying listeners, in the same synchronous continuation.
		pendingWork.push(
			Promise.resolve().then(() => {
				emitMessageEvents(message, messageEntryId(message));
			}),
		);
	}

	function recordTurnUsage(usage: TurnUsage): void {
		totals.input += usage.inputTokens;
		totals.output += usage.outputTokens;
		totals.cacheRead += usage.cacheReadTokens;
		totals.cacheWrite += usage.cacheWriteTokens;
		if (usage.costEstimate !== undefined) {
			totalCost = (totalCost ?? 0) + usage.costEstimate;
		}
		totalsModel = usage.model;
		sawUsage = true;
		onTurnUsage?.(usage);
	}

	function handleLifecycle(event: Record<string, unknown>): void {
		switch (event.type) {
			case "agent_start": {
				turnIndex = 0;
				fallbackIndexWithinTurn = 0;
				currentTurnUsage = null;
				const { entryId } = lifecycleEntry("agent_start");
				submitAsEntryEvent(createPiAgentStartEvent(ids), entryId, 0);
				return;
			}
			case "agent_end": {
				const { entryId } = lifecycleEntry("agent_end");
				submitAsEntryEvent(
					createPiAgentEndEvent(ids, "ok", {
						inputTokens: sawUsage ? totals.input : undefined,
						outputTokens: sawUsage ? totals.output : undefined,
					}),
					entryId,
					0,
				);
				return;
			}
			case "turn_start": {
				fallbackIndexWithinTurn = 0;
				currentTurnUsage = null;
				const { entryId, data } = lifecycleEntry("turn_start");
				submitAsEntryEvent(
					createPiTurnStartEvent(ids, {
						turnNumber: (data?.turnIndex as number | undefined) ?? turnIndex,
					}),
					entryId,
					0,
				);
				return;
			}
			case "turn_end": {
				const usage = currentTurnUsage;
				currentTurnUsage = null;
				const { entryId, data } = lifecycleEntry("turn_end");
				const stopReason =
					(data?.stopReason as string | undefined) ??
					((event.message as PiMessageLike | undefined)?.stopReason);
				submitAsEntryEvent(
					createPiTurnEndEvent(ids, {
						turnNumber: (data?.turnIndex as number | undefined) ?? turnIndex,
						stopReason,
						...(usage ? { usage } : {}),
					}),
					entryId,
					0,
				);
				if (usage) recordTurnUsage(usage);
				turnIndex += 1;
				return;
			}
			default:
				return;
		}
	}

	return {
		emitSessionStart(): void {
			// The JSONL session header entry's id is the session uuid itself.
			submitAsEntryEvent(
				createAgentSessionStartEvent(ids, agentName, model),
				piSessionUuid,
				0,
			);
		},

		handleEvent(event: KernelAgentSessionEventLike): void {
			const evt = event as Record<string, unknown>;
			switch (evt.type) {
				case "message_end":
					handleMessageEnd((evt.message ?? {}) as PiMessageLike);
					return;
				case "agent_start":
				case "agent_end":
				case "turn_start":
				case "turn_end":
					handleLifecycle(evt);
					return;
				default:
					return;
			}
		},

		async settle(): Promise<void> {
			// Deferred message mapping resolves one microtask after each
			// message_end; by the time the run's prompt() resolves these are
			// all settled, but await defensively before reading ids/usage.
			while (pendingWork.length > 0) {
				const batch = pendingWork.splice(0, pendingWork.length);
				await Promise.all(batch);
			}
		},

		inboundEventId: () => inboundId,
		outboundEventId: () => outboundId,

		runUsage(): TurnUsage | undefined {
			if (!sawUsage) return undefined;
			return {
				inputTokens: totals.input,
				outputTokens: totals.output,
				cacheReadTokens: totals.cacheRead,
				cacheWriteTokens: totals.cacheWrite,
				model: totalsModel ?? model,
				...(totalCost !== undefined ? { costEstimate: totalCost } : {}),
			};
		},
	};
}
