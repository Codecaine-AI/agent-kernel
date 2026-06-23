import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	registerReadContextTool,
	registerWriteResearchReportTool,
	type SimpleResearchToolRuntime
} from "../tool-runtime";

export function register(pi: ExtensionAPI, runtime?: SimpleResearchToolRuntime): void {
	registerReadContextTool(pi, runtime);
	registerWriteResearchReportTool(pi, runtime);
}

export default { register };
