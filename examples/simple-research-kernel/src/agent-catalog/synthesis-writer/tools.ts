import { defineTools } from "@agent-kernel/kernel/agent-definition";

import {
	registerReadContextTool,
	registerWriteReportTool,
	type SimpleResearchToolRuntime,
} from "../tool-runtime";

export const tools = defineTools<SimpleResearchToolRuntime>((pi, runtime) => {
	registerReadContextTool(pi, runtime);
	registerWriteReportTool(pi, runtime);
});

export default tools;
