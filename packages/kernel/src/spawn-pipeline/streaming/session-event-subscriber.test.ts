import { describe, expect, test } from "bun:test";

import type { KernelEmitter } from "../../emitter";
import type { KernelAgentSessionEventLike, KernelAgentSessionLike } from "../types";
import { subscribeToSession } from "./session-event-subscriber";

/** A session whose subscription the test drives directly. */
function fakeSession() {
	let listener: ((event: KernelAgentSessionEventLike) => void) | undefined;
	const session: KernelAgentSessionLike = {
		messages: [],
		prompt: async () => undefined,
		sendCustomMessage: async () => undefined,
		steer: async () => undefined,
		abort: () => {},
		subscribe(l) {
			listener = l;
			return () => {
				listener = undefined;
			};
		},
	};
	return {
		session,
		emit: (event: Record<string, unknown>) => listener?.(event as KernelAgentSessionEventLike),
	};
}

/** An emitter stub that records the event types it was fed. */
function recordingEmitter(seen: string[]): KernelEmitter {
	return {
		emitSessionStart: () => {},
		handleEvent: (event) => {
			seen.push(event.type);
		},
		settle: async () => {},
		inboundEventId: () => undefined,
		outboundEventId: () => undefined,
		runUsage: () => undefined,
	};
}

describe("subscribeToSession", () => {
	test("onToolActivity ignores nested calls", () => {
		const { session, emit } = fakeSession();
		const activity: Array<{ type: "start" | "end"; toolName: string }> = [];
		const fedToEmitter: string[] = [];
		const sub = subscribeToSession(
			session,
			{ onToolActivity: (a) => activity.push(a) },
			undefined,
			recordingEmitter(fedToEmitter),
		);

		emit({ type: "tool_execution_start", toolCallId: "c", toolName: "codemode", args: {} });
		emit({
			type: "tool_execution_start",
			toolCallId: "c/1",
			toolName: "read",
			args: {},
			parentToolCallId: "c",
		});
		emit({
			type: "tool_execution_end",
			toolCallId: "c/1",
			toolName: "read",
			result: { content: [] },
			isError: false,
			parentToolCallId: "c",
		});
		emit({
			type: "tool_execution_end",
			toolCallId: "c",
			toolName: "codemode",
			result: { content: [] },
			isError: false,
		});
		sub.unsub();

		// Only the agent's own call counts as tool activity…
		expect(activity).toEqual([
			{ type: "start", toolName: "codemode" },
			{ type: "end", toolName: "codemode" },
		]);
		// …while the emitter still sees the nested events it turns into spans.
		expect(fedToEmitter).toEqual([
			"tool_execution_start",
			"tool_execution_start",
			"tool_execution_end",
			"tool_execution_end",
		]);
	});
});
