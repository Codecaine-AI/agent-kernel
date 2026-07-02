import type { RuntimeState } from "../../context";

export function makeRuntimeState(
	workingDir: string,
	containerId?: string,
	sessionDir?: string,
): RuntimeState {
	return {
		containerId,
		platform: process.platform,
		topic: "",
		phase: "",
		status: "",
		sessionDir: sessionDir ?? "",
		cwd: workingDir,
		priorSessions: [],
	};
}
