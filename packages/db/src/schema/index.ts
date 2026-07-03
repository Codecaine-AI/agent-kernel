/**
 * SQLite schema (default dialect). One database file per kernel:
 * .agent-kernel/trace.db, opened with Bun's built-in SQLite driver
 * through Drizzle (see ../client.ts).
 *
 * A compiling Postgres mirror for shared-plane deployments lives in
 * ./pg.ts and is exported via the "@agent-kernel/db/schema/pg" subpath.
 */
export {
  containers,
  CONTAINER_STATUS,
  type ContainerStatus,
} from "./containers";
export {
  piAgentSessions,
  SESSION_STATUS,
  type SessionStatus,
} from "./pi-agent-sessions";
export {
  agentRuns,
  RUN_STATUS,
  RUN_TRIGGER,
  type RunStatus,
  type RunTrigger,
} from "./agent-runs";
export { traceEvents } from "./trace-events";
export {
  promptRevisions,
  PROMPT_REVISION_SOURCE,
  type PromptRevisionSource,
} from "./prompt-revisions";
