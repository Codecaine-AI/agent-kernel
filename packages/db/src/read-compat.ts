/**
 * Read compatibility with databases that predate a column.
 *
 * Read-only handles (viewers, the read API) cannot upgrade the schema, so
 * selecting a column that an older database lacks would fail. Readers select
 * through these concrete Drizzle selections instead, which substitute the
 * column's default when it is missing and keep the declared row types.
 */
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { KernelDatabase } from "./client";
import { piAgentSessions, type SessionKind } from "./schema/pi-agent-sessions";
import { hasSessionKindColumn } from "./upgrade";

const { kind: _kind, ...piAgentSessionBaseColumns } =
  getTableColumns(piAgentSessions);

export type PiAgentSessionSelection = typeof piAgentSessionBaseColumns & {
  kind: SQL.Aliased<SessionKind>;
};

/**
 * Every pi_agent_sessions column, with `kind` read as 'pi' when the column
 * does not exist yet. Rows keep the PiAgentSession shape:
 * `db.select(piAgentSessionSelection(db)).from(piAgentSessions)`.
 */
export function piAgentSessionSelection(
  db: KernelDatabase,
): PiAgentSessionSelection {
  return {
    ...piAgentSessionBaseColumns,
    kind: hasSessionKindColumn(db)
      ? sql<SessionKind>`${piAgentSessions.kind}`.as("kind")
      : sql<SessionKind>`'pi'`.as("kind"),
  };
}
