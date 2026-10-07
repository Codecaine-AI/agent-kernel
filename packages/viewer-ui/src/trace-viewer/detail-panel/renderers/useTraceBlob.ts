"use client";

/**
 * useTraceBlob — fetch one content-addressed trace blob (GET /kernel/blobs/:hash)
 * as text for a model-node body: a call's input args and output, a
 * decision's classifier context. Offline (no apiBase) and blob-less spans
 * never fetch; the body shows the hash instead.
 */
import { useEffect, useState } from "react";

import type { BlockSlot, DetailBlockSpec } from "../contract";
import { CLAMP } from "../doc-figure/clamp";
import { useTraceViewerApi } from "../TraceViewerApiContext";
import { blobUrl, hasApiBase } from "./request-snapshot-api";

export type TraceBlobState =
	/** The span names no blob. */
	| { phase: "absent" }
	/** No read API is configured, so the blob cannot be fetched. */
	| { phase: "offline"; hash: string }
	| { phase: "loading"; hash: string }
	| { phase: "error"; hash: string; message: string }
	| { phase: "loaded"; hash: string; text: string };

function restingState(hash: string | undefined, online: boolean): TraceBlobState {
	if (!hash) return { phase: "absent" };
	return online ? { phase: "loading", hash } : { phase: "offline", hash };
}

export function useTraceBlob(hash: string | undefined): TraceBlobState {
	const { apiBase } = useTraceViewerApi();
	const [state, setState] = useState<TraceBlobState>(() =>
		restingState(hash, hasApiBase(apiBase)),
	);

	useEffect(() => {
		if (!hash || !hasApiBase(apiBase)) {
			setState(restingState(hash, false));
			return;
		}
		let cancelled = false;
		setState({ phase: "loading", hash });
		fetch(blobUrl(apiBase, hash))
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.text();
			})
			.then((text) => {
				if (!cancelled) setState({ phase: "loaded", hash, text });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setState({
					phase: "error",
					hash,
					message: error instanceof Error ? error.message : String(error),
				});
			});
		return () => {
			cancelled = true;
		};
	}, [apiBase, hash]);

	return state;
}

/**
 * The stand-in block while a blob is not readable: `<id>-pending` while it
 * loads, `<id>-unavailable` offline or after a failed read. Null when the
 * blob loaded (the caller renders it under `<id>`) or the span has none, so
 * a route waiting on `<id>` only ever matches real content.
 */
export function blobStatusBlock(
	state: TraceBlobState,
	spec: { id: string; caption: string; slot: BlockSlot; order: number },
): DetailBlockSpec | null {
	const base = {
		slot: spec.slot,
		order: spec.order,
		caption: spec.caption,
		language: "text" as const,
		clamp: CLAMP.tight,
		expandable: false,
	};
	switch (state.phase) {
		case "absent":
		case "loaded":
			return null;
		case "loading":
			return { ...base, id: `${spec.id}-pending`, body: `Loading trace blob ${state.hash}…` };
		case "offline":
			return {
				...base,
				id: `${spec.id}-unavailable`,
				body: `Stored as trace blob ${state.hash}. Connect the kernel read API to load it.`,
			};
		case "error":
			return {
				...base,
				id: `${spec.id}-unavailable`,
				body: `Trace blob ${state.hash} could not be read: ${state.message}.`,
			};
	}
}
