/**
 * runBucketing.ts — Drop TraceSpans into per-run buckets by timestamp enclosure.
 *
 * Design (spec decision #10): trace_events has no run_id FK. At render time we
 * sort agent_runs by started_at and pick the run whose `[started_at,
 * completed_at)` half-open range contains the span's startTime. Anything
 * outside any run's range is returned as an orphan list — the caller appends
 * them to the PI agent container as siblings of the run spans.
 */

import type { TraceSpan } from "@evilmartians/agent-prism-types";

import type { AgentRun } from "../types";

export function sortRunsByStart(runs: AgentRun[]): AgentRun[] {
  return runs.slice().sort((a, b) => {
    const aTs = new Date(a.startedAt ?? a.createdAt).getTime();
    const bTs = new Date(b.startedAt ?? b.createdAt).getTime();
    return aTs - bTs;
  });
}

export interface RunBuckets {
  runBuckets: Map<string, TraceSpan[]>;
  orphans: TraceSpan[];
}

export function bucketSpansByRun(spans: TraceSpan[], runs: AgentRun[]): RunBuckets {
  const sorted = sortRunsByStart(runs);
  const runBuckets = new Map<string, TraceSpan[]>();
  for (const r of sorted) runBuckets.set(r.id, []);
  const orphans: TraceSpan[] = [];

  for (const span of spans) {
    const ts = span.startTime.getTime();
    let matched: AgentRun | null = null;
    for (const r of sorted) {
      const startTs = new Date(r.startedAt ?? r.createdAt).getTime();
      const endTs = r.completedAt
        ? new Date(r.completedAt).getTime()
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
