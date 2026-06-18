import { asc, eq } from "drizzle-orm";
import { agentRuns } from "../schema/agent-runs";
import type { AgentStatus } from "../schema/pi-agent-sessions";
import type { AgentRun, NewAgentRun } from "../types";

type KernelDatabase = any;

export async function createAgentRun(
  db: KernelDatabase,
  data: NewAgentRun,
): Promise<AgentRun> {
  const [row] = await db.insert(agentRuns).values(data).returning();
  return row;
}

export async function upsertAgentRun(
  db: KernelDatabase,
  data: NewAgentRun,
): Promise<AgentRun> {
  const [row] = await db
    .insert(agentRuns)
    .values(data)
    .onConflictDoUpdate({
      target: agentRuns.id,
      set: {
        ...(data.piSessionId !== undefined && { piSessionId: data.piSessionId }),
        ...(data.agentName !== undefined && { agentName: data.agentName }),
        ...(data.containerId !== undefined && { containerId: data.containerId }),
        ...(data.phase !== undefined && { phase: data.phase }),
        ...(data.parentRunId !== undefined && { parentRunId: data.parentRunId }),
        ...(data.displayLabel !== undefined && { displayLabel: data.displayLabel }),
        ...(data.parentToolUseId !== undefined && { parentToolUseId: data.parentToolUseId }),
        ...(data.runNumber !== undefined && { runNumber: data.runNumber }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.startedAt !== undefined && { startedAt: data.startedAt }),
        ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
        ...(data.inputTokens !== undefined && { inputTokens: data.inputTokens }),
        ...(data.outputTokens !== undefined && { outputTokens: data.outputTokens }),
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();
  return row;
}

export async function updateAgentRunStatus(
  db: KernelDatabase,
  runId: string,
  status: AgentStatus,
  opts?: {
    completedAt?: string;
    inputTokens?: number;
    outputTokens?: number;
  },
): Promise<AgentRun | undefined> {
  const [row] = await db
    .update(agentRuns)
    .set({
      status,
      ...(opts?.completedAt && { completedAt: opts.completedAt }),
      ...(opts?.inputTokens !== undefined && { inputTokens: opts.inputTokens }),
      ...(opts?.outputTokens !== undefined && { outputTokens: opts.outputTokens }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(agentRuns.id, runId))
    .returning();
  return row;
}

export async function getAgentRun(
  db: KernelDatabase,
  runId: string,
): Promise<AgentRun | undefined> {
  return db.query.agentRuns.findFirst({
    where: eq(agentRuns.id, runId),
  });
}

export async function listAgentRunsForPiSession(
  db: KernelDatabase,
  piSessionId: string,
): Promise<AgentRun[]> {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.piSessionId, piSessionId))
    .orderBy(asc(agentRuns.runNumber));
}
