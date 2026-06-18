import type { AgentSession } from "@mariozechner/pi-coding-agent";

export const DEFAULT_PI_LIFECYCLE_CUSTOM_TYPE = "kernel:pi-lifecycle";

export type PiLifecyclePhase =
	| "agent_start"
	| "agent_end"
	| "turn_start"
	| "turn_end";

type SessionManagerWithAppend = {
	appendCustomEntry(customType: string, data?: unknown): string;
};

export function attachPiLifecycleLogger(
	session: AgentSession,
	customType = DEFAULT_PI_LIFECYCLE_CUSTOM_TYPE,
): () => void {
	const sm = session.sessionManager as unknown as SessionManagerWithAppend;
	let turnIndex = 0;

	const unsubscribe = session.subscribe((event) => {
		switch (event.type) {
			case "agent_start":
				turnIndex = 0;
				sm.appendCustomEntry(customType, {
					phase: "agent_start",
				});
				break;
			case "agent_end": {
				const messages = (event as { messages?: unknown[] }).messages ?? [];
				const last = messages[messages.length - 1] as
					| { usage?: { input?: number; output?: number } }
					| undefined;
				sm.appendCustomEntry(customType, {
					phase: "agent_end",
					inputTokens: last?.usage?.input,
					outputTokens: last?.usage?.output,
				});
				break;
			}
			case "turn_start":
				sm.appendCustomEntry(customType, {
					phase: "turn_start",
					turnIndex,
				});
				break;
			case "turn_end": {
				const msg = (event as { message?: { stopReason?: string } }).message;
				sm.appendCustomEntry(customType, {
					phase: "turn_end",
					turnIndex,
					stopReason: msg?.stopReason,
				});
				turnIndex += 1;
				break;
			}
			default:
				break;
		}
	});

	return unsubscribe;
}
