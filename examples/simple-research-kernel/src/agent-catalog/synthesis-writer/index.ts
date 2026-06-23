import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	registerReadContextTool,
	registerWriteReportTool,
	type SimpleResearchToolRuntime
} from "../tool-runtime";

export function register(pi: ExtensionAPI, runtime?: SimpleResearchToolRuntime): void {
	registerReadContextTool(pi, runtime);
	registerWriteReportTool(pi, runtime);
}

export default { register };
