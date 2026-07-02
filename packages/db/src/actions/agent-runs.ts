import { asc, eq } from "drizzle-orm";
import type { KernelDatabase } from "../client";
import { agentRuns, type RunStatus } from "../schema/agent-runs";
import type { AgentRun, NewAgentRun } from "../types";

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
        piSessionId: data.piSessionId,
        containerId: data.containerId,
        ...(data.parentRunId !== undefined && { parentRunId: data.parentRunId }),
        ...(data.parentToolUseId !== undefined && {
          parentToolUseId: data.parentToolUseId,
        }),
        ...(data.agentName !== undefined && { agentName: data.agentName }),
        ...(data.trigger !== undefined && { trigger: data.trigger }),
        ...(data.inboundEventId !== undefined && {
          inboundEventId: data.inboundEventId,
        }),
        ...(data.outboundEventId !== undefined && {
          outboundEventId: data.outboundEventId,
        }),
        ...(data.displayLabel !== undefined && { displayLabel: data.displayLabel }),
        ...(data.phase !== undefined && { phase: data.phase }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.startedAt !== undefined && { startedAt: data.startedAt }),
        ...(data.endedAt !== undefined && { endedAt: data.endedAt }),
      },
    })
    .returning();
  return row;
}

/**
 * Close or update a run: status transition plus the outbound event that
 * closed it and the usage rollup (Phase 2 populates usage).
 */
export async function updateAgentRunStatus(
  db: KernelDatabase,
  runId: string,
  status: RunStatus,
  opts?: {
    endedAt?: string;
    outboundEventId?: string;
    usageInputTokens?: number;
    usageOutputTokens?: number;
    usageCacheRead?: number;
    usageCacheWrite?: number;
    usageCostEstimate?: number;
  },
): Promise<AgentRun | undefined> {
  const [row] = await db
    .update(agentRuns)
    .set({
      status,
      ...(opts?.endedAt !== undefined && { endedAt: opts.endedAt }),
      ...(opts?.outboundEventId !== undefined && {
        outboundEventId: opts.outboundEventId,
      }),
      ...(opts?.usageInputTokens !== undefined && {
        usageInputTokens: opts.usageInputTokens,
      }),
      ...(opts?.usageOutputTokens !== undefined && {
        usageOutputTokens: opts.usageOutputTokens,
      }),
      ...(opts?.usageCacheRead !== undefined && {
        usageCacheRead: opts.usageCacheRead,
      }),
      ...(opts?.usageCacheWrite !== undefined && {
        usageCacheWrite: opts.usageCacheWrite,
      }),
      ...(opts?.usageCostEstimate !== undefined && {
        usageCostEstimate: opts.usageCostEstimate,
      }),
    })
    .where(eq(agentRuns.id, runId))
    .returning();
  return row;
}

export async function getAgentRun(
  db: KernelDatabase,
  runId: string,
): Promise<AgentRun | undefined> {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  return row;
}

export async function listAgentRunsForPiSession(
  db: KernelDatabase,
  piSessionId: string,
): Promise<AgentRun[]> {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.piSessionId, piSessionId))
    .orderBy(asc(agentRuns.startedAt));
}

export async function listAgentRunsForContainer(
  db: KernelDatabase,
  containerId: string,
): Promise<AgentRun[]> {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.containerId, containerId))
    .orderBy(asc(agentRuns.startedAt));
}
