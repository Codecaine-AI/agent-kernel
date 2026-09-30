/**
 * Skip guard for tests that read reviewed rows from the sibling canvas repo's
 * local trace.db. That database is a developer-local capture: it can be
 * missing, and it can exist without the specific reviewed rows (a fresh or
 * rotated capture). Either way the capture is unavailable and the tests skip.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

export interface CaptureProbe {
	/** A select that returns at least one row when the reviewed row exists. */
	sql: string;
	params: string[];
}

export const REVIEWED_EVENT_SQL =
	"select 1 from trace_events where event_id = ? and container_id = ? and pi_session_id = ?";

/**
 * True only when the database exists AND every probe finds a row. Opens the
 * database read-only and never throws, so it is safe at module load.
 */
export function hasCapturedRows(
	dbPath: string,
	probes: readonly CaptureProbe[],
): boolean {
	if (!existsSync(dbPath)) return false;
	try {
		const db = new Database(dbPath, { readonly: true });
		try {
			return probes.every(
				({ sql, params }) => db.query(sql).get(...params) != null,
			);
		} finally {
			db.close();
		}
	} catch {
		return false;
	}
}
