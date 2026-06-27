import { defineAgent } from "@agent-kernel/kernel/agent-definition";

import { context } from "./context";
import { prompt } from "./prompt";
import { tools } from "./tools";

export default defineAgent({
	name: "source-scout",
	description:
		"Investigates one focused angle, reads local evidence, and writes a durable research note.",
	model: "codex-lb/gpt-5.5",
	extensions: false,
	canSpawnSubagent: false,
	thinking: "low",
	variables: {
		researchMemoryDir: {
			default: "research-memory",
			description:
				"Directory inside the active research session where scout reports are stored.",
		},
		focus: {
			default: "",
			description: "Focus assigned by the coordinator.",
		},
	},
	prompt,
	context,
	tools,
});
