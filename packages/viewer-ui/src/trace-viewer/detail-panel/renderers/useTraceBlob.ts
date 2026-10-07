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

/** A settled read, tagged with the API base and hash it was read for. */
export interface TraceBlobSlot {
	key: string;
	state: TraceBlobState;
}

/** The identity a read belongs to: the API base and the hash. */
export function traceBlobKey(apiBase: string | null, hash: string | undefined): string {
	return JSON.stringify([apiBase, hash ?? null]);
}

/**
 * What a body shows for `hash` now: the settled read only when it was read for
 * this exact API base and hash; otherwise the resting state (loading online),
 * so a node row that switches to another attempt's blob never shows the old
 * one next to the new verdict.
 */
export function currentTraceBlob(
	slot: TraceBlobSlot | null,
	apiBase: string | null,
	hash: string | undefined,
): TraceBlobState {
	if (slot && slot.key === traceBlobKey(apiBase, hash)) return slot.state;
	return restingState(hash, hasApiBase(apiBase));
}

/**
 * Read one blob and settle it once, unless the returned cancel ran first: a
 * response that arrives after its hash was replaced is dropped.
 */
export function loadTraceBlob(
	apiBase: string,
	hash: string,
	settle: (slot: TraceBlobSlot) => void,
	fetchImpl: typeof fetch = fetch,
): () => void {
	const key = traceBlobKey(apiBase, hash);
	let live = true;
	const finish = (state: TraceBlobState) => {
		if (live) settle({ key, state });
	};
	fetchImpl(blobUrl(apiBase, hash))
		.then(async (response) => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.text();
		})
		.then((text) => finish({ phase: "loaded", hash, text }))
		.catch((error: unknown) =>
			finish({
				phase: "error",
				hash,
				message: error instanceof Error ? error.message : String(error),
			}),
		);
	return () => {
		live = false;
	};
}

export function useTraceBlob(hash: string | undefined): TraceBlobState {
	const { apiBase } = useTraceViewerApi();
	const [slot, setSlot] = useState<TraceBlobSlot | null>(null);

	useEffect(() => {
		if (!hash || !hasApiBase(apiBase)) return;
		// React runs the previous read's cancel before this one starts.
		return loadTraceBlob(apiBase, hash, setSlot);
	}, [apiBase, hash]);

	return currentTraceBlob(slot, apiBase, hash);
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
