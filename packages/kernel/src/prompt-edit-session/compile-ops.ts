/**
 * Compatibility surface for Kernel prompt-edit sessions.
 *
 * The pure ID-relative compiler now lives in Prompt Kit so the Kernel and MCP
 * paths compile the same operations. Keep this module so existing Kernel
 * imports and its public subpath remain stable.
 */
export {
	compilePromptEditOps,
	parsePromptEditOps,
} from "@codecaine-ai/prompt-kit/authoring";
export type {
	CompilePromptEditOpsFailure,
	CompilePromptEditOpsResult,
	CompilePromptEditOpsSuccess,
	ParsePromptEditOpsResult,
} from "@codecaine-ai/prompt-kit/authoring";
