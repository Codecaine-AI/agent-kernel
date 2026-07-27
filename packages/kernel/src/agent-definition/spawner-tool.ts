/**
 * First-class spawner tools (D77).
 *
 * Agent platforms default to "everything can spawn general subagents"; this
 * kernel does not. Spawning happens through SPECIFIC tools: a spawner tool
 * declares the exact agent names it may dispatch (`spawns: ["source-scout"]`).
 * A deliberately general spawner is possible via `spawns: ["*"]`, but that is
 * a loud opt-in visible in the declaration, the registry harvest, and traces.
 *
 * `defineSpawnerTool` compiles the declaration into an ordinary
 * Pi-registerable tool — the same path `defineTools` registrations take. The
 * author's `execute` receives a kernel-injected, scoped `dispatch` handle
 * instead of raw spawn plumbing: the kernel binds it at session build time
 * (see subagents/spawner-binding.ts), enforcing the allowlist and forwarding
 * `parentToolUseId`, `trigger: "parent-tool"`, and the current run-context
 * identity automatically, so the tool author cannot get these wrong.
 */
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	ToolDefinition,
	ToolExecutionMode,
} from "@earendil-works/pi-coding-agent";

import type { AgentRecord } from "../subagents/types";

/** Wildcard entry granting dispatch of any catalog agent — a loud opt-in. */
export const SPAWNER_WILDCARD = "*";

/**
 * Marker property carried by compiled spawner tools. A plain (non-enumerable
 * would break spreads; symbol would break across duplicated module instances)
 * property, read by the registry harvest and the kernel binding.
 */
export const SPAWNER_TOOL_MARKER = "__agentKernelSpawner" as const;

export interface SpawnerDispatchOptions {
	/** Queue on the background lane instead of awaiting completion. */
	background?: boolean;
	/** Human description stored on the agent record. */
	description?: string;
	/** Display label stamped onto the spawned run. */
	displayLabel?: string;
	/** Prompt variables forwarded to the spawned agent. */
	variables?: Record<string, unknown>;
	/** Working directory override; defaults to the parent session's cwd. */
	workingDir?: string;
}

/**
 * Handle returned by a background dispatch. The record behind a queued
 * background spawn has no promise until it starts, so the handle carries a
 * `done` promise that ALWAYS exists and resolves with the final record when
 * the child actually completes (including queued and queued-then-aborted
 * children) — the sanctioned way to collect a background child's result.
 */
export interface SpawnerBackgroundHandle {
	id: string;
	agentName: string;
	/** Status at dispatch time: "queued" or "running". */
	status: AgentRecord["status"];
	/** Resolves with the final agent record once the child completes. */
	done: Promise<AgentRecord>;
}

/**
 * Scoped dispatch handle injected by the kernel. Enforces the tool's
 * `spawns` allowlist, validates the target exists in the agent catalog, and
 * auto-forwards parentToolUseId (the tool call id), trigger "parent-tool",
 * and run-context identity (containerId, parentRunId, sessionDir, phase,
 * piSessionsDir) captured at dispatch time — so queued background spawns
 * keep their own parent's identity regardless of when the queue drains.
 * Foreground dispatch resolves with the completed agent record;
 * `background: true` resolves immediately with a {@link SpawnerBackgroundHandle}.
 */
export interface SpawnerDispatch {
	(
		agentName: string,
		prompt: string,
		opts?: SpawnerDispatchOptions & { background?: false },
	): Promise<AgentRecord>;
	(
		agentName: string,
		prompt: string,
		opts: SpawnerDispatchOptions & { background: true },
	): Promise<SpawnerBackgroundHandle>;
	(
		agentName: string,
		prompt: string,
		opts?: SpawnerDispatchOptions,
	): Promise<AgentRecord | SpawnerBackgroundHandle>;
}

