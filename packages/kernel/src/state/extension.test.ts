/**
 * extension.test.ts — the kernel's side of the contract.
 *
 * Covers the two properties the design leans on: catch-up is idempotent (a
 * context hook immediately after turn_end folds nothing and leaves the state
 * object identical), and an agent that asked for nothing gets a complete
 * pass-through.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { isKernelAuthoredMessage } from "@agent-kernel/protocol";

import type { SpawnContext } from "../context";
import {
	KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE,
	KERNEL_STATE_MESSAGE_CUSTOM_TYPE,
} from "./kernel-messages";
import {
	createStateExtension,
	deriveEvents,
	stateExtensionEnabled,
	type StateExtensionHandle,
} from "./extension";
import { createFileStateSink, createMemoryStateSink, stateFilePath } from "./store";
import type { AgentMessage, SessionEvent, StateModule, StateSnapshot } from "./types";

// ─── Harness ───────────────────────────────────────────────────────────────

const SPAWN_CONTEXT: SpawnContext = {
	agentName: "state-agent",
	variables: { topic: "auth" },
	caller: { kind: "user", id: "test" },
	runtime: { cwd: "/tmp", containerId: "container-1" },
	paths: { workingDir: "/tmp", activeSessionDir: "/tmp/active_session" },
};

type Handler = (event: any, ctx?: any) => any;

function fakePi(): { pi: any; emit: (type: string, event?: any) => any[] } {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(type: string, handler: Handler) {
			const list = handlers.get(type) ?? [];
			list.push(handler);
			handlers.set(type, list);
		},
	};
	return {
		pi,
		emit(type, event = {}) {
			return (handlers.get(type) ?? []).map((h) => h({ type, ...event }));
		},
	};
}

function user(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: 1,
	} as unknown as AgentMessage;
}

function assistantCall(id: string, name = "read"): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: { path: "/x" } }],
		stopReason: "toolUse",
		timestamp: 1,
	} as unknown as AgentMessage;
}

function toolResult(id: string, isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		isError,
		content: [{ type: "text", text: "contents" }],
		timestamp: 1,
	} as unknown as AgentMessage;
}

/** A recording state module so tests can see exactly what `update` got. */
interface RecordedState {
	seededWith: string;
	events: SessionEvent[];
}

function recordingModule(): StateModule<RecordedState> {
	return {
		seed: (ctx, prior) =>
			prior ?? { seededWith: ctx.agentName, events: [] },
		update: (state, event) => ({ ...state, events: [...state.events, event] }),
		render: (state) => ({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: `<state events="${state.events.length}"/>` },
					],
					timestamp: 1,
				} as unknown as AgentMessage,
			],
			stateMessageCount: 1,
		}),
	};
}

