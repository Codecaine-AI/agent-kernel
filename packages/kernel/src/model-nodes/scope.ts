/**
 * Node scope resolution (plan §4.6): where a model node, step, or gate hangs
 * in the trace, and what opened it.
 *
 * Order: explicit options → the parent run's row → the ambient RunContext.
 * The kernel never infers "inside a tool" (RunContext carries no current
 * tool-call id), so `parent-tool` is only ever the default when the caller
 * passes `parentToolUseId`.
 */
import { getAgentRun, getContainer, type KernelDatabase } from "@agent-kernel/db";

import { runContextStore } from "../run-context";
import { KernelNodeError, type NodeTrigger } from "./types";

export interface NodeScopeInput {
	containerId?: string;
	parentRunId?: string;
	parentToolUseId?: string;
	displayLabel?: string;
	trigger?: NodeTrigger;
}

export interface ResolvedNodeScope {
	containerId: string;
	parentRunId?: string;
	parentToolUseId?: string;
	displayLabel?: string;
	trigger: NodeTrigger;
}

export interface ResolveNodeScopeContext {
	db: KernelDatabase;
	/**
	 * The node kind's own default trigger, used when the caller passes none
	 * (decide: "judge"). Without it the scope rules apply (§4.6).
	 */
	defaultTrigger?: NodeTrigger;
}

/** "parent-tool" only with an explicit parentToolUseId; "post-run" with a parent run; else "system". */
export function defaultNodeTrigger(scope: { parentToolUseId?: string; parentRunId?: string }): NodeTrigger {
	if (scope.parentToolUseId) return "parent-tool";
	if (scope.parentRunId) return "post-run";
	return "system";
}

/**
 * Resolves container, parent run, and trigger before any write. Throws
 * KernelNodeError "unknown-parent-run" when the parent run (explicit or
 * ambient) is not in this kernel's database, and "no-container" when no
 * container can be derived or the explicit one does not exist.
 */
export async function resolveNodeScope(
	opts: NodeScopeInput,
	ctx: ResolveNodeScopeContext,
): Promise<ResolvedNodeScope> {
	const ambient = runContextStore.getStore();
	const parentRunId = opts.parentRunId ?? ambient?.runId;

	let parentContainerId: string | undefined;
	if (parentRunId !== undefined) {
		const run = await getAgentRun(ctx.db, parentRunId);
		if (!run) {
			throw new KernelNodeError(
				"unknown-parent-run",
				`parent run ${parentRunId} does not exist in this kernel's database`,
			);
		}
		parentContainerId = run.containerId;
	}

	const containerId = opts.containerId ?? parentContainerId ?? ambient?.containerId;
	if (!containerId) {
		throw new KernelNodeError(
			"no-container",
			"no container: pass containerId or parentRunId, or call inside a run",
		);
	}
	if (containerId !== parentContainerId && !(await getContainer(ctx.db, containerId))) {
		throw new KernelNodeError("no-container", `container ${containerId} does not exist`);
	}

	const scope = {
		...(parentRunId !== undefined && { parentRunId }),
		...(opts.parentToolUseId !== undefined && { parentToolUseId: opts.parentToolUseId }),
	};
	return {
		containerId,
		...scope,
		...(opts.displayLabel !== undefined && { displayLabel: opts.displayLabel }),
		trigger: opts.trigger ?? ctx.defaultTrigger ?? defaultNodeTrigger(scope),
	};
}

/**
 * Per-kernel monotonic clock for node events: every reading is
 * `max(now(), last + 1)` ms, so fake engines never produce same-millisecond
 * ties and events sort in emission order.
 */
export interface NodeClock {
	/** Next timestamp in epoch ms; never repeats or goes back. At least `atLeastMs` when given. */
	nextMs(atLeastMs?: number): number;
	/** `nextMs` as ISO 8601. */
	nextIso(atLeastMs?: number): string;
	/** Records a timestamp issued elsewhere (an attempt window), so later readings sort after it. */
	observe(ms: number): void;
	/** The wall clock behind this node clock (injectable for tests). */
	now(): number;
}

export function createNodeClock(now: () => number = Date.now): NodeClock {
	let last = Number.NEGATIVE_INFINITY;
	const nextMs = (atLeastMs?: number) => {
		const candidate = Math.max(now(), last + 1, atLeastMs ?? Number.NEGATIVE_INFINITY);
		last = candidate;
		return candidate;
	};
	return {
		nextMs,
		nextIso: (atLeastMs) => new Date(nextMs(atLeastMs)).toISOString(),
		observe(ms) {
			if (Number.isFinite(ms) && ms > last) last = ms;
		},
		now,
	};
}
