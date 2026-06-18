/**
 * spawn-context.ts — SpawnContext factory + projection helpers.
 *
 * `createSpawnContext` derives the per-spawn paths block from the caller's
 * working directory (workingDir + active_session/). Pure — no I/O, no
 * existence checks. `toLoaderResolveContext` narrows a SpawnContext down to
 * the CP3 LoaderResolveContext so catalog loaders stay decoupled from the
 * richer spawn surface.
 */

import { join } from "node:path";

import type { LoaderResolveContext } from "./loaders/types";
import type { AppSessionData, RuntimeState, SpawnContext, SpawnContextCaller } from "./types";

export interface CreateSpawnContextParams {
	agentName: string;
	runtime: RuntimeState;
	variables?: Record<string, unknown>;
	caller?: SpawnContextCaller;
	cwd?: string;
	priorSessionsDir?: string;
	sessionData?: AppSessionData | null;
}

export function createSpawnContext(
	params: CreateSpawnContextParams,
): SpawnContext {
	const workingDir = params.cwd ?? params.runtime.cwd;
	const activeSessionDir = join(workingDir, "active_session");
	return {
		agentName: params.agentName,
		variables: params.variables ?? {},
		caller: params.caller ?? { kind: "system", id: "kernel" },
		runtime: params.runtime,
		paths: { workingDir, activeSessionDir, priorSessionsDir: params.priorSessionsDir },
		sessionData: params.sessionData ?? undefined,
	};
}

export function toLoaderResolveContext(ctx: SpawnContext): LoaderResolveContext {
	return {
		cwd: ctx.paths.workingDir,
		activeSessionDir: ctx.paths.activeSessionDir,
		appSessionId: ctx.runtime.appSessionId || undefined,
		sessionData: ctx.sessionData ?? undefined,
	};
}