/** Execution context handed to a spawner tool's `execute`. */
export interface SpawnerToolContext<TRuntime = unknown> {
	dispatch: SpawnerDispatch;
	/** The app runtime handle passed to `createKernel({ toolRuntime })`. */
	toolRuntime?: TRuntime;
	/** Abort signal of the enclosing tool call. */
	signal?: AbortSignal;
}

export interface SpawnerToolDeclaration<
	TParams extends TSchema = TSchema,
	TRuntime = unknown,
> {
	name: string;
	label?: string;
	description?: string;
	promptSnippet?: string;
	parameters: TParams;
	/** Agent names this tool may dispatch, or ["*"] for the general opt-in. */
	spawns: string[];
	prepareArguments?: (args: unknown) => Static<TParams>;
	executionMode?: ToolExecutionMode;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		ctx: SpawnerToolContext<TRuntime>,
	): Promise<AgentToolResult<unknown>>;
}

export interface SpawnerToolMeta {
	spawns: string[];
	execute: (
		toolCallId: string,
		params: unknown,
		ctx: SpawnerToolContext,
	) => Promise<AgentToolResult<unknown>>;
}

export type SpawnerToolDefinition<TParams extends TSchema = TSchema> =
	ToolDefinition<TParams> & { [SPAWNER_TOOL_MARKER]: SpawnerToolMeta };

/**
 * Compile a spawner declaration into a Pi-registerable tool. Its `execute`
 * is a placeholder until the kernel binds the scoped dispatch at session
 * build time; the registry's harvest stub never executes it.
 */
export function defineSpawnerTool<
	TParams extends TSchema,
	TRuntime = unknown,
>(decl: SpawnerToolDeclaration<TParams, TRuntime>): SpawnerToolDefinition<TParams> {
	const spawns = decl.spawns;
	if (
		!Array.isArray(spawns) ||
		spawns.length === 0 ||
		spawns.some((name) => typeof name !== "string" || name.length === 0)
	) {
		throw new Error(
			`defineSpawnerTool("${decl.name}"): \`spawns\` must be a non-empty array of agent names, or ["*"] for a deliberately general spawner`,
		);
	}
	if (spawns.includes(SPAWNER_WILDCARD) && spawns.length > 1) {
		throw new Error(
			`defineSpawnerTool("${decl.name}"): the "*" wildcard cannot be mixed with named agents — declare either specific names or exactly ["*"]`,
		);
	}

	return {
		name: decl.name,
		label: decl.label ?? decl.name,
		description:
			decl.description ?? `Dispatch subagents (${spawns.join(", ")}).`,
		...(decl.promptSnippet !== undefined && { promptSnippet: decl.promptSnippet }),
		parameters: decl.parameters,
		...(decl.prepareArguments !== undefined && {
			prepareArguments: decl.prepareArguments,
		}),
		executionMode: decl.executionMode ?? "sequential",
		async execute() {
			throw new Error(
				`Spawner tool "${decl.name}" was not bound by the kernel — spawner tools only execute inside kernel-spawned sessions`,
			);
		},
		[SPAWNER_TOOL_MARKER]: {
			spawns: [...spawns],
			execute: decl.execute as SpawnerToolMeta["execute"],
		},
	};
}

/** Read the spawner metadata off a (possibly) compiled spawner tool. */
export function getSpawnerToolMeta(tool: unknown): SpawnerToolMeta | null {
	if (typeof tool !== "object" || tool === null) return null;
	const meta = (tool as Record<string, unknown>)[SPAWNER_TOOL_MARKER];
	if (
		typeof meta !== "object" ||
		meta === null ||
		!Array.isArray((meta as SpawnerToolMeta).spawns) ||
		typeof (meta as SpawnerToolMeta).execute !== "function"
	) {
		return null;
	}
	return meta as SpawnerToolMeta;
}

/** True when the allowlist permits dispatching `agentName`. */
export function spawnAllowed(spawns: string[], agentName: string): boolean {
	return spawns.includes(SPAWNER_WILDCARD) || spawns.includes(agentName);
}