function setup(
	overrides: Parameters<typeof createStateExtension>[0] extends never
		? never
		: Partial<Parameters<typeof createStateExtension<any>>[0]> = {},
): {
	handle: StateExtensionHandle<any>;
	emit: (type: string, event?: any) => any[];
	messages: AgentMessage[];
} {
	const messages: AgentMessage[] = [];
	const handle = createStateExtension<any>({
		agentName: "state-agent",
		containerId: "container-1",
		spawnContext: SPAWN_CONTEXT,
		...overrides,
	});
	const { pi, emit } = fakePi();
	handle.factory(pi);
	handle.bindSession({ messages });
	return { handle, emit, messages };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("state extension — activation", () => {
	test("neither a state module nor window config means no extension at all", () => {
		expect(stateExtensionEnabled({})).toBe(false);
		expect(stateExtensionEnabled({ module: null, window: null })).toBe(false);
	});

	test("a state module or a window config activates it", () => {
		expect(stateExtensionEnabled({ window: { maxTurns: 4 } })).toBe(true);
		expect(stateExtensionEnabled({ module: recordingModule() })).toBe(true);
	});
});

describe("state extension — event derivation", () => {
	test("a user message derives one user_message event", () => {
		expect(deriveEvents(user("hello"), 3)).toEqual([
			{ kind: "user_message", messageIndex: 3, text: "hello", imageCount: 0 },
		]);
	});

	test("an assistant message derives one tool_call per toolCall block", () => {
		const message = {
			role: "assistant",
			content: [
				{ type: "text", text: "working" },
				{ type: "toolCall", id: "a", name: "read", arguments: { path: "/a" } },
				{ type: "toolCall", id: "b", name: "grep", arguments: {} },
			],
		} as unknown as AgentMessage;
		expect(deriveEvents(message, 1).map((e) => e.kind)).toEqual([
			"tool_call",
			"tool_call",
		]);
	});

	test("a toolResult derives one tool_result event carrying isError", () => {
		expect(deriveEvents(toolResult("a", true), 2)).toEqual([
			{
				kind: "tool_result",
				messageIndex: 2,
				toolCallId: "a",
				toolName: "read",
				isError: true,
				text: "contents",
				imageCount: 0,
			},
		]);
	});

	test("transcript furniture derives nothing", () => {
		const custom = {
			role: "custom",
			customType: "agent-context",
			content: "…",
		} as unknown as AgentMessage;
		expect(deriveEvents(custom, 0)).toEqual([]);
	});
});

describe("state extension — catch-up idempotence", () => {
	test("a context hook right after turn_end folds nothing and keeps state identity", () => {
		const module = recordingModule();
		const { handle, emit, messages } = setup({ module });

		messages.push(user("go"), assistantCall("tc1"), toolResult("tc1"));
		emit("message_end");
		emit("turn_end", { turnIndex: 0, message: { stopReason: "toolUse" } });

		const afterTurn = handle.getState() as RecordedState;
		expect(afterTurn.events.map((e) => e.kind)).toEqual([
			"user_message",
			"tool_call",
			"tool_result",
			"turn_end",
		]);

		// The catch-up pass in the context hook must be a no-op when current.
		emit("context", { messages });
		expect(handle.getState()).toBe(afterTurn);
		expect(handle.catchUp(messages)).toBe(0);
		expect(handle.catchUp(messages)).toBe(0);
		expect(handle.getState()).toBe(afterTurn);
	});

	test("catch-up folds events the blocking hooks never saw", () => {
		const { handle, emit, messages } = setup({ module: recordingModule() });
		// Nothing emitted: the messages appeared out-of-band (resume, replay).
		messages.push(user("go"), assistantCall("tc1"));
		emit("context", { messages });

		const state = handle.getState() as RecordedState;
		expect(state.events.map((e) => e.kind)).toEqual([
			"user_message",
			"tool_call",
		]);
		expect(handle.catchUp(messages)).toBe(0);
	});

	test("seq numbers are monotonic and messageIndex tracks the transcript", () => {
		const { handle, emit, messages } = setup({ module: recordingModule() });
		messages.push(user("a"), assistantCall("tc1"), toolResult("tc1"));
		emit("message_end");
		const events = (handle.getState() as RecordedState).events;
		expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
		expect(events.map((e) => e.messageIndex)).toEqual([0, 1, 2]);
	});

	test("a shrinking branch re-anchors instead of re-folding history", () => {
		const { handle, emit, messages } = setup({ module: recordingModule() });
		messages.push(user("a"), user("b"), user("c"));
		emit("message_end");
		expect((handle.getState() as RecordedState).events).toHaveLength(3);

		messages.length = 1;
		expect(handle.catchUp(messages)).toBe(0);
		expect((handle.getState() as RecordedState).events).toHaveLength(3);
	});
});

describe("state extension — the base agent", () => {
	test("with a roomy window the request is the transcript, untouched", () => {
		const { emit, messages } = setup({ window: { maxTurns: 100 } });
		messages.push(user("q1"), assistantCall("tc1"), toolResult("tc1"));

		const [result] = emit("context", { messages });
		expect(result.messages).toHaveLength(3);
		// Same objects, same order: a complete pass-through.
		expect(result.messages[0]).toBe(messages[0]);
		expect(result.messages[1]).toBe(messages[1]);
		expect(result.messages[2]).toBe(messages[2]);
	});

	test("a bounded window cuts on a turn boundary and marks the elision once", () => {
		const { handle, emit, messages } = setup({
			window: { strategy: "turns", maxTurns: 2 },
		});
		for (let i = 1; i <= 6; i += 1) {
			messages.push(user(`q${i}`), {
				role: "assistant",
				content: [{ type: "text", text: `a${i}` }],
				timestamp: 1,
			} as unknown as AgentMessage);
		}
		const [result] = emit("context", { messages });
		const first = result.messages[0] as unknown as {
			content: Array<{ text: string }>;
		};
		expect(first.content[0].text).toBe("[turns 1–4 elided]");
		expect(result.messages).toHaveLength(5);
		expect(handle.lastRequest()?.sections).toEqual([
			{ kind: "state", start: 0, end: 1 },
			{ kind: "tail", start: 1, end: 5 },
		]);
	});

	test("the elision marker is kernel-authored, so the viewer never badges it USER", () => {
		const { emit, messages } = setup({
			window: { strategy: "turns", maxTurns: 1 },
		});
		messages.push(user("q1"), user("q2"), user("q3"));
		const [result] = emit("context", { messages });
		const marker = result.messages[0] as unknown as Record<string, unknown>;
		expect(marker.role).toBe("custom");
		expect(marker.customType).toBe(KERNEL_STATE_MESSAGE_CUSTOM_TYPE);
		expect(isKernelAuthoredMessage(marker)).toBe(true);
		// The conversation it wraps is untouched user turns.
		expect(
			(result.messages[1] as unknown as Record<string, unknown>).role,
		).toBe("user");
	});

	test("base state counts events without shaping the request", () => {
		const { handle, emit, messages } = setup({ window: { maxTurns: 10 } });
		messages.push(user("q"), assistantCall("tc1"), toolResult("tc1", true));
		emit("message_end");
		emit("turn_end", { turnIndex: 0, message: { stopReason: "toolUse" } });
		expect(handle.getState()).toEqual({
			kind: "base",
			turns: 1,
			userMessages: 1,
			toolCalls: 1,
			toolErrors: 1,
			lastEventSeq: 3,
		});
	});
});

describe("state extension — the three-section request", () => {
	test("the context message leads and the sections tile the request", () => {
		const { handle, emit, messages } = setup({
			module: recordingModule(),
			contextEntries: [{ id: "caps", content: "op reference" }],
		});
		messages.push(user("go"));
		const [result] = emit("context", { messages });

		expect(result.messages).toHaveLength(2);
		const contextBlock = result.messages[0] as unknown as {
			role: string;
			customType: string;
			content: Array<{ text: string }>;
		};
		expect(contextBlock.content[0].text).toContain("op reference");
		expect(contextBlock.role).toBe("custom");
		expect(contextBlock.customType).toBe(KERNEL_CONTEXT_MESSAGE_CUSTOM_TYPE);
		expect(handle.lastRequest()?.sections).toEqual([
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 2 },
		]);
	});

	test("the state block is a single text block, so the viewer can detect it", () => {
		const { emit, messages } = setup({ module: recordingModule() });
		messages.push(user("go"));
		const [result] = emit("context", { messages });
		const stateBlock = result.messages[0] as unknown as {
			content: Array<{ type: string; text: string }>;
		};
		expect(stateBlock.content).toHaveLength(1);
		expect(stateBlock.content[0].type).toBe("text");
		expect(stateBlock.content[0].text.startsWith("<state")).toBe(true);
	});

	test("every built request reaches the onRequestBuilt listeners", () => {
		const { handle, emit, messages } = setup({ window: { maxTurns: 10 } });
		const seen: number[] = [];
		handle.onRequestBuilt((built) => seen.push(built.messages.length));
		messages.push(user("q"));
		emit("context", { messages });
		emit("context", { messages });
		expect(seen).toEqual([1, 1]);
	});

	test("a throwing renderer passes the request through untouched", () => {
		const exploding: StateModule<null> = {
			seed: () => null,
			update: (s) => s,
			render: () => {
				throw new Error("boom");
			},
		};
		const errors: string[] = [];
		const { emit, messages } = setup({
			module: exploding,
			logger: { error: (message) => errors.push(message) },
		});
		messages.push(user("q"));
		const [result] = emit("context", { messages });
		expect(result).toBeUndefined();
		expect(errors).toContain("agent state context failed");
	});
});

