"use client";

/**
 * blocks — the detail panel's additive host-extension seam.
 *
 * Hosts return the same data-only block vocabulary as built-in renderers. The
 * shell frames, orders, clamps, and expands every contribution.
 */
import {
	createContext,
	createElement,
	useContext,
	useMemo,
	type Context,
	type JSX,
	type ReactNode,
} from "react";
import type { TraceSpan } from "@evilmartians/agent-prism-types";

import {
	BLOCK_SLOT_ORDER,
	type DetailBlockSpec,
} from "./contract";

export type DetailBlockProvider = (span: TraceSpan) => DetailBlockSpec[];

export const DetailBlocksContext: Context<DetailBlockProvider | null> =
	createContext<DetailBlockProvider | null>(null);

export function DetailBlocksProvider({
	provider,
	children,
}: {
	provider: DetailBlockProvider | null;
	children: ReactNode;
}): JSX.Element {
	return createElement(DetailBlocksContext.Provider, { value: provider }, children);
}

export function compareDetailBlocks(
	a: DetailBlockSpec,
	b: DetailBlockSpec,
): number {
	return (
		BLOCK_SLOT_ORDER.indexOf(a.slot) - BLOCK_SLOT_ORDER.indexOf(b.slot) ||
		(a.order ?? 0) - (b.order ?? 0) ||
		a.id.localeCompare(b.id)
	);
}

/**
 * Merge renderer-owned and host-contributed blocks into one standard ordering.
 * Renderer ids win collisions so an extension cannot replace built-in content.
 *
 * For a tabbed DetailView the shell calls this for the FIRST (default) tab
 * only; later tabs remain exactly as the renderer declared them.
 */
export function mergeDetailBlockLists(
	baseBlocks: readonly DetailBlockSpec[],
	extensionBlocks: readonly DetailBlockSpec[],
): DetailBlockSpec[] {
	const seen = new Set<string>();
	const merged: DetailBlockSpec[] = [];
	for (const block of [...baseBlocks, ...extensionBlocks]) {
		if (seen.has(block.id)) continue;
		seen.add(block.id);
		merged.push(block);
	}
	return merged.sort(compareDetailBlocks);
}

/**
 * Resolve all extension blocks deterministically. A provider is optional and
 * untrusted: duplicate ids keep their first block, and provider errors degrade
 * to the same empty result as an unconfigured host.
 */
export function useDetailBlocks(span: TraceSpan): DetailBlockSpec[] {
	const provider = useContext(DetailBlocksContext);

	return useMemo(() => {
		if (!provider) return [];

		let provided: DetailBlockSpec[];
		try {
			provided = provider(span);
		} catch {
			return [];
		}

		const seen = new Set<string>();
		const blocks: DetailBlockSpec[] = [];
		for (const block of provided) {
			if (seen.has(block.id)) continue;
			seen.add(block.id);
			blocks.push(block);
		}

		return blocks.sort(compareDetailBlocks);
	}, [provider, span]);
}
