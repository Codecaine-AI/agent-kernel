import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";

import {
	ensureKernelObservabilitySchema,
	getTraceEventsForRun,
	insertTraceEventsBatch,
	openKernelDatabase,
	updateAgentRunStatus,
	updatePiAgentSessionStatus,
	upsertContainer,
	upsertPromotableTraceEvent,
	type KernelDatabase,
} from "@agent-kernel/db";
import { EventMapper, runBackfill } from "../transcript-recovery";
import type { PiEvent } from "../transcript-recovery";
import {
	nestedToolEventId,
	piEntryEventId,
	type TraceEvent,
	type TurnUsage,
} from "@agent-kernel/protocol";

import { runTraceDoctor } from "../doctor";
import { setupPiSessionAndRun } from "../spawn-pipeline/session/pi-session-db-init";
import type { TraceWriterSink } from "../subagents/types";
import { createDbTraceWriter } from "../trace-writer";
import {
	createKernelEmitter,
	type EmitterSessionEntryLike,
	type KernelEmitterLoggerLike,
} from "./kernel-emitter";
import type { KernelAgentSessionEventLike } from "../spawn-pipeline/types";

const PI_UUID = "11111111-2222-3333-4444-555555555555";
const CONTAINER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const RUN_ID = "99999999-8888-7777-6666-555555555555";
const LIFECYCLE = "kernel:pi-lifecycle";

/**
 * Mimics Pi's SessionManager persistence: entries appended in order, leaf
 * advances, entry ids minted at append time (random in Pi; sequential here).
 */
class FakeSessionManager {
	entries: (EmitterSessionEntryLike & {
		timestamp: string;
		message?: unknown;
		data?: unknown;
	})[] = [];
	private n = 0;

	private append(entry: Record<string, unknown>) {
		const full = {
			id: `entry-${++this.n}`,
			timestamp: new Date().toISOString(),
			...entry,
		} as (typeof this.entries)[number];
		this.entries.push(full);
		return full.id;
	}

	appendMessage(message: unknown): string {
		return this.append({ type: "message", message });
	}

	appendCustomEntry(customType: string, data?: unknown): string {
		return this.append({ type: "custom", customType, data });
	}

	getLeafEntry() {
		return this.entries[this.entries.length - 1];
	}
}

/**
 * Mimics AgentSession event dispatch ordering:
 * - the lifecycle logger (subscribed first) appends its custom entry
 *   synchronously inside its listener;
 * - message persistence happens AFTER all listeners ran, in the same
 *   synchronous continuation;
 * - each Pi event is delivered in its own task (`await` between events).
 */
function makeHarness(opts?: {
	onTurnUsage?: (usage: TurnUsage) => void;
	onInboundEvent?: (eventId: string) => void;
	spawnerTools?: Record<string, string[]>;
	/** Replaces the default capturing sink. */
	traceWriter?: TraceWriterSink;
	logger?: KernelEmitterLoggerLike;
}) {
	const sm = new FakeSessionManager();
	const submitted: TraceEvent[] = [];
	let turnIndex = 0;

	const emitter = createKernelEmitter({
		traceWriter: opts?.traceWriter ?? { submit: (e) => submitted.push(e) },
		ids: { containerId: CONTAINER_ID, runId: RUN_ID, piSessionUuid: PI_UUID },
		agentName: "researcher",
		model: "test/model-1",
		phase: "research",
		lifecycleCustomType: LIFECYCLE,
		sessionManager: sm,
		onTurnUsage: opts?.onTurnUsage,
		onInboundEvent: opts?.onInboundEvent,
		spawnerTools: opts?.spawnerTools,
		logger: opts?.logger,
	});

	// Lifecycle logger listener (mirrors attachPiLifecycleLogger).
	function lifecycleLogger(event: Record<string, unknown>): void {
		switch (event.type) {
			case "agent_start":
				turnIndex = 0;
				sm.appendCustomEntry(LIFECYCLE, { phase: "agent_start" });
				break;
			case "agent_end": {
				sm.appendCustomEntry(LIFECYCLE, { phase: "agent_end" });
				break;
			}
			case "turn_start":
				sm.appendCustomEntry(LIFECYCLE, { phase: "turn_start", turnIndex });
				break;
			case "turn_end":
				sm.appendCustomEntry(LIFECYCLE, {
					phase: "turn_end",
					turnIndex,
					stopReason: (event.message as { stopReason?: string } | undefined)
						?.stopReason,
				});
				turnIndex += 1;
				break;
		}
	}

	async function deliver(events: Record<string, unknown>[]): Promise<void> {
		for (const event of events) {
			lifecycleLogger(event); // subscribed before the emitter
			emitter.handleEvent(event as KernelAgentSessionEventLike);
			if (event.type === "message_end") {
				// AgentSession persists after listeners, same sync continuation.
				sm.appendMessage(event.message);
			}
			await Promise.resolve(); // each Pi event arrives in its own task
		}
		await emitter.settle();
	}

	return { sm, submitted, emitter, deliver };
}

