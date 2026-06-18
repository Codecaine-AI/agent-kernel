import type { KernelAgentSessionLike, KernelSpawnRuntimeOptions } from "../types";

export const DEFAULT_RESUME_TRIGGER_CUSTOM_TYPE = "kernel:ask-resume";

export function triggerRun(
	session: Pick<KernelAgentSessionLike, "prompt" | "sendCustomMessage">,
	prompt: string,
	opts: KernelSpawnRuntimeOptions,
): Promise<unknown> {
	if (!opts.resumeFromToolResult) return session.prompt(prompt);
	return session.sendCustomMessage(
		{
			customType: opts.resumeTriggerCustomType ?? DEFAULT_RESUME_TRIGGER_CUSTOM_TYPE,
			content: "",
			display: false,
		},
		{ triggerTurn: true },
	);
}
