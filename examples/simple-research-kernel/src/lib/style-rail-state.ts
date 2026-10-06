/** App binding for the shared style-rail chrome state (see style-settings). */
import {
	clampStyleRailWidth,
	loadStyleRailCollapsed as loadShared,
	loadStyleRailWidth as loadWidthShared,
	saveStyleRailCollapsed as saveShared,
	saveStyleRailWidth as saveWidthShared,
	STYLE_RAIL_MAX_WIDTH,
	STYLE_RAIL_MIN_WIDTH
} from "@agent-kernel/viewer-shell";

import { RESEARCH_STYLE_CONFIG } from "./style-settings";

export { clampStyleRailWidth, STYLE_RAIL_MAX_WIDTH, STYLE_RAIL_MIN_WIDTH };

export const loadStyleRailCollapsed = () => loadShared(RESEARCH_STYLE_CONFIG);
export const saveStyleRailCollapsed = (collapsed: boolean) => saveShared(RESEARCH_STYLE_CONFIG, collapsed);
export const loadStyleRailWidth = () => loadWidthShared(RESEARCH_STYLE_CONFIG);
export const saveStyleRailWidth = (width: number) => saveWidthShared(RESEARCH_STYLE_CONFIG, width);

/**
 * The width the user dragged the style inspector to, or null when they never did: the
 * inspector then keeps the shell's width token (guide/layout.md, --ds-layout-inspector-width).
 */
export function loadStoredStyleRailWidth(): number | null {
	try {
		if (localStorage.getItem(RESEARCH_STYLE_CONFIG.railWidthStorageKey) === null) return null;
	} catch {
		return null;
	}
	return loadStyleRailWidth();
}
