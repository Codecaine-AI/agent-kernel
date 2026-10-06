import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";

import { clampStyleRailWidth, loadStoredStyleRailWidth, saveStyleRailWidth } from "./style-rail-state";

/**
 * The inspector's drag edge: the dragged width (null until the user drags, so the shell's
 * width token applies), whether a drag is under way, and the pointerdown handler that starts one.
 */
export function useInspectorResize() {
	const [styleRailWidth, setStyleRailWidth] = useState(loadStoredStyleRailWidth);
	const [styleRailResizing, setStyleRailResizing] = useState(false);

	const startStyleRailResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		setStyleRailResizing(true);
		let width: number | null = null;
		const onMove = (moveEvent: PointerEvent) => {
			// The inspector ends at the root's client edge, left of a classic vertical scrollbar.
			width = clampStyleRailWidth(document.documentElement.clientWidth - moveEvent.clientX);
			setStyleRailWidth(width);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			setStyleRailResizing(false);
			if (width !== null) saveStyleRailWidth(width);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	}, []);

	return { styleRailWidth, styleRailResizing, startStyleRailResize };
}
