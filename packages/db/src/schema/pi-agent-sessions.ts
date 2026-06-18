import { foreignKey, index, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const agentStatusEnum = pgEnum("agent_status", [
  "queued",
  "running",
  "completed",
  "aborted",
  "stopped",
  "error",
]);

export const AGENT_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  ABORTED: "aborted",
  STOPPED: "stopped",
  ERROR: "error",
} as const;

export type AgentStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];

export const piAgentSessions = pgTable("pi_agent_sessions", {
  id: uuid().primaryKey().notNull(),
  appSessionId: uuid("app_session_id"),
  parentId: uuid("parent_id"),
  containerId: varchar("container_id"),
  phase: varchar(),
  displayLabel: varchar("display_label"),
  agentName: varchar("agent_name").notNull(),
  status: agentStatusEnum().notNull().default(AGENT_STATUS.RUNNING),
  model: varchar(),
  startedAt: timestamp("started_at", { mode: "string" }),
  completedAt: timestamp("completed_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("ix_pi_agent_sessions_app_session_id").using("btree", table.appSessionId.asc().nullsLast().op("uuid_ops")),
  index("ix_pi_agent_sessions_parent_id").using("btree", table.parentId.asc().nullsLast().op("uuid_ops")),
  index("ix_pi_agent_sessions_container_id").using("btree", table.containerId.asc().nullsLast().op("text_ops")),
  index("ix_pi_agent_sessions_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
  foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: "pi_agent_sessions_parent_id_fkey",
  }),
]);
