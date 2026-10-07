import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { containers } from "./containers";

/**
 * Session status vocabulary. Open string; conventional kernel values below.
 * A session is "active" while its agent can still receive runs.
 */
export const SESSION_STATUS = {
  ACTIVE: "active",
  ENDED: "ended",
  ERROR: "error",
} as const;

export type SessionStatus =
  | (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS]
  | (string & {});

/**
 * What produced the session. "pi" is a Pi agent conversation; "call" and
 * "decision" are model-node sessions (one structured request or one
 * classification per run). Open string; rows written before the column
 * existed read as "pi".
 */
export const SESSION_KIND = {
  PI: "pi",
  CALL: "call",
  DECISION: "decision",
} as const;

export type SessionKind =
  | (typeof SESSION_KIND)[keyof typeof SESSION_KIND]
  | (string & {});

/**
 * One Pi conversation. The system prompt is frozen at session creation, so
 * prompt_hash lives here (populated from Phase 3). A subagent's session
 * carries parent_session_id and parent_tool_use_id.
 */
export const piAgentSessions = sqliteTable(
  "pi_agent_sessions",
  {
    id: text("id").primaryKey(),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id),
    parentSessionId: text("parent_session_id"),
    /** Set when spawned by a parent's tool call. */
    parentToolUseId: text("parent_tool_use_id"),
    agentName: text("agent_name").notNull(),
    displayLabel: text("display_label"),
    model: text("model"),
    /** Phase 3: prompt revision hash ("pk1-<sha256>") at session creation. */
    promptHash: text("prompt_hash"),
    status: text("status").$type<SessionStatus>().notNull(),
    phase: text("phase"),
    usageInputTokens: integer("usage_input_tokens").notNull().default(0),
    usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
    createdAt: text("created_at").notNull(),
    endedAt: text("ended_at"),
    /**
     * Added after the table shipped: existing databases gain it through
     * upgradeKernelObservabilitySchema, and readers go through
     * piAgentSessionSelection so un-upgraded read-only handles still work.
     */
    kind: text("kind").$type<SessionKind>().notNull().default(SESSION_KIND.PI),
  },
  (table) => [
    index("ix_pi_agent_sessions_container_id").on(table.containerId),
    index("ix_pi_agent_sessions_parent_session_id").on(table.parentSessionId),
    foreignKey({
      columns: [table.parentSessionId],
      foreignColumns: [table.id],
      name: "pi_agent_sessions_parent_session_id_fkey",
    }),
  ],
);
