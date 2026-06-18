let defaultMaxTurns: number | undefined;
let graceTurns = 5;

export function normalizeMaxTurns(n: number | undefined): number | undefined {
	if (n == null || n === 0) return undefined;
	return Math.max(1, n);
}

export function getDefaultMaxTurns(): number | undefined {
	return defaultMaxTurns;
}

export function setDefaultMaxTurns(n: number | undefined): void {
	defaultMaxTurns = normalizeMaxTurns(n);
}

export function getGraceTurns(): number {
	return graceTurns;
}

export function setGraceTurns(n: number): void {
	graceTurns = Math.max(1, n);
}
