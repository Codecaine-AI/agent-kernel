import type {
  agentRuns,
  containers,
  piAgentSessions,
  promptRevisions,
  traceEvents,
} from "./schema";

export type Container = typeof containers.$inferSelect;
export type NewContainer = typeof containers.$inferInsert;

export type TraceEventRow = typeof traceEvents.$inferSelect;
export type NewTraceEventRow = typeof traceEvents.$inferInsert;

export type PiAgentSession = typeof piAgentSessions.$inferSelect;
export type NewPiAgentSession = typeof piAgentSessions.$inferInsert;

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;

export type PromptRevision = typeof promptRevisions.$inferSelect;
export type NewPromptRevision = typeof promptRevisions.$inferInsert;
