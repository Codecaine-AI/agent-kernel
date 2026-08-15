import { defineState } from "@agent-kernel/kernel/agent-definition";
import type { AgentMessage } from "@agent-kernel/kernel/state";

interface StateEchoState {
	notes: string[];
}

export const state = defineState<StateEchoState>({
	seed: (ctx) => ({ notes: [`seeded:${ctx.agentName}`] }),
	update: (state) => state,
	render: (state): AgentMessage[] => [
		{
			role: "user",
			content: [
				{ type: "text", text: `<state>\n${state.notes.join("\n")}\n</state>` },
			],
			timestamp: 0,
		} as AgentMessage,
	],
});

export default state;
