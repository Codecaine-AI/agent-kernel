import { useCallback, useRef, useState } from "react";

import { loadStyleRailCollapsed, saveStyleRailCollapsed } from "./style-rail-state";

/**
 * The style inspector's open state: stored under the style engine's rail key (`?style=open`
 * forces it open), and the Style button it returns focus to.
 */
export function useStyleInspector() {
	const [styleOpen, setStyleOpen] = useState(() => !loadStyleRailCollapsed());
	const styleButtonRef = useRef<HTMLButtonElement>(null);

	const openStyle = useCallback(() => {
		setStyleOpen(true);
		saveStyleRailCollapsed(false);
	}, []);

	// Every close path (the inspector's close button, Escape inside it, the Style button)
	// returns focus to Style, also when the inspector mounted open and the shell saw no opener.
	const closeStyle = useCallback(() => {
		setStyleOpen(false);
		saveStyleRailCollapsed(true);
		styleButtonRef.current?.focus({ preventScroll: true });
	}, []);

	return { styleOpen, styleButtonRef, openStyle, closeStyle };
}
