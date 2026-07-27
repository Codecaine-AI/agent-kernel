/**
 * tools/index.ts — one deterministic private tool so every run produces a real
 * assistant toolCall + toolResult pair in the transcript (the pair the window
 * must never split).
 */
import { defineTools } from "@agent-kernel/kernel/agent-definition";
import { Type } from "@earendil-works/pi-ai";

export const tools = defineTools((pi) => {
	pi.registerTool({
		name: "probe",
		label: "Probe",
		description: "Echo a note back verbatim. Deterministic, no side effects.",
		parameters: Type.Object({
			note: Type.String(),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const note = String((params as { note?: unknown }).note ?? "");
			return {
				content: [{ type: "text" as const, text: `probe → ${note}` }],
				details: { note },
			};
		},
	});
});

export default tools;