describe("state extension — seeding", () => {
	test("seed gets the same SpawnContext the loaders get", () => {
		const seen: SpawnContext[] = [];
		setup({
			module: {
				seed: (ctx) => {
					seen.push(ctx);
					return {};
				},
				update: (s) => s,
				render: () => [],
			},
		});
		expect(seen).toEqual([SPAWN_CONTEXT]);
		expect(seen[0]).toBe(SPAWN_CONTEXT);
	});

	test("an explicitly passed prior state is handed to seed; nothing auto-loads", () => {
		const prior: RecordedState = { seededWith: "earlier-run", events: [] };
		const { handle } = setup({ module: recordingModule(), priorState: prior });
		expect((handle.getState() as RecordedState).seededWith).toBe("earlier-run");
	});
});

describe("state extension — persistence", () => {
	test("turn_end snapshots the state and agent_settled flushes", async () => {
		const sink = createMemoryStateSink();
		const { handle, emit, messages } = setup({
			module: recordingModule(),
			sink,
		});
		messages.push(user("q"));
		emit("turn_end", { turnIndex: 0, message: { stopReason: "stop" } });
		emit("agent_settled");
		await handle.flush();

		expect(sink.snapshots).toHaveLength(2);
		expect(sink.snapshots[0].version).toBe(1);
		expect(sink.snapshots[1].version).toBe(2);
		expect(sink.snapshots[0].containerId).toBe("container-1");
		expect(sink.snapshots[0].agentName).toBe("state-agent");
	});

	test("state.json lands on disk and JSON-round-trips", async () => {
		const root = mkdtempSync(join(tmpdir(), "agent-kernel-state-"));
		try {
			const { handle, emit, messages } = setup({
				module: recordingModule(),
				runId: "run-9",
				sink: createFileStateSink({ root }),
			});
			messages.push(user("q"), assistantCall("tc1"));
			emit("message_end");
			emit("turn_end", { turnIndex: 0, message: { stopReason: "toolUse" } });
			await handle.flush();

			const path = stateFilePath(root, "container-1", "state-agent");
			const parsed = JSON.parse(readFileSync(path, "utf8")) as StateSnapshot;
			expect(parsed.agentName).toBe("state-agent");
			expect(parsed.runId).toBe("run-9");
			expect(parsed.version).toBe(1);
			expect(new Date(parsed.updatedAt).toString()).not.toBe("Invalid Date");

			const state = parsed.state as RecordedState;
			expect(state.seededWith).toBe("state-agent");
			expect(state.events.map((e) => e.kind)).toEqual([
				"user_message",
				"tool_call",
				"turn_end",
			]);
			// The written state IS the live state, byte for byte.
			expect(parsed.state).toEqual(
				JSON.parse(JSON.stringify(handle.getState())),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("no sink means no persistence and no failure", async () => {
		const { handle, emit } = setup({ window: { maxTurns: 4 } });
		emit("turn_end", { turnIndex: 0, message: {} });
		await handle.flush();
		expect(handle.getState()).toBeTruthy();
	});

	test("non-serializable state is reported, not thrown", async () => {
		const errors: string[] = [];
		const root = mkdtempSync(join(tmpdir(), "agent-kernel-state-bad-"));
		try {
			const cyclic: Record<string, unknown> = {};
			cyclic.self = cyclic;
			const { handle, emit } = setup({
				module: {
					seed: () => cyclic,
					update: (s) => s,
					render: () => [],
				},
				sink: createFileStateSink({
					root,
					logger: { error: (message) => errors.push(message) },
				}),
			});
			emit("turn_end", { turnIndex: 0, message: {} });
			await handle.flush();
			expect(errors).toContain("agent state serialize failed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
