import type { KernelEmitter } from "../../emitter";
import { getGraceTurns } from "../config/turn-limits";
import { getLastAssistantText } from "../trace/assistant-message-inspection";
import type {
	KernelAgentSessionEventLike,
	KernelAgentSessionLike,
	KernelSpawnResult,
	KernelSpawnRuntimeOptions,
} from "../types";

export interface SessionSubscription<TSession extends KernelAgentSessionLike> {
	unsub(): void;
	cleanupAbort(): void;
	readResult(): KernelSpawnResult<TSession>;
	/** True when the run was hard-aborted after exhausting maxTurns + grace. */
	turnLimitReached(): boolean;
}

export function subscribeToSession<TSession extends KernelAgentSessionLike>(
	session: TSession,
	opts: KernelSpawnRuntimeOptions,
	maxTurns: number | undefined,
	/** In-process kernel emitter fed from this same subscription (Phase 2). */
	emitter?: KernelEmitter,
): SessionSubscription<TSession> {
	let turnCount = 0;
	let softLimitReached = false;
	let turnLimitAborted = false;
	let aborted = false;
	let currentText = "";
	let lastAssistantText = "";

	const unsub = session.subscribe((event: KernelAgentSessionEventLike) => {
		// The emitter observes the event before any control action (turn-limit
		// steer/abort) mutates the session.
		emitter?.handleEvent(event);
		if (event.type === "turn_end") {
			turnCount++;
			opts.onTurnEnd?.(turnCount);
			if (maxTurns != null) {
				if (!softLimitReached && turnCount >= maxTurns) {
					softLimitReached = true;
					session.steer(
						"You have reached your turn limit. Wrap up immediately - provide your final answer now.",
					);
				} else if (softLimitReached && turnCount >= maxTurns + getGraceTurns()) {
					aborted = true;
					turnLimitAborted = true;
					session.abort();
				}
			}
		}
		if (event.type === "message_start") currentText = "";
		const evt = event as any;
		if (
			evt.type === "message_update" &&
			evt.assistantMessageEvent?.type === "text_delta"
		) {
			currentText += evt.assistantMessageEvent.delta;
			lastAssistantText = currentText;
			opts.onTextDelta?.(evt.assistantMessageEvent.delta);
		}
		if (event.type === "tool_execution_start") {
			opts.onToolActivity?.({ type: "start", toolName: String(evt.toolName) });
		}
		if (event.type === "tool_execution_end") {
			opts.onToolActivity?.({ type: "end", toolName: String(evt.toolName) });
		}
	});

	let cleanupAbort = () => {};
	if (opts.signal) {
		const onAbort = () => session.abort();
		opts.signal.addEventListener("abort", onAbort, { once: true });
		cleanupAbort = () => opts.signal?.removeEventListener("abort", onAbort);
	}

	return {
		unsub,
		cleanupAbort,
		readResult: () => ({
			responseText: lastAssistantText.trim() || getLastAssistantText(session),
			session,
			aborted,
		}),
		turnLimitReached: () => turnLimitAborted,
	};
}
