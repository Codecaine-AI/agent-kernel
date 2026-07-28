"use client";

/**
 * Trace icon settings — the style rail's `iconSide` / `iconStyle` made
 * available to card chrome that is NOT rendered through SpanCard.
 *
 * The tree threads these as SpanCardViewOptions props. The detail panel builds
 * its content through the renderer contract (a view of blocks), so there is no
 * prop path from the host down to a message card; a context is the one clean
 * way for the panel's cards to wear the SAME cap treatment the tree is wearing.
 * Without a provider the defaults apply, so SSR and unit renders need no setup.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
	DEFAULT_ICON_SIDE,
	DEFAULT_ICON_STYLE,
	type IconSide,
	type IconStyle,
} from "./icon-options";

export interface TraceIconSettings {
	side: IconSide;
	style: IconStyle;
}

const DEFAULT_ICON_SETTINGS: TraceIconSettings = {
	side: DEFAULT_ICON_SIDE,
	style: DEFAULT_ICON_STYLE,
};

const TraceIconSettingsContext = createContext<TraceIconSettings>(
	DEFAULT_ICON_SETTINGS,
);

export function TraceIconSettingsProvider({
	side,
	style,
	children,
}: {
	side?: IconSide;
	style?: IconStyle;
	children: ReactNode;
}) {
	const value = useMemo<TraceIconSettings>(
		() => ({
			side: side ?? DEFAULT_ICON_SETTINGS.side,
			style: style ?? DEFAULT_ICON_SETTINGS.style,
		}),
		[side, style],
	);
	return (
		<TraceIconSettingsContext.Provider value={value}>
			{children}
		</TraceIconSettingsContext.Provider>
	);
}

export function useTraceIconSettings(): TraceIconSettings {
	return useContext(TraceIconSettingsContext);
}
