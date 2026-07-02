import {
	createAgentRun,
	upsertPiAgentSession,
	type KernelDatabase,
	type RunTrigger,
} from "@agent-kernel/db";

export interface SetupPiSessionAndRunArgs {
	piSessionUuid: string;
	/** Primary grouping identity — required on both the session and run rows. */
	containerId: string;
	/** Pipeline-minted run id (known before the run opens). */
	runId: string;
	agentName: string;
	/** What opened the run: operator | parent-tool | steer | resume | system. */
	trigger: RunTrigger;
	model?: string;
	parentPiSessionUuid?: string;
	parentRunId?: string;
	phase?: string;
	displayLabel?: string;
	parentToolUseId?: string;
	/** The user_message event that opened the run, when the pipeline emitted it. */
	inboundEventId?: string;
}

export interface SetupPiSessionAndRunResult {
	runId: string;
}

/**
 * Pre-insert the session + run rows before the agent starts working, so every
 * event the run emits already resolves (doctor invariants 2 and 7).
 */
export async function setupPiSessionAndRun(
	db: KernelDatabase,
	args: SetupPiSessionAndRunArgs,
): Promise<SetupPiSessionAndRunResult> {
	const now = new Date().toISOString();
	await upsertPiAgentSession(db, {
		id: args.piSessionUuid,
		containerId: args.containerId,
		agentName: args.agentName,
		status: "active",
		model: args.model,
		createdAt: now,
		parentSessionId: args.parentPiSessionUuid,
		parentToolUseId: args.parentToolUseId,
		phase: args.phase,
		displayLabel: args.displayLabel,
	});
	await createAgentRun(db, {
		id: args.runId,
		piSessionId: args.piSessionUuid,
		containerId: args.containerId,
		agentName: args.agentName,
		trigger: args.trigger,
		status: "running",
		startedAt: now,
		parentRunId: args.parentRunId,
		parentToolUseId: args.parentToolUseId,
		inboundEventId: args.inboundEventId,
		phase: args.phase,
		displayLabel: args.displayLabel,
	});
	return { runId: args.runId };
}
