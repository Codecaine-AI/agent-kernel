/**
 * Usage rollup write path (Phase 2) — dumb additive SQL increments.
 *
 * Turn usage lands on the run row as each pi_turn_end arrives; run totals are
 * folded into the session and container rows when the run closes. costEstimate
 * columns are nullable — increments treat NULL as 0 and only touch the column
 * when a delta is present, so rows with no cost data stay NULL.
 */
import { eq, sql } from "drizzle-orm";
import type { KernelDatabase } from "../client";
import { agentRuns } from "../schema/agent-runs";
import { containers } from "../schema/containers";
import { piAgentSessions } from "../schema/pi-agent-sessions";

export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costEstimate?: number;
}

/** Additively increment a run's usage rollup columns (one pi_turn_end). */
export async function updateRunUsage(
  db: KernelDatabase,
  runId: string,
  delta: UsageDelta,
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      usageInputTokens: sql`${agentRuns.usageInputTokens} + ${delta.inputTokens}`,
      usageOutputTokens: sql`${agentRuns.usageOutputTokens} + ${delta.outputTokens}`,
      usageCacheRead: sql`${agentRuns.usageCacheRead} + ${delta.cacheReadTokens}`,
      usageCacheWrite: sql`${agentRuns.usageCacheWrite} + ${delta.cacheWriteTokens}`,
      ...(delta.costEstimate !== undefined && {
        usageCostEstimate: sql`coalesce(${agentRuns.usageCostEstimate}, 0) + ${delta.costEstimate}`,
      }),
    })
    .where(eq(agentRuns.id, runId));
}

/**
 * Fold run totals into the session rollup. Sessions carry input/output
 * columns only (see pi_agent_sessions schema).
 */
export async function incrementSessionUsage(
  db: KernelDatabase,
  piSessionId: string,
  delta: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await db
    .update(piAgentSessions)
    .set({
      usageInputTokens: sql`${piAgentSessions.usageInputTokens} + ${delta.inputTokens}`,
      usageOutputTokens: sql`${piAgentSessions.usageOutputTokens} + ${delta.outputTokens}`,
    })
    .where(eq(piAgentSessions.id, piSessionId));
}

/** Fold run totals into the container rollup. */
export async function incrementContainerUsage(
  db: KernelDatabase,
  containerId: string,
  delta: UsageDelta,
): Promise<void> {
  await db
    .update(containers)
    .set({
      usageInputTokens: sql`${containers.usageInputTokens} + ${delta.inputTokens}`,
      usageOutputTokens: sql`${containers.usageOutputTokens} + ${delta.outputTokens}`,
      usageCacheRead: sql`${containers.usageCacheRead} + ${delta.cacheReadTokens}`,
      usageCacheWrite: sql`${containers.usageCacheWrite} + ${delta.cacheWriteTokens}`,
      ...(delta.costEstimate !== undefined && {
        usageCostEstimate: sql`coalesce(${containers.usageCostEstimate}, 0) + ${delta.costEstimate}`,
      }),
    })
    .where(eq(containers.id, containerId));
}
