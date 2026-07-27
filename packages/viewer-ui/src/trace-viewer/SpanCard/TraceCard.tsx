/**
 * TraceCard — the shared card frame every trace span variant renders into.
 *
 * It owns the ONE anatomy the design system standardizes on: a group-colored
 * border frame with an integrated icon cap whose divider is part of that frame.
 * Variants only supply their content; the cap, border, side, style, and sizing
 * all flow through here so a tool card, an agent card, and a boxed user message
 * read as the same object at different sizes.
 *
 *   size "line" — single-line cards (tool, agent, lifecycle, system…). The cap
 *     is a full-height end cell; content sits beside it in a flex row.
 *   size "box"  — multi-line message/result cards. The cap pins to the top-left
 *     corner inside the border; content is padded clear of it on the first line.
 *   size "meta" — the reduced info/debug mini-card. Same anatomy, smaller.
 *
 * Color comes from a single `group` via GROUP_ACCENT: frames are NEUTRAL by
 * default (quiet hairline + muted glyph); only error/warning status colors a
 * whole frame, and the small structural set (user / assistant / context) wears
 * a thin left-edge accent. See resolve-span-icon.tsx for the full semantics.
 */
import type { FC, ReactNode } from "react";

import cn from "classnames";

import {
	GROUP_ACCENT,
	SpanIconCap,
	SPAN_CAP_SIZE,
	SPAN_CAP_SIZE_META,
	type IconSide,
	type IconStyle,
	type SpanColorGroup,
	type SpanIconKind,
} from "../icons";

export type TraceCardSize = "line" | "box" | "meta";

export interface TraceCardProps {
	kind: SpanIconKind;
	group: SpanColorGroup;
	side: IconSide;
	style: IconStyle;
	size?: TraceCardSize;
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
	label,
	className,
	children,
}) => {
	const isBox = size === "box";
	const isMeta = size === "meta";
	const { border, text: accent, edge } = GROUP_ACCENT[group];
	const capPad = (isMeta ? SPAN_CAP_SIZE_META : SPAN_CAP_SIZE) + (isMeta ? 6 : 8);

	const cap = (
		<SpanIconCap
			kind={kind}
			accentClassName={accent}
			side={side}
			style={style}
			layout={isBox ? "box" : "inline"}
			meta={isMeta}
			label={label}
		/>
	);

	if (isBox) {
		// Box caps always anchor top-left (see SpanIconCap: `side` steers only the
		// inline end caps), so the first line always clears the cap on the left.
		return (
			<div
				className={cn(
					// w-fit so short messages hug their content instead of stretching
					// an empty frame across the row; variants cap growth via max-w.
					"relative w-fit overflow-hidden rounded-[2px] border text-foreground transition-colors hover:bg-muted/30",
					border,
					edge,
					className,
				)}
			>
				{cap}
				<div className="min-w-0" style={{ paddingLeft: capPad }}>
					{children}
				</div>
			</div>
		);
	}

	// Single-line (and meta) cards: [cap | content] flex row sharing the frame.
	// max-w-full lets the frame shrink inside the tree row so truncating detail
	// chips ellipsize at the panel edge instead of overflowing it.
	return (
		<div
			className={cn(
				"inline-flex max-w-full items-stretch overflow-hidden rounded-[2px] border text-foreground transition-colors hover:bg-muted/30",
				border,
				edge,
				side === "right" && "flex-row-reverse",
				className,
			)}
		>
			{cap}
			<div
				className={cn(
					"flex min-w-0 items-center",
					isMeta ? "gap-1 px-1.5 py-0.5" : "gap-1.5 px-2 py-0.5",
				)}
			>
				{children}
			</div>
		</div>
	);
};
