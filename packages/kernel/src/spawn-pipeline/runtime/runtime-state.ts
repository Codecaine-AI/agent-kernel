import type { RuntimeState } from "../../context";

export function makeRuntimeState(
	workingDir: string,
	appSessionId?: string,
): RuntimeState {
	return {
		appSessionId,
		platform: process.platform,
		topic: "",
		phase: "",
		status: "",
		appSessionDir: "",
		cwd: workingDir,
		priorSessions: [],
	};
}
