import { defineAgent } from "@agent-kernel/kernel/agent-definition";

import { context } from "./context";
import { prompt } from "./prompt";
import { tools } from "./tools";

export default defineAgent({
	name: "report-writer",
	description:
		"Synthesizes scout reports and source context into a complete markdown research report.",
	model: "codex-lb/gpt-5.5",
	extensions: false,
	canSpawnSubagent: false,
	thinking: "low",
	variables: {
		researchMemoryDir: {
			default: "research-memory",
			description:
				"Directory inside the active research session where reports are written.",
		},
		focus: {
			default: "",
			description: "Report focus assigned by the coordinator.",
		},
	},
	prompt,
	context,
	tools,
});
