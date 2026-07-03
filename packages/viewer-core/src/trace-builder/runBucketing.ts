/**
 * runBucketing.ts — Drop TraceSpans into per-run buckets.
 *
 * Preferred path: the envelope carries an explicit `runId` stamped at emit
 * time, and the caller passes a span-id → run-id map so spans land in their
 * run by identity, never by clock. Fallback (legacy rows without runId):
 * sort agent_runs by started_at and pick the run whose `[started_at,
 * ended_at)` half-open range contains the span's startTime. Anything outside
 * any run's range is returned as an orphan list — the caller appends them to
 * the PI agent container as siblings of the run spans.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import type { AgentRun } from "../types";

export function sortRunsByStart(runs: AgentRun[]): AgentRun[] {
  return runs.slice().sort((a, b) => {
    const aTs = new Date(a.startedAt).getTime();
    const bTs = new Date(b.startedAt).getTime();
    return aTs - bTs;
  });
}

export interface RunBuckets {
  runBuckets: Map<string, TraceSpan[]>;
  orphans: TraceSpan[];
}

export function bucketSpansByRun(
  spans: TraceSpan[],
  runs: AgentRun[],
  runIdBySpanId?: Map<string, string>,
): RunBuckets {
  const sorted = sortRunsByStart(runs);
  const runBuckets = new Map<string, TraceSpan[]>();
  for (const r of sorted) runBuckets.set(r.id, []);
  const orphans: TraceSpan[] = [];

  for (const span of spans) {
    // Explicit run linkage wins — the envelope runId was stamped at emit time.
    const explicitRunId = runIdBySpanId?.get(span.id);
    if (explicitRunId && runBuckets.has(explicitRunId)) {
      runBuckets.get(explicitRunId)!.push(span);
      continue;
    }

    const ts = span.startTime.getTime();
    let matched: AgentRun | null = null;
    for (const r of sorted) {
      const startTs = new Date(r.startedAt).getTime();
      const endTs = r.endedAt
        ? new Date(r.endedAt).getTime()
        : Number.POSITIVE_INFINITY;
      if (ts >= startTs && ts < endTs) {
        matched = r;
        break;
      }
    }
    if (matched) {
      runBuckets.get(matched.id)!.push(span);
    } else {
      orphans.push(span);
    }
  }

  return { runBuckets, orphans };
}
