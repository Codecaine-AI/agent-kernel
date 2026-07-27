import { defineTools } from "@agent-kernel/kernel/agent-definition";

import {
	registerReadContextTool,
	registerWriteResearchReportTool,
	type SimpleResearchToolRuntime,
} from "../../tool-runtime";

export const tools = defineTools<SimpleResearchToolRuntime>((pi, runtime) => {
	registerReadContextTool(pi, runtime);
	registerWriteResearchReportTool(pi, runtime);
});

export default tools;