const USER_MSG = { role: "user", content: "find the bug", timestamp: 0 };
const ASSISTANT_MSG_1 = {
	role: "assistant",
	content: [
		{ type: "text", text: "Let me look." },
		{ type: "toolCall", id: "toolu_1", name: "read", arguments: '{"path":"a.ts"}' },
	],
	usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 2, totalTokens: 127, cost: { total: 0.01 } },
	model: "test/model-1",
	stopReason: "toolUse",
	timestamp: 0,
};
const TOOL_RESULT_MSG = {
	role: "toolResult",
	toolCallId: "toolu_1",
	toolName: "read",
	content: [{ type: "text", text: "file contents" }],
	timestamp: 0,
};
const ASSISTANT_MSG_2 = {
	role: "assistant",
	content: [{ type: "text", text: "Found it." }],
	usage: { input: 150, output: 30, cacheRead: 100, cacheWrite: 0, totalTokens: 280, cost: { total: 0.02 } },
	model: "test/model-1",
	stopReason: "stop",
	timestamp: 0,
};

function fullRunEvents(): Record<string, unknown>[] {
	return [
		{ type: "agent_start" },
		{ type: "message_end", message: USER_MSG },
		{ type: "turn_start" },
		{ type: "message_end", message: ASSISTANT_MSG_1 },
		{ type: "turn_end", message: ASSISTANT_MSG_1 },
		{ type: "message_end", message: TOOL_RESULT_MSG },
		{ type: "turn_start" },
		{ type: "message_end", message: ASSISTANT_MSG_2 },
		{ type: "turn_end", message: ASSISTANT_MSG_2 },
		{ type: "agent_end", messages: [] },
	];
}

