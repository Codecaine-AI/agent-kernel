"use client";

/**
 * TraceViewerApiContext — tells detail-panel renderers where the kernel trace
 * read API lives, so content-addressed payloads (request-snapshot blobs,
 * per-turn context) can be fetched on demand.
 *
 * Deliberately optional: the default is `{ apiBase: null }` and nothing in the
 * detail panel requires a provider. Renderers read it with useTraceViewerApi()
 * and degrade to their offline summary when apiBase is null.
 */
import { createContext, useContext } from "react";

export interface TraceViewerApiContextValue {
	/** Origin/prefix of the kernel trace read API (no trailing slash), or null. */
	apiBase: string | null;
}

export const TraceViewerApiContext = createContext<TraceViewerApiContextValue>({
	apiBase: null,
});

export function useTraceViewerApi(): TraceViewerApiContextValue {
	return useContext(TraceViewerApiContext);
}
