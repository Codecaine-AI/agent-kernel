import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The event log. container_id is the single required grouping identity;
 * run/session/agent/user linkage is stamped when known at emit time.
 * event_id is the idempotent insert key (INSERT OR IGNORE).
 */
export const traceEvents = sqliteTable(
  "trace_events",
  {
    eventId: text("event_id").primaryKey(),
    containerId: text("container_id").notNull(),
    runId: text("run_id"),
    piSessionId: text("pi_session_id"),
    agentId: text("agent_id"),
    userId: text("user_id"),
    type: text("type").notNull(),
    source: text("source").notNull(),
    traceLevel: integer("trace_level").notNull(),
    eventData: text("event_data", { mode: "json" }).notNull(),
    spanId: text("span_id"),
    parentEventId: text("parent_event_id"),
    timestamp: text("timestamp").notNull(),
  },
  (table) => [
    index("idx_events_container_ts").on(table.containerId, table.timestamp),
    index("idx_events_run").on(table.runId),
  ],
);
