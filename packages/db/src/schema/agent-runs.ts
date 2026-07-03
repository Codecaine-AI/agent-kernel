import {
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { containers } from "./containers";
import { piAgentSessions } from "./pi-agent-sessions";

/** What opened the run. Closed vocabulary per the identity model. */
export const RUN_TRIGGER = {
  OPERATOR: "operator",
  PARENT_TOOL: "parent-tool",
  STEER: "steer",
  RESUME: "resume",
  SYSTEM: "system",
} as const;

export type RunTrigger = (typeof RUN_TRIGGER)[keyof typeof RUN_TRIGGER];

/** Run status. Closed vocabulary: every run reaches a terminal status. */
export const RUN_STATUS = {
  RUNNING: "running",
  DONE: "done",
  ERROR: "error",
  ABORTED: "aborted",
  TURN_LIMIT: "turn-limit",
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

/**
 * One processing loop: message in -> response out. A session holds many runs.
 * inbound_event_id is the message that opened the run; outbound_event_id the
 * response that closed it.
 */
export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    piSessionId: text("pi_session_id")
      .notNull()
      .references(() => piAgentSessions.id),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id),
    parentRunId: text("parent_run_id"),
    parentToolUseId: text("parent_tool_use_id"),
    agentName: text("agent_name").notNull(),
    trigger: text("trigger").$type<RunTrigger>().notNull(),
    inboundEventId: text("inbound_event_id"),
    outboundEventId: text("outbound_event_id"),
    displayLabel: text("display_label"),
    phase: text("phase"),
    status: text("status").$type<RunStatus>().notNull(),
    usageInputTokens: integer("usage_input_tokens").notNull().default(0),
    usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
    usageCacheRead: integer("usage_cache_read").notNull().default(0),
    usageCacheWrite: integer("usage_cache_write").notNull().default(0),
    usageCostEstimate: real("usage_cost_estimate"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
  },
  (table) => [
    index("ix_agent_runs_pi_session_id").on(table.piSessionId),
    index("ix_agent_runs_container_id").on(table.containerId),
    index("ix_agent_runs_parent_run_id").on(table.parentRunId),
    foreignKey({
      columns: [table.parentRunId],
      foreignColumns: [table.id],
      name: "agent_runs_parent_run_id_fkey",
    }),
  ],
);
