import { describe, expect, test } from "bun:test";

import { EventMapper } from "../transcript-recovery";
import type { PiEvent } from "../transcript-recovery";
import {
	piEntryEventId,
	type TraceEvent,
	type TurnUsage,
} from "@agent-kernel/protocol";

import { createKernelEmitter, type EmitterSessionEntryLike } from "./kernel-emitter";
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
}) {
	const sm = new FakeSessionManager();
	const submitted: TraceEvent[] = [];
	let turnIndex = 0;

	const emitter = createKernelEmitter({
		traceWriter: { submit: (e) => submitted.push(e) },
		ids: { containerId: CONTAINER_ID, runId: RUN_ID, piSessionUuid: PI_UUID },
		agentName: "researcher",
		model: "test/model-1",
		phase: "research",
		lifecycleCustomType: LIFECYCLE,
		sessionManager: sm,
		onTurnUsage: opts?.onTurnUsage,
		onInboundEvent: opts?.onInboundEvent,
		spawnerTools: opts?.spawnerTools,
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
