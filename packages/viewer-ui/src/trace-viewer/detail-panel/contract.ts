import type { ReactNode } from "react";

import type { DocInlineRow } from "./doc-figure/DocFigure";
import type { DocLanguage } from "./doc-figure/tokenize";
import type { ClampPolicy } from "./doc-figure/clamp";
import type { RendererProps } from "./types";

export type BlockSlot = "input" | "content" | "output" | "media";

export const BLOCK_SLOT_ORDER = [
	"input",
	"content",
	"output",
	"media",
] as const;

export interface DetailBlockSpec {
	/** Stable, unique within one view. Extensions namespace theirs, e.g. "canvas:thinking". */
	id: string;
	slot: BlockSlot;
	/** The doc-figure caption. Required — an uncaptioned block is not in the vocabulary. */
	caption: string;
	/** Source text, rendered through DocFigure. Mutually exclusive with `node`. */
	body?: string;
	language?: DocLanguage;
	/**
	 * Non-source rows embedded IN the body's line flow at their reference lines
	 * — attached renders sitting at their `<views>` line rather than beside the
	 * figure as a second card. Presentation only: the body's text is untouched.
	 */
	inlineRows?: readonly DocInlineRow[];
	/**
	 * Render with the shared line-number gutter + zebra substrate. Source/data
	 * bodies default to true in DocFigure; false is the explicit rare opt-out.
	 */
	gutter?: boolean;
	/**
	 * Non-source content rendered immediately after a body figure, such as
	 * image attachments that accompanied prompt source. The shell owns its
	 * placement; renderers still supply inner content only.
	 */
	attachments?: ReactNode;
	clamp?: ClampPolicy;
	/**
	 * Escape hatch for blocks that are genuinely not source text — the lineage
	 * strip, a thumbnail strip, conversational prose. STILL
	 * rendered inside the standard block frame by the shell: the renderer supplies
	 * the inner content only, never the frame, caption bar, or spacing.
	 */
	node?: ReactNode;
	/**
	 * The node already carries its own frames — a stream of message cards, each
	 * of which IS a card. The shell then renders it BARE: no figure border, no
	 * caption bar, no clamp box, so the pieces float directly on the surface
	 * instead of wearing a second frame around N frames. Only meaningful with
	 * `node`; `caption` stays the block's name, it is simply never painted.
	 */
	selfFramed?: boolean;
	/**
	 * Whether long, clamped content may open in the shell-owned modal.
	 * Defaults to true. Content that fits under its clamp has no affordance.
	 */
	expandable?: boolean;
	/** Block renders inside a shell-owned disclosure. Absent = always open, no disclosure. */
	collapsible?: boolean;
	/** Initial disclosure state when `collapsible`. Default true. */
	defaultOpen?: boolean;
	/** Tie-break within a slot. Lower first. Default 0. */
	order?: number;
	/**
	 * Compatibility markers for the request snapshot's public DOM contract.
	 * They annotate the shell-owned block root; they do not alter its layout.
	 */
	turnSection?: "system" | "context" | "state" | "tools";
}

/**
 * One surface of a tab, e.g. State and Messages inside the Turn's State tab.
 * Zones are shown ONE AT A TIME through a shell-owned subtab row — the reader
 * is never looking at two surfaces at once. The renderer only names the surface
 * and its member blocks; all chrome is the shell's.
 */
export interface DetailZone {
	/** Stable id within the tab, e.g. "state". */
	id: string;
	/**
	 * Subtab label, e.g. "State". The label is the WHOLE subtab: no count, no
	 * meta line under the row. Ford cut both on review — the surface says where
	 * you are, and the content says how much of it there is.
	 */
	name: string;
	/** Ids of this tab's blocks that live on the surface, in stream order. */
	blockIds: readonly string[];
}

export interface DetailTab {
	/** Stable id, e.g. "state". Used for the shell's active-tab state and tests. */
	id: string;
	/** Display name, e.g. "State". */
	name: string;
	blocks: DetailBlockSpec[];
	/**
	 * Optional surfaces, shown one at a time through the shell's subtab row.
	 * Blocks no zone names follow the surfaces in standard order, so a zone list
	 * is never a filter.
	 */
	zones?: readonly DetailZone[];
}

export interface DetailView {
	/** Untabbed body. Mutually exclusive with `tabs`. */
	blocks?: DetailBlockSpec[];
	/**
	 * Tabbed body. The FIRST tab is the default. Mutually exclusive with `blocks`.
	 *
	 * Host-contributed extension blocks merge into the first (default) tab and
	 * are sorted there by the same standard slot ordering as renderer blocks.
	 */
	tabs?: DetailTab[];
	/** Extra sections appended below the standard full-panel Details content. */
	detailsExtras?: ReactNode;
}

/**
 * A per-type body. May use hooks (some fetch), so it is called as a hook by the
 * panel — see SpanDetailPanel's keying rule.
 */
export type DetailBodyRenderer = (props: RendererProps) => DetailView;
