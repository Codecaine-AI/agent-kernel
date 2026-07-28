"use client";

/**
 * DetailStream — the shell-owned chrome for a zoned tab.
 *
 * A zoned tab is a subtab row — State | Messages — showing exactly ONE surface
 * at a time. See docs/10-system-design/explainers/state-tab-options.html R2.1.
 *
 * There is deliberately NO index rail and NO focus posture: Ford rejected both
 * on review — "the sidebar view makes it very hard to see what's actually going
 * on", then "I don't really love this focus state... I'm trying to have things
 * render more in line". The subtabs are the only wayfinding; a piece's own
 * modal ⤢ is its only way to a bigger reading surface.
 *
 * Renderers still return only data: zones name surfaces of their own blocks.
 * Everything visible here is the shell's.
 */
import type { JSX, ReactNode } from "react";
import cn from "classnames";

import type { DetailBlockSpec, DetailZone } from "./contract";

/** Split a tab's blocks into its declared surfaces plus whatever no zone claimed. */
export function partitionZoneBlocks(
	blocks: readonly DetailBlockSpec[],
	zones: readonly DetailZone[],
): {
	zoned: Array<{ zone: DetailZone; blocks: DetailBlockSpec[] }>;
	rest: DetailBlockSpec[];
} {
	const byId = new Map(blocks.map((block) => [block.id, block]));
	const claimed = new Set<string>();
	const zoned = zones.map((zone) => ({
		zone,
		blocks: zone.blockIds.flatMap((id) => {
			const block = byId.get(id);
			if (!block || claimed.has(id)) return [];
			claimed.add(id);
			return [block];
		}),
	}));
	return {
		zoned,
		rest: blocks.filter((block) => !claimed.has(block.id)),
	};
}

/**
 * The subtab row. One surface at a time is the rule Ford set: State and
 * Messages are alternatives, never a stack. Same active treatment as the tab
 * row above it, one scale quieter.
 *
 * The label is the whole subtab — no counts on the triggers and no meta line
 * beneath the row (both cut on review 2026-07-28). The row says which surface
 * you are on; the surface itself says what is on it.
 */
export function DetailSubtabs({
	zones,
	activeZoneId,
	idPrefix,
	onSelect,
}: {
	zones: readonly DetailZone[];
	activeZoneId: string;
	idPrefix: string;
	onSelect: (zoneId: string) => void;
}): JSX.Element {
	return (
		<div data-detail-subtabs="" className="min-w-0">
			<div
				role="tablist"
				aria-label="Turn surfaces"
				className="flex min-w-0 overflow-hidden rounded-[3px] border border-border bg-muted"
			>
				{zones.map((zone, index) => {
					const on = zone.id === activeZoneId;
					return (
						<button
							key={zone.id}
							id={`${idPrefix}-subtab-${zone.id}`}
							type="button"
							role="tab"
							data-detail-subtab-trigger={zone.id}
							aria-selected={on}
							aria-controls={`${idPrefix}-subtabpanel-${zone.id}`}
							tabIndex={on ? 0 : -1}
							onClick={() => onSelect(zone.id)}
							className={cn(
								"flex min-w-0 flex-1 items-baseline justify-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-status-info-border",
								index > 0 && "border-l border-border",
								on
									? "bg-status-info-fill text-status-info"
									: "bg-muted text-muted-foreground hover:bg-background hover:text-foreground",
							)}
						>
							<span className="truncate">{zone.name}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function DetailZones({
	zoned,
	rest,
	activeZoneId,
	idPrefix,
	renderBlock,
}: {
	zoned: ReadonlyArray<{ zone: DetailZone; blocks: DetailBlockSpec[] }>;
	rest: readonly DetailBlockSpec[];
	activeZoneId: string;
	idPrefix: string;
	renderBlock: (block: DetailBlockSpec) => ReactNode;
}): JSX.Element {
	return (
		<>
			{zoned.map(({ zone, blocks }) => {
				const on = zone.id === activeZoneId;
				return (
					<section
						key={zone.id}
						id={`${idPrefix}-subtabpanel-${zone.id}`}
						role="tabpanel"
						data-detail-zone={zone.id}
						aria-labelledby={`${idPrefix}-subtab-${zone.id}`}
						hidden={!on}
						className="min-w-0 space-y-4"
					>
						{blocks.map((block) => renderBlock(block))}
					</section>
				);
			})}
			{rest.map((block) => renderBlock(block))}
		</>
	);
}
