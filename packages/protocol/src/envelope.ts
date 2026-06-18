/**
 * TraceEvent envelope — the universal event shape stored in trace_events table.
 *
 * All type-specific data lives in eventData. The envelope is generic;
 * shape of eventData is determined by the `type` field.
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
  appSessionId: string;
  containerId?: string;
  userId: string;
  type: EventType;
  source: TraceSource;

  agentId?: string;
  traceLevel: TraceLevel;
  eventData: EventData;
  spanId?: string;
  parentEventId?: string;
  timestamp: string; // ISO 8601

  // Transport-only: Pi session UUID string from JSONL line 1.
  // Resolved to pi_session_id FK (pi_agent_sessions.id) at queue flush time;
  // never persisted directly on trace_events.
  piSessionUuid?: string;
}
