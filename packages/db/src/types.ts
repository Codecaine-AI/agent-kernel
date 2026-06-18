import type { agentRuns, containers, kernels, piAgentSessions, traceEvents } from "./schema";

export type Container = typeof containers.$inferSelect;
export type NewContainer = typeof containers.$inferInsert;

export type TraceEventRow = typeof traceEvents.$inferSelect;
export type NewTraceEventRow = typeof traceEvents.$inferInsert;

export type PiAgentSession = typeof piAgentSessions.$inferSelect;
export type NewPiAgentSession = typeof piAgentSessions.$inferInsert;

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;

export type KernelRegistration = typeof kernels.$inferSelect;
export type NewKernelRegistration = typeof kernels.$inferInsert;
