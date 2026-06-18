import { foreignKey, index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { agentStatusEnum, piAgentSessions } from "./pi-agent-sessions";

export const agentRuns = pgTable("agent_runs", {
  id: uuid().primaryKey().notNull(),
  piSessionId: uuid("pi_session_id").notNull(),
  containerId: varchar("container_id"),
  phase: varchar(),
  parentToolUseId: varchar("parent_tool_use_id"),
  runNumber: integer("run_number").notNull(),
  status: agentStatusEnum().notNull().default("running"),
  startedAt: timestamp("started_at", { mode: "string" }),
  completedAt: timestamp("completed_at", { mode: "string" }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("ix_agent_runs_pi_session_id").using("btree", table.piSessionId.asc().nullsLast().op("uuid_ops")),
  index("ix_agent_runs_container_id").using("btree", table.containerId.asc().nullsLast().op("text_ops")),
  index("ix_agent_runs_status").using("btree", table.status.asc().nullsLast()),
  foreignKey({
    columns: [table.piSessionId],
    foreignColumns: [piAgentSessions.id],
    name: "agent_runs_pi_session_id_fkey",
  }),
]);
