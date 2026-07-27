/**
 * Kernel-side binding for spawner tools (D77).
 *
 * `defineSpawnerTool` compiles a declaration into a Pi-registerable tool with
 * a placeholder execute. At session build time the kernel wraps the agent's
 * private-tools register function with `bindSpawnerTools(pi, deps)`: any tool
 * carrying spawner metadata gets its execute replaced with one that hands the
 * author a scoped `dispatch` handle over the AgentManager.
 *
 * The handle is what makes spawner tools safe by construction:
 * - the declared `spawns` allowlist is enforced on every dispatch;
 * - the target agent must exist in the catalog (wildcard spawners included);
 * - `parentToolUseId` is always the enclosing tool call id;
 * - `trigger` is always "parent-tool";
 * - containerId / parentRunId / sessionDir / phase / piSessionsDir are
 *   captured from the live RunContext AT DISPATCH TIME and passed explicitly.
 *   Dispatch always executes inside the parent's tool call where the
 *   async-local context is live; a queued background spawn would otherwise
 *   start later from the queue-drainer's context — a DIFFERENT parent's run
 *   (or none at all) — and inherit the wrong identity.
 * The tool author cannot get these wrong — they are not parameters.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	getSpawnerToolMeta,
	spawnAllowed,
	type SpawnerBackgroundHandle,
	type SpawnerDispatch,
	type SpawnerDispatchOptions,
	type SpawnerToolMeta,
} from "../agent-definition/spawner-tool";
import { runContextStore } from "../run-context";
import type { AgentManager } from "./manager";
import type {
	AgentRecord,
	KernelExtensionAPI,
	KernelExtensionContext,
	SpawnOptions,
} from "./types";

export interface SpawnerBindingDeps<TRuntime = unknown> {
	agentManager: AgentManager;
	/** The app runtime handle (createKernel `toolRuntime`), forwarded to ctx. */
	toolRuntime?: TRuntime;
	/**
	 * Catalog membership check — the kernel passes `registry.tryGet(...)`.
	 * When present, dispatching an agent that does not exist throws the same
	 * style of informative error as an allowlist violation, so a wildcard
	 * spawner cannot turn a typo into a silently errored record.
	 */
	hasAgent?: (agentName: string) => boolean;
}

interface DispatchSite {
	toolName: string;
	toolCallId: string;
	signal: AbortSignal | undefined;
	pi: ExtensionAPI;
	ctx: ExtensionContext;
}

function createScopedDispatch(
	meta: SpawnerToolMeta,
	site: DispatchSite,
	deps: SpawnerBindingDeps,
): SpawnerDispatch {
	const { agentManager } = deps;
	const kernelPi = site.pi as unknown as KernelExtensionAPI;
	const kernelCtx = site.ctx as unknown as KernelExtensionContext;
	return (async (
		agentName: string,
		prompt: string,
		opts: SpawnerDispatchOptions = {},
	): Promise<AgentRecord | SpawnerBackgroundHandle> => {
		if (!spawnAllowed(meta.spawns, agentName)) {
			throw new Error(
				`Spawner tool "${site.toolName}" is not allowed to dispatch agent "${agentName}" — declared spawns: [${meta.spawns
					.map((name) => `"${name}"`)
					.join(", ")}]`,
			);
		}
		if (deps.hasAgent && !deps.hasAgent(agentName)) {
			throw new Error(
				`Spawner tool "${site.toolName}" cannot dispatch unknown agent "${agentName}" — no such agent in the catalog`,
			);
		}
		// Capture the parent's run identity NOW: dispatch executes inside the
		// tool call where the async-local RunContext is live. Passing these
		// explicitly makes queue-drain timing irrelevant — a queued background
		// spawn started later from another parent's continuation (or from no
		// context at all, e.g. setMaxConcurrent/waitForAll drains) still runs
		// with THIS parent's identity.
		const runCtx = runContextStore.getStore();
		const spawnOptions: Omit<SpawnOptions, "isBackground"> = {
			description: opts.description ?? `${site.toolName} → ${agentName}`,
			// parentToolUseId: the manager forwards toolCallId as the child
			// run's parent_tool_use_id and writes the parent/child link marker.
			toolCallId: site.toolCallId,
			parentPi: kernelPi,
			trigger: "parent-tool",
			...(runCtx?.containerId !== undefined && { containerId: runCtx.containerId }),
			...(runCtx?.runId !== undefined && { parentRunId: runCtx.runId }),
			...(runCtx?.sessionDir !== undefined && { sessionDir: runCtx.sessionDir }),
			...(runCtx?.piSessionsDir !== undefined && {
				piSessionsDir: runCtx.piSessionsDir,
			}),
			...(runCtx?.phase !== undefined && { phase: runCtx.phase }),
			...(runCtx?.piSessionUuid !== undefined && {
				parentPiSessionUuid: runCtx.piSessionUuid,
			}),
			...(site.signal !== undefined && { signal: site.signal }),
			...(opts.variables !== undefined && { variables: opts.variables }),
			...(opts.displayLabel !== undefined && { displayLabel: opts.displayLabel }),
			...(opts.workingDir !== undefined && { workingDir: opts.workingDir }),
		};
		if (opts.background) {
			const id = agentManager.spawn(kernelPi, kernelCtx, agentName, prompt, {
				...spawnOptions,
				isBackground: true,
			});
			const record = agentManager.getRecord(id)!;
			const handle: SpawnerBackgroundHandle = {
				id,
				agentName,
				status: record.status,
				done: agentManager.waitForAgent(id),
			};
			return handle;
		}
		return agentManager.spawnAndWait(
			kernelPi,
			kernelCtx,
			agentName,
			prompt,
			spawnOptions,
		);
	}) as SpawnerDispatch;
}

/**
 * Wrap a Pi ExtensionAPI so that spawner tools registered through it are
 * bound to the kernel's AgentManager. Ordinary tools pass through untouched.
 */
export function bindSpawnerTools<TRuntime = unknown>(
	pi: ExtensionAPI,
	deps: SpawnerBindingDeps<TRuntime>,
): ExtensionAPI {
	return new Proxy(pi, {
		get(target, prop, _receiver) {
			if (prop === "registerTool") {
				return (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
					const meta = getSpawnerToolMeta(tool);
					if (!meta) return target.registerTool(tool);
					return target.registerTool({
						...tool,
						execute: (toolCallId, params, signal, _onUpdate, ctx) => {
							const dispatch = createScopedDispatch(
								meta,
								{ toolName: tool.name, toolCallId, signal, pi: target, ctx },
								deps,
							);
							return meta.execute(toolCallId, params, {
								dispatch,
								toolRuntime: deps.toolRuntime,
								signal,
							});
						},
					});
				};
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
