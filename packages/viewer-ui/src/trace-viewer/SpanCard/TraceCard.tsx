/**
 * TraceCard — the shared card frame every trace span variant renders into.
 *
 * It owns the ONE anatomy the design system standardizes on: a card frame with
 * an integrated icon cap whose divider is part of that frame. Variants only
 * supply their content; the cap, border, side, style, and sizing all flow
 * through here so a tool card, an agent card, and a boxed user message read as
 * the same object.
 *
 *   size "line" — single-line cards (tool, agent, lifecycle, turn, system…).
 *     The cap is a full-height end cell; content sits beside it in a flex row.
 *   size "box"  — multi-line message/result cards. The cap pins to the top-left
 *     corner inside the border; content is padded clear of it on the first line.
 *
 * There is exactly ONE row size — every tree row shares the same cap size and
 * type scale (the old reduced "meta" variant is gone so it cannot regress).
 *
 * Color comes from a single `group` via GROUP_ACCENT: kind-colored cards are
 * doc-style BANDS (full border in the hue at reduced alpha + a subtle wash of
 * the same hue); plumbing groups are neutral hairline, no wash; error/warning
 * are full-strength border + wash. See resolve-span-icon.tsx for semantics.
 */
import type { ElementType, FC, ReactNode } from "react";

import cn from "classnames";

import {
	GROUP_ACCENT,
	SpanIconCap,
	SPAN_CAP_SIZE,
	type IconSide,
	type IconStyle,
	type SpanColorGroup,
	type SpanIconKind,
} from "../icons";

export type TraceCardSize = "line" | "box";

/**
 * Selection treatment lives ON THE CARD: when the enclosing SpanCard row
 * (named group "spanrow") carries data-selected, the card gets an inset ring
 * plus a light fill of the selection color, overriding any kind-band wash
 * (the variant selector out-specifies the plain wash utility). Color, ring
 * opacity, and ring width ride the --selection-* tokens (style-rail
 * adjustable) with baked fallbacks; the row contributes only the gutter bar.
 */
const SELECTED_CARD =
	"group-data-[selected]/spanrow:shadow-[inset_0_0_0_var(--selection-width,2px)_rgb(var(--selection-color,var(--status-info))/var(--selection-opacity,1))] group-data-[selected]/spanrow:bg-[rgb(var(--selection-color,var(--status-info))/0.12)]";

export interface TraceCardProps {
	kind: SpanIconKind;
	group: SpanColorGroup;
	side: IconSide;
	style: IconStyle;
	size?: TraceCardSize;
	/**
	 * Box cards hug their content by default (`w-fit`) because a tree row is a
	 * loose column. In the detail panel a message stream is a COLUMN OF EQUAL
	 * CARDS, so `fill` swaps that for full width — the one escape hatch, so the
	 * two surfaces can share this frame without either forking it.
	 */
	fill?: boolean;
	/** Frame element — "article" for the detail panel's message stream. */
	as?: ElementType;
	/**
	 * Identity attributes stamped on the frame (data-* hooks the message stream
	 * and its tests query). The frame is the card, so they belong on it rather
	 * than on a wrapper that would break the cap's absolute positioning context.
	 */
	frameData?: Record<string, string>;
	/** Cap through-line to the accessible label. */
	label?: string;
	/** Extra classes on the outer frame (e.g. max-width for boxes). */
	className?: string;
	children: ReactNode;
}

export const TraceCard: FC<TraceCardProps> = ({
	kind,
	group,
	side,
	style,
	size = "line",
	fill = false,
	as: Frame = "div",
	frameData,
	label,
	className,
	children,
}) => {
	const isBox = size === "box";
	const { border, text: accent, wash } = GROUP_ACCENT[group];
	const capPad = SPAN_CAP_SIZE + 8;

	const cap = (
		<SpanIconCap
			kind={kind}
			accentClassName={accent}
			dividerClassName={border}
			side={side}
			style={style}
			layout={isBox ? "box" : "inline"}
			label={label}
		/>
	);

	if (isBox) {
		// Box caps always anchor top-left (see SpanIconCap: `side` steers only the
		// inline end caps), so the first line always clears the cap on the left.
		return (
			<Frame
				{...frameData}
				className={cn(
					// w-fit so short messages hug their content instead of stretching
					// an empty frame across the row; variants cap growth via max-w.
					// `fill` opts into the detail panel's equal-width message column.
					"relative overflow-hidden rounded-[2px] border text-foreground transition-colors",
					fill ? "w-full min-w-0" : "w-fit",
					border,
					wash ?? "hover:bg-muted/30",
					SELECTED_CARD,
					className,
				)}
			>
				{cap}
				<div className="min-w-0" style={{ paddingLeft: capPad }}>
					{children}
				</div>
			</Frame>
		);
	}

	// Single-line cards: [cap | content] flex row sharing the frame.
	// max-w-full lets the frame shrink inside the tree row so truncating detail
	// chips ellipsize at the panel edge instead of overflowing it.
	return (
		<Frame
			{...frameData}
			className={cn(
				"max-w-full items-stretch overflow-hidden rounded-[2px] border text-foreground transition-colors",
				fill ? "flex w-full min-w-0" : "inline-flex",
				border,
				wash ?? "hover:bg-muted/30",
				SELECTED_CARD,
				side === "right" && "flex-row-reverse",
				className,
			)}
		>
			{cap}
			<div className="flex min-w-0 items-center gap-1.5 px-2 py-0.5">
				{children}
			</div>
		</Frame>
	);
};
