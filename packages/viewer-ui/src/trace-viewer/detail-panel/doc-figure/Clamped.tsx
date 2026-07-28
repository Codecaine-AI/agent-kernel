"use client";

/**
 * Clamped — an SSR-safe preview for long detail-panel content.
 *
 * The complete child tree is always rendered. Collapsing only applies a
 * max-height and a visual fade, so server markup, search, copying, and later
 * hydration all retain the full source instead of receiving a sliced string.
 * Full-size viewing is delegated to figure/shell chrome outside this component.
 */
import { type JSX, type ReactNode } from "react";
import cn from "classnames";

import { shouldClamp, type ClampPolicy } from "./clamp";

export function Clamped({
	policy,
	lineCount,
	charCount,
	children,
}: {
	policy: ClampPolicy;
	lineCount: number;
	charCount: number;
	children: ReactNode;
}): JSX.Element {
	const needsClamp = shouldClamp(policy, lineCount, charCount);

	if (!needsClamp) return <>{children}</>;

	return (
		<div
			data-clamped="true"
			className={cn("relative min-w-0 overflow-hidden")}
			style={{ maxHeight: `${policy.maxHeightPx}px` }}
		>
			{children}
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-background/95"
			/>
		</div>
	);
}
