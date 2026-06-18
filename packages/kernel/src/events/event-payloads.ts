import type {
	ContextBuildCompletedData,
	ContextBuildStartedData,
	ContextInputResolvedData,
	SystemPromptResolvedData,
} from "@agent-kernel/protocol";

export type SystemPromptResolvedInput = SystemPromptResolvedData;
export type ContextBuildStartedInput = ContextBuildStartedData;
export type ContextInputResolvedInput = ContextInputResolvedData;
export type ContextBuildCompletedInput = ContextBuildCompletedData;

export type {
	ContextBuildCompletedData,
	ContextBuildStartedData,
	ContextInputResolvedData,
	SystemPromptResolvedData,
};
