import { foreignKey, index, integer, json, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { piAgentSessions } from "./pi-agent-sessions";

export const traceEvents = pgTable("trace_events", {
  id: uuid().primaryKey().notNull(),
  appSessionId: uuid("app_session_id").notNull(),
  containerId: varchar("container_id"),
  userId: uuid("user_id").notNull(),
  type: varchar().notNull(),
  source: varchar().notNull(),
  traceLevel: integer("trace_level").notNull(),
  eventData: json("event_data").notNull(),
  piSessionId: uuid("pi_session_id"),
  spanId: varchar("span_id"),
  parentEventId: varchar("parent_event_id"),
  timestamp: timestamp({ mode: "string" }).notNull(),
}, (table) => [
  index("ix_trace_events_app_session_id").using("btree", table.appSessionId.asc().nullsLast().op("uuid_ops")),
  index("ix_trace_events_container_id").using("btree", table.containerId.asc().nullsLast().op("text_ops")),
  index("ix_trace_events_app_session_type").using("btree", table.appSessionId.asc().nullsLast().op("uuid_ops"), table.type.asc().nullsLast().op("text_ops")),
  index("ix_trace_events_span_id").using("btree", table.spanId.asc().nullsLast().op("text_ops")),
  index("ix_trace_events_timestamp").using("btree", table.timestamp.asc().nullsLast().op("timestamp_ops")),
  index("ix_trace_events_type").using("btree", table.type.asc().nullsLast().op("text_ops")),
  index("ix_trace_events_pi_session_id").using("btree", table.piSessionId.asc().nullsLast().op("uuid_ops")),
  foreignKey({
    columns: [table.piSessionId],
    foreignColumns: [piAgentSessions.id],
    name: "trace_events_pi_session_id_fkey",
  }),
  index("ix_trace_events_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
]);
