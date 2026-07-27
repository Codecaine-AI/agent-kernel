"use client";

/**
 * TraceViewerApiContext — tells detail-panel renderers where the kernel trace
 * read API lives, so content-addressed payloads (request-snapshot blobs,
 * per-turn context) can be fetched on demand.
 *
 * Deliberately optional: the default is `{ apiBase: null }` and nothing in the
 * detail panel requires a provider. Renderers read it with useTraceViewerApi()
 * and degrade to their offline summary when apiBase is null.
 *
 * ONLY `null` means offline. The empty string is a real, supported value: it
 * means same-origin, so requests go to relative paths ("/kernel/runs/…") — the
 * normal setup when the viewer is served by the kernel host itself. Renderers
 * must therefore test `apiBase === null`, never truthiness.
 */
import { createContext, useContext } from "react";

export interface TraceViewerApiContextValue {
	/**
	 * Origin/prefix of the kernel trace read API, without a trailing slash.
	 *
	 *   "https://kernel.example"  → absolute
	 *   ""                        → same-origin; URLs come out relative
	 *   null                      → offline; renderers show their summary only
	 */
	apiBase: string | null;
}

export const TraceViewerApiContext = createContext<TraceViewerApiContextValue>({
	apiBase: null,
});

export function useTraceViewerApi(): TraceViewerApiContextValue {
	return useContext(TraceViewerApiContext);
}
