/**
 * Postgres mirror of the kernel observability schema, for shared-plane
 * deployments. Column names, row shapes, and constraints match the SQLite
 * schema in ./ (timestamps stay ISO-8601 TEXT so rows are shape-identical
 * across dialects).
 *
 * NOTE: the actions layer (../actions) is SQLite-first for now — it is typed
 * against the bun-sqlite Drizzle handle and imports the SQLite tables.
 * Shared-plane deployments that target Postgres should query these tables
 * directly (or contribute a pg actions variant) until actions go dual-dialect.
 *
 * Exported only via the "@agent-kernel/db/schema/pg" subpath so the default
 * entrypoint stays SQLite-only.
 */
import {
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Postgres bytea, surfaced as a Buffer to match the SQLite BLOB column
 * (drizzle-orm/pg-core has no built-in bytea type).
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const containers = pgTable(
  "containers",
  {
    id: text("id").primaryKey(),
    kernelId: text("kernel_id").notNull(),
    kind: text("kind").notNull(),
    appKey: jsonb("app_key").$type<string[]>().notNull(),
    label: text("label"),
    status: text("status").notNull().default("active"),
    parentContainerId: text("parent_container_id"),
    phase: text("phase"),
    phaseVocabulary: jsonb("phase_vocabulary").$type<string[]>(),
    workingDir: text("working_dir"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    usageInputTokens: integer("usage_input_tokens").notNull().default(0),
    usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
    usageCacheRead: integer("usage_cache_read").notNull().default(0),
    usageCacheWrite: integer("usage_cache_write").notNull().default(0),
    usageCostEstimate: real("usage_cost_estimate"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
  },
  (table) => [
    unique("ux_containers_kernel_kind_app_key").on(
      table.kernelId,
      table.kind,
      table.appKey,
    ),
    index("ix_containers_parent_container_id").on(table.parentContainerId),
    foreignKey({
      columns: [table.parentContainerId],
      foreignColumns: [table.id],
      name: "containers_parent_container_id_fkey",
    }),
  ],
);

export const piAgentSessions = pgTable(
  "pi_agent_sessions",
  {
    id: text("id").primaryKey(),
    containerId: text("container_id")
      .notNull()
      .references(() => containers.id),
    parentSessionId: text("parent_session_id"),
    parentToolUseId: text("parent_tool_use_id"),
    agentName: text("agent_name").notNull(),
    displayLabel: text("display_label"),
    model: text("model"),
    promptHash: text("prompt_hash"),
    status: text("status").notNull(),
    phase: text("phase"),
    usageInputTokens: integer("usage_input_tokens").notNull().default(0),
    usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
    createdAt: text("created_at").notNull(),
    endedAt: text("ended_at"),
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

export const agentRuns = pgTable(
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
    trigger: text("trigger").notNull(),
    inboundEventId: text("inbound_event_id"),
    outboundEventId: text("outbound_event_id"),
    displayLabel: text("display_label"),
    phase: text("phase"),
    status: text("status").notNull(),
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

export const traceEvents = pgTable(
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
    eventData: jsonb("event_data").notNull(),
    spanId: text("span_id"),
    parentEventId: text("parent_event_id"),
    timestamp: text("timestamp").notNull(),
  },
  (table) => [
    index("idx_events_container_ts").on(table.containerId, table.timestamp),
    index("idx_events_run").on(table.runId),
  ],
);

export const traceBlobs = pgTable("trace_blobs", {
  hash: text("hash").primaryKey(),
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  byteLength: integer("byte_length").notNull(),
  data: bytea("data").notNull(),
  createdAt: text("created_at").notNull(),
});

export const promptRevisions = pgTable("prompt_revisions", {
  hash: text("hash").primaryKey(),
  agentName: text("agent_name").notNull(),
  schemaVersion: text("schema_version").notNull(),
  document: text("document").notNull(),
  renderedText: text("rendered_text").notNull(),
  source: text("source").notNull(),
  createdAt: text("created_at").notNull(),
});