describe("createKernelEmitter", () => {
	test("maps a full run to protocol events with deterministic entry-derived ids", async () => {
		const turnUsages: TurnUsage[] = [];
		const inbound: string[] = [];
		const { sm, submitted, emitter, deliver } = makeHarness({
			onTurnUsage: (u) => turnUsages.push(u),
			onInboundEvent: (id) => inbound.push(id),
		});

		emitter.emitSessionStart();
		await deliver(fullRunEvents());

		expect(submitted.map((e) => e.type)).toEqual([
			"agent_session_start",
			"pi_agent_start",
			"user_message",
			"pi_turn_start",
			"assistant_message",
			"tool_call_start",
			"pi_turn_end",
			"tool_call_end",
			"pi_turn_start",
			"assistant_message",
			"pi_turn_end",
			"pi_agent_end",
		]);

		// Every event id derives from (piSessionUuid, entryId, ordinal, type).
		const sessionStart = submitted[0];
		expect(sessionStart.eventId).toBe(
			piEntryEventId(PI_UUID, PI_UUID, 0, "agent_session_start"),
		);
		const userEntry = sm.entries.find(
			(e) => e.type === "message" && e.message === USER_MSG,
		)!;
		const userEvent = submitted.find((e) => e.type === "user_message")!;
		expect(userEvent.eventId).toBe(
			piEntryEventId(PI_UUID, userEntry.id, 0, "user_message"),
		);
		// Multi-block assistant message: ordinals follow block order.
		const a1Entry = sm.entries.find(
			(e) => e.type === "message" && e.message === ASSISTANT_MSG_1,
		)!;
		const a1Text = submitted.find((e) => e.type === "assistant_message")!;
		const toolStart = submitted.find((e) => e.type === "tool_call_start")!;
		expect(a1Text.eventId).toBe(
			piEntryEventId(PI_UUID, a1Entry.id, 0, "assistant_message"),
		);
		expect(toolStart.eventId).toBe(
			piEntryEventId(PI_UUID, a1Entry.id, 1, "tool_call_start"),
		);

		// Envelope identity is stamped from the run context.
		for (const e of submitted) {
			expect(e.containerId).toBe(CONTAINER_ID);
			expect(e.runId).toBe(RUN_ID);
			expect(e.piSessionUuid).toBe(PI_UUID);
		}

		// String user content still maps (backfill mapper normalizes the same way).
		expect((userEvent.eventData as { content: string }).content).toBe("find the bug");

		// Usage: per-turn on pi_turn_end, rolled up in runUsage().
		const turnEnds = submitted.filter((e) => e.type === "pi_turn_end");
		expect(
			(turnEnds[0].eventData as { usage?: TurnUsage }).usage?.inputTokens,
		).toBe(100);
		expect(
			(turnEnds[1].eventData as { usage?: TurnUsage }).usage?.inputTokens,
		).toBe(150);
		expect(turnUsages).toHaveLength(2);
		expect(emitter.runUsage()).toEqual({
			inputTokens: 250,
			outputTokens: 50,
			cacheReadTokens: 105,
			cacheWriteTokens: 2,
			model: "test/model-1",
			costEstimate: 0.03,
		});

		// Inbound/outbound event ids sourced from the emitter.
		expect(inbound).toEqual([userEvent.eventId]);
		expect(emitter.inboundEventId()).toBe(userEvent.eventId);
		const lastAssistant = submitted
			.filter((e) => e.type === "assistant_message")
			.at(-1)!;
		expect(emitter.outboundEventId()).toBe(lastAssistant.eventId);

		// tool_call_end carries the tool result output.
		const toolEnd = submitted.find((e) => e.type === "tool_call_end")!;
		expect(toolEnd.eventData).toMatchObject({
			tool_use_id: "toolu_1",
			tool_name: "read",
			tool_output: "file contents",
		});
	});

	test("marks spawner tool calls with toolKind + spawns (D77); ordinary tools untouched", async () => {
		const { submitted, deliver } = makeHarness({
			spawnerTools: { spawn_scouts: ["source-scout"] },
		});
		const spawnerCall = {
			role: "assistant",
			content: [
				{ type: "toolCall", id: "toolu_s", name: "spawn_scouts", arguments: "{}" },
				{ type: "toolCall", id: "toolu_r", name: "read", arguments: "{}" },
			],
			model: "test/model-1",
			stopReason: "toolUse",
			timestamp: 0,
		};
		const spawnerResult = {
			role: "toolResult",
			toolCallId: "toolu_s",
			toolName: "spawn_scouts",
			content: [{ type: "text", text: "2 scouts done" }],
			timestamp: 0,
		};
		await deliver([
			{ type: "agent_start" },
			{ type: "turn_start" },
			{ type: "message_end", message: spawnerCall },
			{ type: "turn_end", message: spawnerCall },
			{ type: "message_end", message: spawnerResult },
		]);

		const starts = submitted.filter((e) => e.type === "tool_call_start");
		expect(starts).toHaveLength(2);
		expect(starts[0].eventData).toMatchObject({
			tool_name: "spawn_scouts",
			toolKind: "spawner",
			spawns: ["source-scout"],
		});
		// The ordinary tool call carries no spawner marking.
		expect(starts[1].eventData).not.toHaveProperty("toolKind");
		expect(starts[1].eventData).not.toHaveProperty("spawns");

		const end = submitted.find((e) => e.type === "tool_call_end")!;
		expect(end.eventData).toMatchObject({
			tool_name: "spawn_scouts",
			toolKind: "spawner",
			spawns: ["source-scout"],
		});
	});

	test("propagates tool-result errors while omitting the flag for ordinary results", async () => {
		const { submitted, deliver } = makeHarness();
		await deliver([
			{
				type: "message_end",
				message: {
					role: "toolResult",
					toolCallId: "toolu_error",
					toolName: "layout",
					content: [{ type: "text", text: "ERROR · invalid layout" }],
					isError: true,
					timestamp: 0,
				},
			},
			{
				type: "message_end",
				message: {
					role: "toolResult",
					toolCallId: "toolu_ok",
					toolName: "layout",
					content: [{ type: "text", text: "layout complete" }],
					timestamp: 0,
				},
			},
		]);

		const errored = submitted.find(
			(e) =>
				e.type === "tool_call_end" &&
				(e.eventData as { tool_use_id?: string }).tool_use_id === "toolu_error",
		)!;
		const ordinary = submitted.find(
			(e) =>
				e.type === "tool_call_end" &&
				(e.eventData as { tool_use_id?: string }).tool_use_id === "toolu_ok",
		)!;

		expect(errored.eventData).toHaveProperty("is_error", true);
		expect(ordinary.eventData).not.toHaveProperty("is_error");
	});

	test("live emission ids are identical to backfill mapper ids (zero duplicates)", async () => {
		const { sm, submitted, emitter, deliver } = makeHarness();
		emitter.emitSessionStart();
		await deliver(fullRunEvents());

		// Rebuild the JSONL the session would have written and backfill it.
		const jsonl: PiEvent[] = [
			{ type: "session", version: 3, id: PI_UUID, timestamp: "2026-07-01T00:00:00.000Z", cwd: "/tmp" },
			...sm.entries.map((entry): PiEvent => {
				if (entry.type === "message") {
					return {
						type: "message",
						id: entry.id,
						parentId: null,
						timestamp: entry.timestamp,
						message: entry.message as never,
					};
				}
				return {
					type: "custom",
					customType: (entry as { customType?: string }).customType ?? "",
					data: (entry.data ?? {}) as Record<string, unknown>,
					id: entry.id,
					parentId: null,
					timestamp: entry.timestamp,
				};
			}),
		];

		const mapper = new EventMapper({ lifecycleCustomType: LIFECYCLE });
		mapper.setContainerBinding(CONTAINER_ID, RUN_ID);
		const backfilled: TraceEvent[] = [];
		for (const event of jsonl) {
			backfilled.push(...mapper.map(event).traceEvents);
		}

		const liveIds = submitted.map((e) => e.eventId).sort();
		const backfillIds = backfilled.map((e) => e.eventId).sort();
		expect(liveIds).toEqual(backfillIds);
	});

	test("falls back to deterministic live ids when the leaf entry cannot be verified", async () => {
		const submitted: TraceEvent[] = [];
		const emitter = createKernelEmitter({
			traceWriter: { submit: (e) => submitted.push(e) },
			ids: { containerId: CONTAINER_ID, runId: RUN_ID, piSessionUuid: PI_UUID },
			agentName: "researcher",
			// No sessionManager: entry ids are unrecoverable.
		});
		emitter.handleEvent({ type: "message_end", message: USER_MSG } as never);
		await emitter.settle();
		emitter.handleEvent({ type: "message_end", message: USER_MSG } as never);
		await emitter.settle();

		expect(submitted).toHaveLength(2);
		// Deterministic (not random) and unique per index-within-turn.
		expect(submitted[0].eventId).not.toBe(submitted[1].eventId);
		expect(submitted[0].eventId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});
});

// ─── Nested tool calls (codemode) ─────────────────────────────────────────────

const BINDING = "agent-kernel:session-binding";
const T_RUN = Date.parse("2026-07-01T10:00:00.000Z");

interface NestedRecordFixture {
	id: string;
	name: string;
	arguments?: Record<string, unknown>;
	status: "ok" | "error" | "unfinished";
	durationMs?: number;
}

/** The model-issued codemode call (top-level id "c"). */
const CODEMODE_CALL = {
	role: "assistant",
	content: [
		{ type: "toolCall", id: "c", name: "codemode", arguments: '{"code":"await tools.wrapper()"}' },
	],
	model: "test/model-1",
	stopReason: "toolUse",
	timestamp: 0,
};
const CODEMODE_START = {
	type: "tool_execution_start",
	toolCallId: "c",
	toolName: "codemode",
	args: { code: "await tools.wrapper()" },
};
const CODEMODE_END = {
	type: "tool_execution_end",
	toolCallId: "c",
	toolName: "codemode",
	result: { content: [{ type: "text", text: "script done" }], details: {} },
	isError: false,
};
const TURN_END = { type: "turn_end", message: CODEMODE_CALL };
const AGENT_END = { type: "agent_end", messages: [] };

/** codemode's tool result message_end, carrying Pi's nestedCalls record. */
function codemodeResult(calls: NestedRecordFixture[]): Record<string, unknown> {
	return {
		type: "message_end",
		message: {
			role: "toolResult",
			toolCallId: "c",
			toolName: "codemode",
			content: [{ type: "text", text: "script done" }],
			nestedCalls: { calls, complete: calls.every((c) => c.status !== "unfinished") },
			isError: false,
			timestamp: 0,
		},
	};
}

/** Pi's caller id for a nested call: `<callerId>/<n>` minus the final segment. */
function callerOf(id: string): string {
	return id.slice(0, id.lastIndexOf("/"));
}

function nestedStart(id: string, toolName: string, args: Record<string, unknown> = {}) {
	return { type: "tool_execution_start", toolCallId: id, toolName, args, parentToolCallId: callerOf(id) };
}

function nestedEnd(id: string, toolName: string, text: string, isError = false) {
	return {
		type: "tool_execution_end",
		toolCallId: id,
		toolName,
		result: { content: [{ type: "text", text }], details: {} },
		isError,
		parentToolCallId: callerOf(id),
	};
}

/** Agent start through codemode's own tool_execution_start. */
function codemodeOpening(): Record<string, unknown>[] {
	return [
		{ type: "agent_start" },
		{ type: "message_end", message: USER_MSG },
		{ type: "turn_start" },
		{ type: "message_end", message: CODEMODE_CALL },
		CODEMODE_START,
	];
}

/** A whole run: codemode whose script produced `live` nested events and the `calls` record. */
function codemodeRun(
	live: Record<string, unknown>[],
	calls: NestedRecordFixture[],
): Record<string, unknown>[] {
	return [...codemodeOpening(), ...live, CODEMODE_END, codemodeResult(calls), TURN_END, AGENT_END];
}

/** codemode → wrapper → read (ids c, c/1, c/1/1). */
const CHAIN_LIVE = [
	nestedStart("c/1", "wrapper", { path: "a.ts" }),
	nestedStart("c/1/1", "read", { path: "a.ts" }),
	nestedEnd("c/1/1", "read", "file contents"),
	nestedEnd("c/1", "wrapper", "wrapped: file contents"),
];
const CHAIN_CALLS: NestedRecordFixture[] = [
	{ id: "c/1", name: "wrapper", arguments: { path: "a.ts" }, status: "ok", durationMs: 4 },
	{ id: "c/1/1", name: "read", arguments: { path: "a.ts" }, status: "ok", durationMs: 2 },
];

/** The JSONL the harness session would have written, plus the kernel's binding marker. */
function transcriptOf(sm: FakeSessionManager): PiEvent[] {
	const t0 = "2026-07-01T00:00:00.000Z";
	return [
		{ type: "session", version: 3, id: PI_UUID, timestamp: t0, cwd: "/tmp" },
		{
			type: "custom",
			customType: BINDING,
			data: { containerId: CONTAINER_ID, runId: RUN_ID },
			id: "entry-binding",
			parentId: null,
			timestamp: t0,
		},
		...sm.entries.map((entry): PiEvent => {
			if (entry.type === "message") {
				return {
					type: "message",
					id: entry.id,
					parentId: null,
					timestamp: entry.timestamp,
					message: entry.message as never,
				};
			}
			return {
				type: "custom",
				customType: (entry as { customType?: string }).customType ?? "",
				data: (entry.data ?? {}) as Record<string, unknown>,
				id: entry.id,
				parentId: null,
				timestamp: entry.timestamp,
			};
		}),
	];
}

const BACKFILL_MAPPER = { sessionBinding: { customType: BINDING }, lifecycleCustomType: LIFECYCLE };

/** Backfill mapper output for the harness session, in memory. */
function mapTranscript(sm: FakeSessionManager): TraceEvent[] {
	const mapper = new EventMapper(BACKFILL_MAPPER);
	return transcriptOf(sm).flatMap((event) => mapper.map(event).traceEvents);
}

function data(event: TraceEvent): Record<string, unknown> {
	return event.eventData as Record<string, unknown>;
}

function nestedOnly(events: TraceEvent[]): TraceEvent[] {
	return events.filter((e) => data(e).nested === true);
}

function ofCall(events: TraceEvent[], toolUseId: string, type?: string): TraceEvent[] {
	return events.filter(
		(e) => data(e).tool_use_id === toolUseId && (type === undefined || e.type === type),
	);
}

/** Id, span and parent of every nested event, independent of order and timing. */
function nestedShape(events: TraceEvent[]) {
	return nestedOnly(events)
		.map((e) => ({
			type: e.type,
			eventId: e.eventId,
			spanId: e.spanId,
			toolUseId: data(e).tool_use_id,
			parent: data(e).parent_tool_use_id,
		}))
		.sort((a, b) => a.eventId.localeCompare(b.eventId));
}

/** Tool names from a call up through parent_tool_use_id, via tool_call_start rows. */
function ancestry(events: TraceEvent[], toolUseId: string): string[] {
	const names: string[] = [];
	let id: unknown = toolUseId;
	while (typeof id === "string") {
		const [start] = ofCall(events, id, "tool_call_start");
		if (!start) break;
		names.push(data(start).tool_name as string);
		id = data(start).parent_tool_use_id;
	}
	return names;
}

/** A capturing sink that records which method carried each event. */
function recordingSink() {
	const calls: Array<{ via: "submit" | "submitPromotable"; event: TraceEvent }> = [];
	const sink: TraceWriterSink = {
		submit: (event) => calls.push({ via: "submit", event }),
		submitPromotable: (event) => calls.push({ via: "submitPromotable", event }),
	};
	return { sink, calls };
}

describe("createKernelEmitter (nested tool calls)", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		setSystemTime();
		for (const cleanup of cleanups.splice(0)) cleanup();
	});

	/** Temp kernel DB with the harness container, session and run rows. */
	async function openTraceDb(): Promise<{ db: KernelDatabase; dir: string }> {
		const dir = mkdtempSync(join(tmpdir(), "kernel-emitter-nested-"));
		const handle = openKernelDatabase({ path: join(dir, "trace.db") });
		cleanups.push(() => {
			handle.close();
			rmSync(dir, { recursive: true, force: true });
		});
		await ensureKernelObservabilitySchema(handle.db);
		await upsertContainer(handle.db, {
			id: CONTAINER_ID,
			kernelId: "test",
			kind: "session",
			appKey: ["nested-tools"],
		});
		await setupPiSessionAndRun(handle.db, {
			piSessionUuid: PI_UUID,
			containerId: CONTAINER_ID,
			runId: RUN_ID,
			agentName: "researcher",
			trigger: "operator",
		});
		return { db: handle.db, dir };
	}

	/** runBackfill over the harness session's transcript as it stands now. */
	async function backfillInto(db: KernelDatabase, dir: string, sm: FakeSessionManager) {
		const file = join(dir, `${PI_UUID}.jsonl`);
		writeFileSync(file, transcriptOf(sm).map((l) => JSON.stringify(l)).join("\n") + "\n");
		return runBackfill({ files: [file], db, mapper: BACKFILL_MAPPER });
	}

	test("nested execution events become tool spans with parent ids (emitter harness)", async () => {
		setSystemTime(new Date(T_RUN));
		const { sink, calls } = recordingSink();
		const { deliver } = makeHarness({ traceWriter: sink });

		await deliver([
			...codemodeOpening(),
			nestedStart("c/1", "read", { path: "a.ts" }),
			nestedStart("c/2", "ls", { path: "." }),
		]);
		setSystemTime(new Date(T_RUN + 25));
		await deliver([
			nestedEnd("c/1", "read", "file contents"),
			nestedEnd("c/2", "ls", "blocked by guard", true),
			CODEMODE_END,
			codemodeResult([
				{ id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "ok", durationMs: 25 },
				{ id: "c/2", name: "ls", arguments: { path: "." }, status: "error", durationMs: 25 },
			]),
			TURN_END,
			AGENT_END,
		]);

		// Starts go through submit, ends through the promotable write; the
		// record on the tool result adds nothing because every call ran live.
		const nested = calls.filter((c) => data(c.event).nested === true);
		expect(nested.map((c) => [c.via, c.event.type, data(c.event).tool_use_id])).toEqual([
			["submit", "tool_call_start", "c/1"],
			["submit", "tool_call_start", "c/2"],
			["submitPromotable", "tool_call_end", "c/1"],
			["submitPromotable", "tool_call_end", "c/2"],
		]);

		for (const { event } of nested) {
			const id = data(event).tool_use_id as string;
			expect(event.eventId).toBe(nestedToolEventId(PI_UUID, id, String(event.type)));
			expect(event.spanId).toBe(id);
			expect(event.source).toBe("agent");
			expect(event.containerId).toBe(CONTAINER_ID);
			expect(event.runId).toBe(RUN_ID);
			expect(event.piSessionUuid).toBe(PI_UUID);
			expect(data(event)).toMatchObject({ parent_tool_use_id: "c", nested: true, timing: "live" });
		}

		const [readStart, , readEnd, lsEnd] = nested.map((c) => c.event);
		expect(readStart!.timestamp).toBe(new Date(T_RUN).toISOString());
		expect(data(readStart!)).toMatchObject({
			tool_name: "read",
			tool_input: { raw: { path: "a.ts" } },
		});
		expect(readEnd!.timestamp).toBe(new Date(T_RUN + 25).toISOString());
		expect(data(readEnd!)).toMatchObject({
			tool_output: "file contents",
			duration_ms: 25,
			nested_status: "ok",
		});
		expect(data(readEnd!)).not.toHaveProperty("is_error");
		expect(data(lsEnd!)).toMatchObject({
			tool_output: "blocked by guard",
			is_error: true,
			nested_status: "error",
		});
	});

	test("top-level tool_execution events are still ignored", async () => {
		const { submitted, deliver } = makeHarness();
		await deliver([
			CODEMODE_START,
			{ type: "tool_execution_update", toolCallId: "c", toolName: "codemode", args: {}, partialResult: {} },
			CODEMODE_END,
			// An empty parent id is not a nested call.
			{ ...CODEMODE_START, parentToolCallId: "" },
			// Nested partial results are not spans.
			{ ...nestedStart("c/1", "read"), type: "tool_execution_update", partialResult: {} },
		]);
		expect(submitted).toEqual([]);
	});

	test("live and backfill produce identical nested event ids", async () => {
		const { sm, submitted, emitter, deliver } = makeHarness();
		emitter.emitSessionStart();
		await deliver(
			codemodeRun(
				[
					nestedStart("c/1", "read", { path: "a.ts" }),
					nestedEnd("c/1", "read", "file contents"),
					nestedStart("c/2", "bash", { command: "ls" }),
					nestedEnd("c/2", "bash", "a.ts"),
				],
				[
					{ id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "ok", durationMs: 1 },
					{ id: "c/2", name: "bash", arguments: { command: "ls" }, status: "ok", durationMs: 1 },
				],
			),
		);

		const backfilled = mapTranscript(sm);
		expect(nestedOnly(submitted)).toHaveLength(4);
		expect(nestedOnly(submitted).map((e) => e.eventId).sort()).toEqual(
			nestedOnly(backfilled).map((e) => e.eventId).sort(),
		);
		// Every other id still pairs one to one: nothing non-nested moved.
		expect(submitted.map((e) => e.eventId).sort()).toEqual(
			backfilled.map((e) => e.eventId).sort(),
		);
	});

	test("three-level chain: live and backfill build the same hierarchy", async () => {
		const { sm, submitted, emitter, deliver } = makeHarness();
		emitter.emitSessionStart();
		await deliver(codemodeRun(CHAIN_LIVE, CHAIN_CALLS));

		const backfilled = mapTranscript(sm);
		// Backfill only: a fresh database that never saw a live row.
		const { db, dir } = await openTraceDb();
		await backfillInto(db, dir, sm);
		const stored = await getTraceEventsForRun(db, RUN_ID);
		expect(nestedOnly(stored).every((e) => data(e).timing === "approximate")).toBe(true);

		expect(nestedShape(submitted)).toEqual(
			[
				{ type: "tool_call_start", toolUseId: "c/1", parent: "c" },
				{ type: "tool_call_end", toolUseId: "c/1", parent: "c" },
				{ type: "tool_call_start", toolUseId: "c/1/1", parent: "c/1" },
				{ type: "tool_call_end", toolUseId: "c/1/1", parent: "c/1" },
			]
				.map((e) => ({
					type: e.type,
					eventId: nestedToolEventId(PI_UUID, e.toolUseId, e.type),
					spanId: e.toolUseId,
					toolUseId: e.toolUseId,
					parent: e.parent,
				}))
				.sort((a, b) => a.eventId.localeCompare(b.eventId)),
		);
		for (const events of [submitted, backfilled, stored]) {
			expect(nestedShape(events)).toEqual(nestedShape(submitted));
			// The viewer nests by matching parent_tool_use_id against the parent's
			// tool_use_id, so every nested payload carries its own id there.
			for (const e of nestedOnly(events)) expect(data(e).tool_use_id).toBe(e.spanId);
			expect(ancestry(events, "c/1/1")).toEqual(["read", "wrapper", "codemode"]);
		}
	});

	test("live then backfill inserts each nested span once", async () => {
		const { db, dir } = await openTraceDb();
		const writer = createDbTraceWriter(db);
		const { sm, emitter, deliver } = makeHarness({ traceWriter: writer });
		emitter.emitSessionStart();
		await deliver(codemodeRun(CHAIN_LIVE, CHAIN_CALLS));
		await writer.flush();
		const liveRows = await getTraceEventsForRun(db, RUN_ID);

		const summary = await backfillInto(db, dir, sm);
		expect(summary.eventsMapped).toBe(liveRows.length);
		expect(summary.eventsInserted).toBe(0);

		const rows = await getTraceEventsForRun(db, RUN_ID);
		expect(rows).toHaveLength(liveRows.length);
		const nested = nestedOnly(rows);
		expect(nested).toHaveLength(4);
		// Live rows win: none was replaced by an approximate one.
		expect(nested.every((e) => data(e).timing === "live")).toBe(true);
	});

	test("live start → parent unfinished record → live end: one end row with the live data", async () => {
		setSystemTime(new Date(T_RUN));
		const { db, dir } = await openTraceDb();
		const writer = createDbTraceWriter(db);
		const { sm, deliver } = makeHarness({ traceWriter: writer });

		await deliver([
			...codemodeOpening(),
			nestedStart("c/1", "read", { path: "a.ts" }),
			CODEMODE_END,
			// The script did not await the call: Pi persists it unfinished.
			codemodeResult([{ id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "unfinished" }]),
		]);
		setSystemTime(new Date(T_RUN + 40));
		await deliver([nestedEnd("c/1", "read", "late contents"), TURN_END, AGENT_END]);
		await writer.flush();
		// A later backfill of the same session adds no second end either.
		await backfillInto(db, dir, sm);

		const ends = ofCall(await getTraceEventsForRun(db, RUN_ID), "c/1", "tool_call_end");
		expect(ends).toHaveLength(1);
		expect(ends[0]!.eventId).toBe(nestedToolEventId(PI_UUID, "c/1", "tool_call_end"));
		expect(data(ends[0]!)).toMatchObject({
			timing: "live",
			tool_output: "late contents",
			duration_ms: 40,
			nested_status: "ok",
		});
	});

	/**
	 * The nested call is still running when the tool result is persisted and a
	 * backfill runs; its live end arrives afterwards.
	 */
	async function lateEndAfterBackfill(
		makeSink: (db: KernelDatabase) => { sink: TraceWriterSink; flush: () => Promise<unknown> },
	) {
		const { db, dir } = await openTraceDb();
		const { sink, flush } = makeSink(db);
		const { sm, deliver } = makeHarness({ traceWriter: sink });
		const endOf = async () =>
			ofCall(await getTraceEventsForRun(db, RUN_ID), "c/1", "tool_call_end");

		await deliver([
			...codemodeOpening(),
			nestedStart("c/1", "read", { path: "a.ts" }),
			CODEMODE_END,
			codemodeResult([{ id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "unfinished" }]),
		]);
		await flush();
		await backfillInto(db, dir, sm);
		const endsAfterBackfill = await endOf();

		await deliver([nestedEnd("c/1", "read", "late contents"), TURN_END, AGENT_END]);
		await flush();
		const rows = await getTraceEventsForRun(db, RUN_ID);
		return {
			endsAfterBackfill,
			starts: ofCall(rows, "c/1", "tool_call_start"),
			ends: ofCall(rows, "c/1", "tool_call_end"),
		};
	}

	test("backfill first, live end later: the approximate end is promoted", async () => {
		const outcomes: Array<{ eventId: string; outcome: string }> = [];
		const result = await lateEndAfterBackfill((db) => {
			let tail: Promise<unknown> = Promise.resolve();
			const sink: TraceWriterSink = {
				submit: (e) => {
					tail = tail.then(() => insertTraceEventsBatch(db, [e]));
				},
				submitPromotable: (e) => {
					tail = tail.then(async () => {
						outcomes.push({ eventId: e.eventId, outcome: await upsertPromotableTraceEvent(db, e) });
					});
				},
			};
			return { sink, flush: () => tail };
		});

		expect(result.endsAfterBackfill.map((e) => data(e))).toMatchObject([
			{ timing: "approximate", nested_status: "unfinished" },
		]);
		expect(outcomes).toEqual([
			{ eventId: nestedToolEventId(PI_UUID, "c/1", "tool_call_end"), outcome: "promoted" },
		]);
		expect(result.ends).toHaveLength(1);
		expect(data(result.ends[0]!)).toMatchObject({
			timing: "live",
			tool_output: "late contents",
			nested_status: "ok",
		});
	});

	test("default sink promotes; a submit-only custom sink compiles, works, and keeps the approximate row", async () => {
		const promoted = await lateEndAfterBackfill((db) => {
			const writer = createDbTraceWriter(db);
			return { sink: writer, flush: () => writer.flush() };
		});
		expect(promoted.ends).toHaveLength(1);
		expect(data(promoted.ends[0]!)).toMatchObject({ timing: "live", tool_output: "late contents" });

		// A caller-supplied sink without submitPromotable: no cast anywhere, the
		// emitter falls back to submit, and live rows still land.
		const kept = await lateEndAfterBackfill((db) => {
			let tail: Promise<unknown> = Promise.resolve();
			const sink: TraceWriterSink = {
				submit: (e) => {
					tail = tail.then(() => insertTraceEventsBatch(db, [e]));
				},
			};
			return { sink, flush: () => tail };
		});
		expect(kept.starts.map((e) => data(e).timing)).toEqual(["live"]);
		expect(kept.ends).toHaveLength(1);
		expect(data(kept.ends[0]!)).toMatchObject({ timing: "approximate", nested_status: "unfinished" });
	});

	test("a nested call still open at agent_end ends unfinished; a later live end still goes out", async () => {
		const { sink, calls } = recordingSink();
		const { deliver } = makeHarness({ traceWriter: sink });
		await deliver(
			codemodeRun(
				[nestedStart("c/1", "read", { path: "a.ts" })],
				[{ id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "unfinished" }],
			),
		);

		const closeIndex = calls.findIndex(
			(c) => c.event.type === "tool_call_end" && data(c.event).tool_use_id === "c/1",
		);
		expect(closeIndex).toBeGreaterThan(-1);
		expect(closeIndex).toBeLessThan(calls.findIndex((c) => c.event.type === "pi_agent_end"));
		expect(calls[closeIndex]!.via).toBe("submitPromotable");
		expect(data(calls[closeIndex]!.event)).toMatchObject({
			parent_tool_use_id: "c",
			nested: true,
			nested_status: "unfinished",
			is_error: true,
			timing: "approximate",
		});

		// The dangling call finishes after the loop: its live end is emitted to promote the row.
		await deliver([nestedEnd("c/1", "read", "late contents")]);
		const ends = calls.filter(
			(c) => c.event.type === "tool_call_end" && data(c.event).tool_use_id === "c/1",
		);
		expect(ends.map((c) => [c.via, data(c.event).timing])).toEqual([
			["submitPromotable", "approximate"],
			["submitPromotable", "live"],
		]);
		expect(ends[1]!.event.eventId).toBe(ends[0]!.event.eventId);
	});

	test("calls the tool result records but the emitter never saw run get backfill's rows", async () => {
		const { sm, submitted, deliver } = makeHarness();
		await deliver(
			codemodeRun(
				[nestedStart("c/1", "read", { path: "a.ts" }), nestedEnd("c/1", "read", "file contents")],
				[
					{ id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "ok", durationMs: 3 },
					{ id: "c/2", name: "ls", arguments: { path: "." }, status: "ok", durationMs: 7 },
				],
			),
		);

		const recordedOnly = ofCall(submitted, "c/2");
		expect(recordedOnly.map((e) => [e.type, data(e).timing])).toEqual([
			["tool_call_start", "approximate"],
			["tool_call_end", "approximate"],
		]);
		const resultEntry = sm.entries.find(
			(e) => e.type === "message" && (e.message as { role?: string }).role === "toolResult",
		)!;
		expect(recordedOnly[1]!.timestamp).toBe(resultEntry.timestamp);
		// Exactly the rows backfill builds for the same entry.
		expect(recordedOnly).toEqual(ofCall(mapTranscript(sm), "c/2"));
		// The call seen live keeps only its live rows.
		expect(ofCall(submitted, "c/1").map((e) => data(e).timing)).toEqual(["live", "live"]);
	});

	test("a parentToolCallId that disagrees with the id keeps the id-derived parent and logs ids only", async () => {
		const warnings: Array<{ message: string; data?: Record<string, unknown> }> = [];
		const { submitted, deliver } = makeHarness({
			logger: { warn: (message, data) => warnings.push({ message, data }) },
		});
		await deliver([
			{ ...nestedStart("c/1/1", "read", { path: "secret.ts" }), parentToolCallId: "c" },
			{ ...nestedEnd("c/1/1", "read", "contents"), parentToolCallId: "c" },
		]);

		expect(submitted.map((e) => data(e).parent_tool_use_id)).toEqual(["c/1", "c/1"]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]!.data).toEqual({
			piSessionUuid: PI_UUID,
			toolCallId: "c/1/1",
			parentToolCallId: "c",
		});
	});

	test("doctor invariant 5 holds with nested pairs", async () => {
		const { db, dir } = await openTraceDb();
		const writer = createDbTraceWriter(db);
		const { sm, emitter, deliver } = makeHarness({ traceWriter: writer });
		emitter.emitSessionStart();
		await deliver(
			codemodeRun(
				[
					nestedStart("c/1", "read", { path: "a.ts" }),
					nestedEnd("c/1", "read", "file contents"),
					// Still running when the loop ends.
					nestedStart("c/3", "bash", { command: "sleep 9" }),
				],
				[
					{ id: "c/1", name: "read", arguments: { path: "a.ts" }, status: "ok", durationMs: 1 },
					// Recorded only: never seen live.
					{ id: "c/2", name: "ls", arguments: { path: "." }, status: "ok", durationMs: 1 },
					{ id: "c/3", name: "bash", arguments: { command: "sleep 9" }, status: "unfinished" },
				],
			),
		);
		await writer.flush();
		await backfillInto(db, dir, sm);
		const endedAt = new Date().toISOString();
		await updateAgentRunStatus(db, RUN_ID, "done", { endedAt });
		await updatePiAgentSessionStatus(db, PI_UUID, "ended", endedAt);

		const nested = nestedOnly(await getTraceEventsForRun(db, RUN_ID));
		for (const id of ["c/1", "c/2", "c/3"]) {
			expect(ofCall(nested, id).map((e) => e.type).sort()).toEqual([
				"tool_call_end",
				"tool_call_start",
			]);
		}
		const report = await runTraceDoctor(db);
		expect(report.violations.filter((v) => v.invariant === 5)).toEqual([]);
		expect(report.ok).toBe(true);
	});
});
