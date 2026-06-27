import { defineTools } from "@agent-kernel/kernel/agent-definition";

import {
	registerQueueReportWriterTool,
	registerReadContextTool,
	registerReviewReportsTool,
	registerSpawnScoutsTool,
	type SimpleResearchToolRuntime,
} from "../tool-runtime";

export const tools = defineTools<SimpleResearchToolRuntime>((pi, runtime) => {
	registerReadContextTool(pi, runtime);
	registerSpawnScoutsTool(pi, "spawn_research_scouts", runtime);
	registerReviewReportsTool(pi, runtime);
	registerSpawnScoutsTool(pi, "spawn_followup_scouts", runtime);
	registerQueueReportWriterTool(pi, runtime);
});

export default tools;
