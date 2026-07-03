/**
 * TraceEvent envelope — the universal event shape stored in trace_events table.
 *
 * All type-specific data lives in eventData. The envelope is generic;
 * shape of eventData is determined by the `type` field.
 *
 * Identity model: `containerId` is the single required grouping identity —
 * see docs/10-system-design/15-identity-model.md. There is no app-session
 * identity on the envelope; host correlation happens through container
 * kind + appKey.
 */

import type { EventData, EventType, TraceLevel } from "./types";

export const TraceSource = {
  KERNEL: "kernel",
  APP: "app",
  AGENT: "agent",
} as const;

export type KnownTraceSource = (typeof TraceSource)[keyof typeof TraceSource];
export type TraceSource = KnownTraceSource | (string & {});

export interface TraceEvent {
  eventId: string;
  /** Required — the primary grouping identity (container kind + key tree). */
  containerId: string;
  type: EventType;
  source: TraceSource;
  traceLevel: TraceLevel;
  eventData: EventData;

  agentId?: string;
  /** Explicit run linkage — stamped at emit time when the run is known. */
  runId?: string;
  spanId?: string;
  parentEventId?: string;
  /** Optional actor correlation. */
  userId?: string;
  timestamp: string; // ISO 8601

  // Transport-only: Pi session UUID string from JSONL line 1.
  // Resolved to pi_session_id FK (pi_agent_sessions.id) at queue flush time;
  // never persisted directly on trace_events.
  piSessionUuid?: string;
}
