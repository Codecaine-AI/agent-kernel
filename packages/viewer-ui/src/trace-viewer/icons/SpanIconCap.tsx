/**
 * SpanIconCap — the integrated leading icon cell of a trace card.
 *
 * The cap is CONNECTED to the card, never floating: its divider IS a card
 * border. There are two anatomies, same visual language at every size:
 *
 *   layout "inline" — single-line cards. The cap is a full-height cell flush to
 *     the leading (or trailing) end of the card. Its inner edge carries the
 *     divider hairline; the card's own frame supplies the outer border, so the
 *     cap reads as [icon | label] with the divider = the card border.
 *
 *   layout "box" — multi-line boxed cards (user/assistant messages, results).
 *     The cap is pinned to the top-left corner INSIDE the border box, sized to
 *     align with the first text line, with bottom + right hairline dividers
 *     separating it from the content.
 *
 * Treatments (threaded from the style rail as `iconStyle`):
 *   - "outline": transparent cap, accent divider/border, accent glyph.
 *   - "solid":   cap filled with the accent, glyph knocked out to the card bg.
 *
 * The accent arrives as a Tailwind text-color class on `accentClassName`, so
 * the cap's divider / fill / glyph all key off the single `currentColor` it
 * establishes.
 */
import type { FC } from "react";

import cn from "classnames";

import type { IconSide, IconStyle } from "./icon-options";
import type { SpanIconKind } from "./span-icons";

import { spanIconFor } from "./span-icons";

/** Edge length of the cap cell in single-line ("inline") cards. */
export const SPAN_CAP_SIZE = 22;
/** Edge length of the reduced cap used by meta (info/debug) mini-cards. */
export const SPAN_CAP_SIZE_META = 18;
const GLYPH_SIZE = 13;
const GLYPH_SIZE_META = 11;

export type SpanCapLayout = "inline" | "box";

export interface SpanIconCapProps {
	kind: SpanIconKind;
	/** Tailwind text-color utility establishing the accent as currentColor. */
	accentClassName: string;
	side: IconSide;
	style: IconStyle;
	/** "inline" full-height end cap, or "box" top-left corner cap. */
	layout: SpanCapLayout;
	/** Reduced sizing for meta (info/debug) mini-cards. */
	meta?: boolean;
	/** Accessible label, e.g. the span title / type. */
	label?: string;
}

export const SpanIconCap: FC<SpanIconCapProps> = ({
	kind,
	accentClassName,
	side,
	style,
	layout,
	meta = false,
	label,
}) => {
	const isSolid = style === "solid";
	const Glyph = spanIconFor(kind, isSolid ? "fill" : "outline");
	const cell = meta ? SPAN_CAP_SIZE_META : SPAN_CAP_SIZE;
	const glyph = meta ? GLYPH_SIZE_META : GLYPH_SIZE;

	// The divider hairline lives on the cap's inner edge(s). For "inline" that is
	// the trailing edge (opposite `side`); for "box" it is bottom + right — the
	// two edges that face the content while the top/left are the card frame.
	//
	// Design choice: boxed cards keep the cap top-left in BOTH iconSide modes.
	// A top-RIGHT cap reads worse against a left-to-right reading body (the eye
	// hits the wrapped text before the type marker), so `side` only steers the
	// inline end caps; box caps ignore it and always anchor top-left.
	const divider =
		layout === "box"
			? "border-b border-r"
			: side === "left"
				? "border-r"
				: "border-l";

	return (
		<span
			role="img"
			aria-label={label ?? `${kind} span`}
			className={cn(
				"pointer-events-none grid shrink-0 place-items-center self-stretch",
				accentClassName,
				divider,
				// The divider is part of the card frame: it must carry the same
				// accent as the border, never the theme's neutral border color.
				"border-current",
				isSolid ? "bg-current" : "bg-transparent",
				layout === "box" && "absolute left-0 top-0 rounded-tl-[2px]",
				layout === "inline" &&
					(side === "left" ? "rounded-l-[2px]" : "rounded-r-[2px]"),
			)}
			style={{ width: cell, minHeight: cell }}
		>
			{/* Solid: knock the glyph out to the card background so it reads as a
			    cutout in the accent fill. Outline: glyph inherits the accent. */}
			<Glyph
				size={glyph}
				className={isSolid ? "text-agentprism-background" : undefined}
			/>
		</span>
	);
};
