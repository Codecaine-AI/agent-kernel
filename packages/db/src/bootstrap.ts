/**
 * Schema bootstrap — CREATE TABLE IF NOT EXISTS statements mirroring the
 * Drizzle SQLite schema in ./schema. No migration tooling: the schema is
 * created idempotently on kernel start against the local trace.db.
 */
import { sql } from "drizzle-orm";
import type { KernelDatabase } from "./client";

export async function ensureKernelObservabilitySchema(
  db: KernelDatabase,
): Promise<void> {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS containers (
      id                  TEXT PRIMARY KEY,
      kernel_id           TEXT NOT NULL,
      kind                TEXT NOT NULL,
      app_key             TEXT NOT NULL,
      label               TEXT,
      status              TEXT NOT NULL DEFAULT 'active',
      parent_container_id TEXT REFERENCES containers(id),
      phase               TEXT,
      phase_vocabulary    TEXT,
      working_dir         TEXT,
      metadata            TEXT,
      usage_input_tokens  INTEGER NOT NULL DEFAULT 0,
      usage_output_tokens INTEGER NOT NULL DEFAULT 0,
      usage_cache_read    INTEGER NOT NULL DEFAULT 0,
      usage_cache_write   INTEGER NOT NULL DEFAULT 0,
      usage_cost_estimate REAL,
      created_at          TEXT NOT NULL,
      started_at          TEXT,
      ended_at            TEXT,
      UNIQUE (kernel_id, kind, app_key)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS pi_agent_sessions (
      id                  TEXT PRIMARY KEY,
      container_id        TEXT NOT NULL REFERENCES containers(id),
      parent_session_id   TEXT REFERENCES pi_agent_sessions(id),
      parent_tool_use_id  TEXT,
      agent_name          TEXT NOT NULL,
      display_label       TEXT,
      model               TEXT,
      prompt_hash         TEXT,
      status              TEXT NOT NULL,
      phase               TEXT,
      usage_input_tokens  INTEGER NOT NULL DEFAULT 0,
      usage_output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL,
      ended_at            TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id                  TEXT PRIMARY KEY,
      pi_session_id       TEXT NOT NULL REFERENCES pi_agent_sessions(id),
      container_id        TEXT NOT NULL REFERENCES containers(id),
      parent_run_id       TEXT REFERENCES agent_runs(id),
      parent_tool_use_id  TEXT,
      agent_name          TEXT NOT NULL,
      trigger             TEXT NOT NULL,
      inbound_event_id    TEXT,
      outbound_event_id   TEXT,
      display_label       TEXT,
      phase               TEXT,
      status              TEXT NOT NULL,
      usage_input_tokens  INTEGER NOT NULL DEFAULT 0,
      usage_output_tokens INTEGER NOT NULL DEFAULT 0,
      usage_cache_read    INTEGER NOT NULL DEFAULT 0,
      usage_cache_write   INTEGER NOT NULL DEFAULT 0,
      usage_cost_estimate REAL,
      started_at          TEXT NOT NULL,
      ended_at            TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS trace_events (
      event_id        TEXT PRIMARY KEY,
      container_id    TEXT NOT NULL,
      run_id          TEXT,
      pi_session_id   TEXT,
      agent_id        TEXT,
      user_id         TEXT,
      type            TEXT NOT NULL,
      source          TEXT NOT NULL,
      trace_level     INTEGER NOT NULL,
      event_data      TEXT NOT NULL,
      span_id         TEXT,
      parent_event_id TEXT,
      timestamp       TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS prompt_revisions (
      hash            TEXT PRIMARY KEY,
      agent_name      TEXT NOT NULL,
      schema_version  TEXT NOT NULL,
      document        TEXT NOT NULL,
      rendered_text   TEXT NOT NULL,
      source          TEXT NOT NULL,
      created_at      TEXT NOT NULL
    )
  `);

  const indexes = [
    sql`CREATE INDEX IF NOT EXISTS idx_events_container_ts ON trace_events (container_id, timestamp)`,
    sql`CREATE INDEX IF NOT EXISTS idx_events_run ON trace_events (run_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_containers_parent_container_id ON containers (parent_container_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_pi_agent_sessions_container_id ON pi_agent_sessions (container_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_pi_agent_sessions_parent_session_id ON pi_agent_sessions (parent_session_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_agent_runs_pi_session_id ON agent_runs (pi_session_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_agent_runs_container_id ON agent_runs (container_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_agent_runs_parent_run_id ON agent_runs (parent_run_id)`,
  ];

  for (const statement of indexes) {
    db.run(statement);
  }
}
