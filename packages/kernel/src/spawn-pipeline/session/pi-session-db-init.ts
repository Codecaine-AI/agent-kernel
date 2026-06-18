import {
	createAgentRun,
	listAgentRunsForPiSession,
	upsertPiAgentSession,
} from "@agent-kernel/db/actions";

type Database = any;

export interface SetupPiSessionAndRunArgs {
	piSessionUuid: string;
	appSessionId: string;
	agentName: string;
	parentPiSessionUuid?: string;
	containerId?: string;
	phase?: string;
	displayLabel?: string;
	parentToolUseId?: string;
}

export interface SetupPiSessionAndRunResult {
	runId: string;
}

export async function setupPiSessionAndRun(
	db: Database,
	args: SetupPiSessionAndRunArgs,
): Promise<SetupPiSessionAndRunResult> {
	const now = new Date().toISOString();
	await upsertPiAgentSession(db, {
		id: args.piSessionUuid,
		appSessionId: args.appSessionId,
		agentName: args.agentName,
		status: "running",
		startedAt: now,
		parentId: args.parentPiSessionUuid,
		containerId: args.containerId,
		phase: args.phase,
		displayLabel: args.displayLabel,
	});
	const existing = await listAgentRunsForPiSession(db, args.piSessionUuid);
	const runNumber = existing.length + 1;
	const runId = crypto.randomUUID();
	await createAgentRun(db, {
		id: runId,
		piSessionId: args.piSessionUuid,
		runNumber,
		status: "running",
		startedAt: now,
		containerId: args.containerId,
		phase: args.phase,
		parentToolUseId: args.parentToolUseId,
	});
	return { runId };
}
