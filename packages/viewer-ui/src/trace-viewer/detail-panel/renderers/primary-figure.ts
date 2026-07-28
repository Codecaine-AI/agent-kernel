/**
 * primary-figure — the reading policy for a PRIMARY FIGURE: the one document a
 * surface exists to show. State, Context, System prompt, and Tools when it
 * lands; the same documents when a span opens them standalone.
 *
 * Ford, verbatim: "for the context, system prompt and tools, can we make these
 * render full length as well and ideally inline, or at least scrollable?" So a
 * primary figure is never a clamped preview — the whole document renders and
 * the figure bounds itself into a reading window that scrolls in place. The
 * figure caption's ⤢ modal still opens it unbounded.
 *
 * Sections that appear in more than one surface name the policy directly, so
 * the same document reads identically wherever it is opened. Inside the Turn
 * body the policy is also STAMPED onto every tab, so a new tab renderer that
 * says nothing about clamping inherits it rather than having to know it exists.
 * Only a block with a genuine reason to differ — the one-line "state
 * unavailable" notice, say — states its own.
 */
import type { DetailBlockSpec } from "../contract";
import { CLAMP, type ClampPolicy } from "../doc-figure/clamp";

export const PRIMARY_FIGURE_CLAMP: ClampPolicy = CLAMP.scroll;

/**
 * Stamp the default onto a surface's source figures. Blocks that carry their
 * own `clamp`, and non-source `node` blocks, are left exactly as declared.
 */
export function withPrimaryFigurePolicy(
	blocks: readonly DetailBlockSpec[],
): DetailBlockSpec[] {
	return blocks.map((block) =>
		block.body === undefined || block.clamp !== undefined
			? block
			: { ...block, clamp: PRIMARY_FIGURE_CLAMP },
	);
}
