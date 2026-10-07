/**
 * A kernel database as it existed before pi_agent_sessions.kind: the
 * bootstrap DDL at dd3683d, written with raw SQL so no current code path is
 * involved in creating it.
 */
import { Database } from "bun:sqlite";

const PRE_KIND_DDL = `
  CREATE TABLE containers (
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
  );
  CREATE TABLE pi_agent_sessions (
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
  );
  CREATE TABLE agent_runs (
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
  );
  CREATE TABLE trace_events (
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
  );
  CREATE TABLE trace_blobs (
    hash            TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    byte_length     INTEGER NOT NULL,
    data            BLOB NOT NULL,
    created_at      TEXT NOT NULL
  );
  CREATE TABLE prompt_revisions (
    hash            TEXT PRIMARY KEY,
    agent_name      TEXT NOT NULL,
    schema_version  TEXT NOT NULL,
    document        TEXT NOT NULL,
    rendered_text   TEXT NOT NULL,
    source          TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX idx_events_run ON trace_events (run_id);
  CREATE INDEX idx_events_pi_session ON trace_events (pi_session_id);
`;

/**
 * Create a pre-kind database at `path` holding one container ("c1") and one
 * Pi session ("s1") in it.
 */
export function createPreKindDatabase(path: string): void {
  const sqlite = new Database(path, { create: true });
  try {
    sqlite.exec("PRAGMA journal_mode = WAL;");
    sqlite.exec(PRE_KIND_DDL);
    sqlite.exec(`
      INSERT INTO containers (id, kernel_id, kind, app_key, created_at)
        VALUES ('c1', 'kern-1', 'session', '["req-1"]', '2026-10-01T00:00:00.000Z');
      INSERT INTO pi_agent_sessions (id, container_id, agent_name, status, created_at)
        VALUES ('s1', 'c1', 'coordinator', 'active', '2026-10-01T00:00:01.000Z');
    `);
  } finally {
    sqlite.close();
  }
}

/** Column names of a table, read through a separate raw connection. */
export function tableColumnNames(path: string, table: string): string[] {
  const sqlite = new Database(path, { readonly: true });
  try {
    return sqlite
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name);
  } finally {
    sqlite.close();
  }
}
