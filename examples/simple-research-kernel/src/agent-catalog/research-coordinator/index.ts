import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	registerQueueReportWriterTool,
	registerReadContextTool,
	registerReviewReportsTool,
	registerSpawnScoutsTool,
	type SimpleResearchToolRuntime
} from "../tool-runtime";

export function register(pi: ExtensionAPI, runtime?: SimpleResearchToolRuntime): void {
	registerReadContextTool(pi, runtime);
	registerSpawnScoutsTool(pi, "spawn_research_scouts", runtime);
	registerReviewReportsTool(pi, runtime);
	registerSpawnScoutsTool(pi, "spawn_followup_scouts", runtime);
	registerQueueReportWriterTool(pi, runtime);
}

export default { register };
