import { sql } from "drizzle-orm";

type KernelDatabase = {
  execute(query: unknown): Promise<unknown>;
};

export async function ensureKernelObservabilitySchema(db: KernelDatabase): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE agent_status AS ENUM (
        'queued',
        'running',
        'completed',
        'aborted',
        'stopped',
        'error'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kernel_registrations (
      kernel_id varchar PRIMARY KEY NOT NULL,
      display_name varchar NOT NULL,
      working_dir varchar NOT NULL,
      pi_sessions_dir varchar NOT NULL,
      app_base_url varchar,
      app_trace_url_template varchar,
      generic_trace_url_template varchar,
      marker_config jsonb NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      registered_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS containers (
      id varchar PRIMARY KEY NOT NULL,
      parent_container_id varchar REFERENCES containers(id),
      label varchar NOT NULL,
      status varchar NOT NULL DEFAULT 'running',
      working_dir varchar,
      worktree_path varchar,
      phase varchar,
      phase_vocabulary jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      started_at timestamp,
      completed_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pi_agent_sessions (
      id uuid PRIMARY KEY NOT NULL,
      app_session_id uuid,
      parent_id uuid REFERENCES pi_agent_sessions(id),
      container_id varchar,
      phase varchar,
      display_label varchar,
      agent_name varchar NOT NULL,
      status agent_status NOT NULL DEFAULT 'running',
      model varchar,
      started_at timestamp,
      completed_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id uuid PRIMARY KEY NOT NULL,
      pi_session_id uuid NOT NULL REFERENCES pi_agent_sessions(id),
      agent_name varchar NOT NULL,
      container_id varchar,
      phase varchar,
      parent_run_id uuid REFERENCES agent_runs(id),
      display_label varchar,
      parent_tool_use_id varchar,
      run_number integer NOT NULL,
      status agent_status NOT NULL DEFAULT 'running',
      started_at timestamp,
      completed_at timestamp,
      input_tokens integer,
      output_tokens integer,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS trace_events (
      id uuid PRIMARY KEY NOT NULL,
      app_session_id uuid NOT NULL,
      container_id varchar,
      user_id uuid NOT NULL,
      type varchar NOT NULL,
      source varchar NOT NULL,
      trace_level integer NOT NULL,
      event_data json NOT NULL,
      pi_session_id uuid REFERENCES pi_agent_sessions(id),
      span_id varchar,
      parent_event_id varchar,
      timestamp timestamp NOT NULL
    )
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_runs' AND column_name = 'agent_name'
      ) THEN
        ALTER TABLE agent_runs ADD COLUMN agent_name varchar;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_runs' AND column_name = 'parent_run_id'
      ) THEN
        ALTER TABLE agent_runs ADD COLUMN parent_run_id uuid;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agent_runs' AND column_name = 'display_label'
      ) THEN
        ALTER TABLE agent_runs ADD COLUMN display_label varchar;
      END IF;
    END $$;
  `);
  await db.execute(sql`
    UPDATE agent_runs
    SET agent_name = pi_agent_sessions.agent_name
    FROM pi_agent_sessions
    WHERE agent_runs.pi_session_id = pi_agent_sessions.id
      AND agent_runs.agent_name IS NULL
  `);
  await db.execute(sql`ALTER TABLE agent_runs ALTER COLUMN agent_name SET NOT NULL`);

  const indexes = [
    sql`CREATE INDEX IF NOT EXISTS ix_kernel_registrations_pi_sessions_dir ON kernel_registrations USING btree (pi_sessions_dir)`,
    sql`CREATE INDEX IF NOT EXISTS ix_kernel_registrations_last_seen_at ON kernel_registrations USING btree (last_seen_at)`,
    sql`CREATE INDEX IF NOT EXISTS ix_containers_parent_container_id ON containers USING btree (parent_container_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_containers_status ON containers USING btree (status)`,
    sql`CREATE INDEX IF NOT EXISTS ix_containers_phase ON containers USING btree (phase)`,
    sql`CREATE INDEX IF NOT EXISTS ix_pi_agent_sessions_app_session_id ON pi_agent_sessions USING btree (app_session_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_pi_agent_sessions_parent_id ON pi_agent_sessions USING btree (parent_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_pi_agent_sessions_container_id ON pi_agent_sessions USING btree (container_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_pi_agent_sessions_status ON pi_agent_sessions USING btree (status)`,
    sql`CREATE INDEX IF NOT EXISTS ix_agent_runs_pi_session_id ON agent_runs USING btree (pi_session_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_agent_runs_container_id ON agent_runs USING btree (container_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_agent_runs_parent_run_id ON agent_runs USING btree (parent_run_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_agent_runs_status ON agent_runs USING btree (status)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_app_session_id ON trace_events USING btree (app_session_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_container_id ON trace_events USING btree (container_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_app_session_type ON trace_events USING btree (app_session_id, type)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_span_id ON trace_events USING btree (span_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_timestamp ON trace_events USING btree (timestamp)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_type ON trace_events USING btree (type)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_pi_session_id ON trace_events USING btree (pi_session_id)`,
    sql`CREATE INDEX IF NOT EXISTS ix_trace_events_source ON trace_events USING btree (source)`,
  ];

  for (const index of indexes) {
    await db.execute(index);
  }
}
