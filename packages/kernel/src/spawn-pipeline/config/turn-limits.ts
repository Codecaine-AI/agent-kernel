/**
 * Turns a run may take past its soft turn limit (the wrap-up steer) before
 * the session is aborted.
 */
export const GRACE_TURNS = 5;

/**
 * A missing or zero limit means unlimited. There is no process-wide default:
 * a spawn with neither a per-spawn nor a per-agent `maxTurns` runs unlimited.
 */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
	if (n == null || n === 0) return undefined;
	return Math.max(1, n);
}
