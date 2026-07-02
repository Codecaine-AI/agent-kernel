import { defineAgent } from "@agent-kernel/kernel/agent-definition";

import { context } from "./context";
import { tools } from "./tools";

export default defineAgent({
	name: "research-coordinator",
	description:
		"Coordinates a research request, dispatches focused scouts, manages working memory, and returns a final report.",
	model: "codex-lb/gpt-5.5",
	extensions: false,
	canSpawnSubagent: true,
	thinking: "low",
	variables: {
		researchMemoryDir: {
			default: "research-memory",
			description:
				"Directory inside the active research session that stores the brief, scout reports, and final reports.",
		},
		phase: {
			default: "research",
			description: "Kernel phase label for trace grouping.",
		},
		userPrompt: {
			default: "",
			description: "Current operator request.",
		},
	},
	context,
	tools,
});
