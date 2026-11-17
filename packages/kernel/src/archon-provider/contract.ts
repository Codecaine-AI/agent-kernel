/**
 * The public types of `@codecaine-ai/agent-kernel/archon-provider`: a local
 * structural copy of the parts of Archon's provider contract the provider
 * uses, because `@archon/provider-contract` is not on npm. The subpath's
 * `types` condition points here, so a consumer such as the Archon fork
 * type-checks this file only, not the kernel behind it. The fork's
 * registration checks the provider with `satisfies IAgentProvider`, so a
 * drift fails its type check.
 */

export type ProviderFailureClass =
	| "auth"
	| "quota_exhausted"
	| "budget_exceeded"
	| "misconfigured"
	| "rate_limited"
	| "overloaded"
	| "transient"
	| "unknown";

export type AgentKernelChunk =
	| { type: "agent_message_chunk"; text: string }
	| {
			type: "result";
			sessionId?: string;
			text?: string;
			structuredOutput?: unknown;
			isError?: boolean;
			errors?: string[];
			failure?: { class: ProviderFailureClass; evidence: string };
	  }
	| { type: "settled" };

/** An `extract:` node of the fork: one BAML function of the workflow's pack. */
export interface ExtractModelNode {
	kind: "extract";
	function: string;
	tier: "fast" | "standard" | "strong";
	/** Extra calls after a parse failure or a schema miss. */
	retries: number;
}

/** A `decide:` node of the fork: one choice question on a classifier. */
export interface DecideModelNode {
	kind: "decide";
	question: string;
	/** Always holds `other`. */
	enum: string[];
	/** A Pi model ref, `typesafe/jev-1.13.0` unless the YAML names another. */
	classifier: string;
	threshold?: { minProbability: number; minMargin: number };
}

/** `nodeConfig.model_node`, set on the fork's extract and decide nodes. */
export type ModelNodeConfig = ExtractModelNode | DecideModelNode;

export interface AgentKernelSendQueryOptions {
	model?: string;
	abortSignal?: AbortSignal;
	outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
	/** `PACK_DIR` names the pack root of the workflow, or is empty outside a pack. */
	env?: Record<string, string>;
	assistantConfig?: Record<string, unknown>;
	/** Archon's raw node config. The provider reads only `model_node`. */
	nodeConfig?: { model_node?: unknown; [key: string]: unknown };
}

export interface AgentKernelCapabilities {
	backgroundWork: "reported" | "none" | "unobserved";
	sessionResume: boolean;
	sessionFork?: boolean;
	mcp: boolean;
	hooks: boolean;
	skills: boolean;
	plugins: boolean;
	agents: boolean;
	toolRestrictions: boolean;
	structuredOutput: "enforced" | "best-effort" | false;
	requiresAllPropertiesRequired: boolean;
	envInjection: boolean;
	costControl: boolean;
	costReporting: boolean;
	effortControl: boolean;
	fallbackModel: boolean;
	sandbox: boolean;
	settingSources: boolean;
	nativeTools: boolean;
	containerExec: boolean;
}

export interface AgentKernelProvider {
	checkCredential(request: unknown): Promise<{ state: "not_checked"; source: "native" }>;
	sendQuery(
		prompt: string,
		cwd: string,
		resumeSessionId?: string,
		options?: AgentKernelSendQueryOptions,
	): AsyncGenerator<AgentKernelChunk>;
	getType(): string;
	getCapabilities(): AgentKernelCapabilities;
}

/**
 * `structuredOutput: 'enforced'`: Archon re-asks only a best-effort provider,
 * so a bundle answer that misses the node's schema fails the node with no
 * re-ask. The bundle owns its own tools, state and model, so every
 * Archon-side feature flag is off. `envInjection` is off too: sendQuery reads
 * the trace tags from `options.env`, but no codebase variable reaches the bundle.
 */
export const AGENT_KERNEL_CAPABILITIES: AgentKernelCapabilities = {
	backgroundWork: "none",
	sessionResume: false,
	mcp: false,
	hooks: false,
	skills: false,
	plugins: false,
	agents: false,
	toolRestrictions: false,
	structuredOutput: "enforced",
	requiresAllPropertiesRequired: false,
	envInjection: false,
	costControl: false,
	costReporting: false,
	effortControl: false,
	fallbackModel: false,
	sandbox: false,
	settingSources: false,
	nativeTools: false,
	containerExec: false,
};

/** The output of a decide node, the fixed `output_format` of the fork's grammar. */
export interface DecideResult {
	choice: string;
	reason: string;
	probability: number;
	abstained: boolean;
}

/** Implemented in `./index.ts`, which checks its signature against this one. */
export declare function createAgentKernelProvider(opts: { root: string }): AgentKernelProvider;
