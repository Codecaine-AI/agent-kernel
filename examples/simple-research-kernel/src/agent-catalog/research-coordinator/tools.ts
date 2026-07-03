import { defineTools } from "@agent-kernel/kernel/agent-definition";

import {
	createSpawnScoutsTool,
	queueReportWriterTool,
	registerReadContextTool,
	registerReviewReportsTool,
	type SimpleResearchToolRuntime,
} from "../tool-runtime";

export const tools = defineTools<SimpleResearchToolRuntime>((pi, runtime) => {
	registerReadContextTool(pi, runtime);
	// Spawner tools (D77): each declares the exact agents it may dispatch;
	// the kernel binds the scoped dispatch handle at session build time.
	pi.registerTool(createSpawnScoutsTool("spawn_research_scouts"));
	registerReviewReportsTool(pi, runtime);
	pi.registerTool(createSpawnScoutsTool("spawn_followup_scouts"));
	pi.registerTool(queueReportWriterTool);
});

export default tools;
