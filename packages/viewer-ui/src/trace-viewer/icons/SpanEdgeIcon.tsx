/**
 * SpanEdgeIcon — the small type-scannability chip that abuts a span card's
 * outer edge.
 *
 * Layout: the chip is positioned absolutely against the card's content edge so
 * it visually straddles/abuts the border, and top-aligned with the title row
 * (cards vary in height; top-alignment scans better down a tree). The parent
 * reserves horizontal room so the chip never collides with the tree connectors.
 *
 * Treatments (owner is deciding by eye):
 *   - "outline": hollow chip — transparent background, 1px accent border, the
 *     accent-colored glyph rendered in its outline variant.
 *   - "solid": accent-filled chip — background is the accent (currentColor),
 *     the glyph is knocked out to the card background color via its fill variant.
 *
 * The accent color arrives as a Tailwind text-color class on `accentClassName`
 * (set by resolveSpanIcon), so the chip's border / fill / glyph all key off the
 * single `currentColor` it establishes.
 */
import type { FC } from "react";

import cn from "classnames";

import type { IconSide, IconStyle } from "./icon-options";
import type { SpanIconKind } from "./span-icons";

import { spanIconFor } from "./span-icons";

export const SPAN_EDGE_ICON_CHIP_SIZE = 20;
const GLYPH_SIZE = 13;

export interface SpanEdgeIconProps {
	kind: SpanIconKind;
	/** Tailwind text-color utility establishing the accent as currentColor. */
	accentClassName: string;
	side: IconSide;
	style: IconStyle;
	/** Accessible label, e.g. the span title / type. */
	label?: string;
}

export const SpanEdgeIcon: FC<SpanEdgeIconProps> = ({
	kind,
	accentClassName,
	side,
	style,
	label,
}) => {
	const isSolid = style === "solid";
	const Glyph = spanIconFor(kind, isSolid ? "fill" : "outline");

	return (
		<span
			role="img"
			aria-label={label ?? `${kind} span`}
			className={cn(
				"pointer-events-none absolute top-0 z-20 grid shrink-0 place-items-center rounded-[3px]",
				accentClassName,
				isSolid
					? "border border-transparent bg-current"
					: "border border-current bg-agentprism-background",
				// Sit in the room the parent reserved on this side (pl-/pr-),
				// abutting the card content's edge. Left by default (scan-first),
				// configurable to right. Never enters the tree connector lane.
				side === "left" ? "left-0" : "right-0",
			)}
			style={{ width: SPAN_EDGE_ICON_CHIP_SIZE, height: SPAN_EDGE_ICON_CHIP_SIZE }}
		>
			{/* Solid: knock the glyph out to the card background so it reads as a
			    cutout in the accent fill. Outline: glyph inherits the accent. */}
			<Glyph
				size={GLYPH_SIZE}
				className={isSolid ? "text-agentprism-background" : undefined}
			/>
		</span>
	);
};
