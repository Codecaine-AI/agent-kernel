import { eq, sql } from "drizzle-orm";
import type { KernelDatabase } from "../client";
import { agentRuns } from "../schema/agent-runs";
import { piAgentSessions } from "../schema/pi-agent-sessions";
import {
  promptRevisions,
  type PromptRevisionSource,
} from "../schema/prompt-revisions";
import type { PromptRevision } from "../types";

export interface UpsertPromptRevisionInput {
  /** "pk1-<sha256>" of the canonicalized PromptDocument. */
  hash: string;
  agentName: string;
  /** e.g. "prompt-kit/v1". */
  schemaVersion: string;
  /** Canonical JSON PromptDocument. */
  document: string;
  /** XML-tagged Markdown rendered at save time. */
  renderedText: string;
  source: PromptRevisionSource;
  createdAt: string;
}

/**
 * Idempotent on hash: a revision is content-addressed and immutable, so a
 * conflicting insert leaves the existing row (including its createdAt and
 * source) untouched and returns it.
 */
export async function upsertPromptRevision(
  db: KernelDatabase,
  input: UpsertPromptRevisionInput,
): Promise<PromptRevision> {
  const [inserted] = await db
    .insert(promptRevisions)
    .values(input)
    .onConflictDoNothing({ target: promptRevisions.hash })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.hash, input.hash))
    .limit(1);
  return existing;
}

export async function getPromptRevision(
  db: KernelDatabase,
  hash: string,
): Promise<PromptRevision | undefined> {
  const [row] = await db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.hash, hash))
    .limit(1);
  return row;
}

export async function listPromptRevisionsForAgent(
  db: KernelDatabase,
  agentName: string,
): Promise<PromptRevision[]> {
  return db
    .select()
    .from(promptRevisions)
    .where(eq(promptRevisions.agentName, agentName));
}

/**
 * Run analytics for one prompt revision (Phase 5). Sessions record which
 * revision they ran (pi_agent_sessions.prompt_hash, frozen at session
 * creation), so per-revision run stats are one join.
 */
export interface PromptRevisionStats {
  /** Runs executed against sessions carrying this prompt hash. */
  runs: number;
  /** Sum of input + output tokens across those runs. */
  totalTokens: number;
  /** Average input + output tokens per run (0 when there are no runs). */
  avgTokens: number;
  /**
   * Sum of run cost estimates. NULL when no run has a cost estimate (cost
   * data is optional — it depends on a kernel-config price table).
   */
  cost: number | null;
  /** Runs that ended in status 'error', 'turn-limit', or 'aborted'. */
  failures: number;
}

/**
 * Aggregate agent_runs joined to pi_agent_sessions on prompt_hash:
 *
 *   SELECT count(r.id), sum(in+out), avg(in+out), sum(cost),
 *          sum(status IN ('error','turn-limit','aborted'))
 *   FROM agent_runs r JOIN pi_agent_sessions s ON s.id = r.pi_session_id
 *   WHERE s.prompt_hash = :hash;
 */
export async function getPromptRevisionStats(
  db: KernelDatabase,
  hash: string,
): Promise<PromptRevisionStats> {
  const tokens = sql<number>`${agentRuns.usageInputTokens} + ${agentRuns.usageOutputTokens}`;
  const [row] = await db
    .select({
      runs: sql<number>`count(${agentRuns.id})`,
      totalTokens: sql<number>`coalesce(sum(${tokens}), 0)`,
      avgTokens: sql<number | null>`avg(${tokens})`,
      cost: sql<number | null>`sum(${agentRuns.usageCostEstimate})`,
      failures: sql<number>`coalesce(sum(CASE WHEN ${agentRuns.status} IN ('error', 'turn-limit', 'aborted') THEN 1 ELSE 0 END), 0)`,
    })
    .from(agentRuns)
    .innerJoin(piAgentSessions, eq(piAgentSessions.id, agentRuns.piSessionId))
    .where(eq(piAgentSessions.promptHash, hash));
  return {
    runs: row?.runs ?? 0,
    totalTokens: row?.totalTokens ?? 0,
    avgTokens: row?.avgTokens ?? 0,
    cost: row?.cost ?? null,
    failures: row?.failures ?? 0,
  };
}
