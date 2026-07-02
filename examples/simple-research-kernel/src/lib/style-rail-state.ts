export const STYLE_RAIL_MIN_WIDTH = 340;
export const STYLE_RAIL_MAX_WIDTH = 560;
const STYLE_RAIL_DEFAULT_WIDTH = 380;

export function loadStyleRailCollapsed(): boolean {
	try {
		const params = new URLSearchParams(window.location.search);
		if (params.get("style") === "open") return false;
		const stored = localStorage.getItem("simpleResearchStyleRailCollapsed");
		return stored === null ? true : stored === "1";
	} catch {
		return true;
	}
}

export function saveStyleRailCollapsed(collapsed: boolean) {
	try {
		localStorage.setItem("simpleResearchStyleRailCollapsed", collapsed ? "1" : "0");
	} catch {
		// The rail still works if storage is unavailable.
	}
}

export function clampStyleRailWidth(width: number): number {
	if (!Number.isFinite(width)) return STYLE_RAIL_DEFAULT_WIDTH;
	return Math.min(STYLE_RAIL_MAX_WIDTH, Math.max(STYLE_RAIL_MIN_WIDTH, Math.round(width)));
}

export function loadStyleRailWidth(): number {
	try {
		const stored = localStorage.getItem("simpleResearchStyleRailWidth");
		if (stored === null) return STYLE_RAIL_DEFAULT_WIDTH;
		return clampStyleRailWidth(Number(stored));
	} catch {
		return STYLE_RAIL_DEFAULT_WIDTH;
	}
}

export function saveStyleRailWidth(width: number) {
	try {
		localStorage.setItem("simpleResearchStyleRailWidth", String(width));
	} catch {
		// The rail still works if storage is unavailable.
	}
}
