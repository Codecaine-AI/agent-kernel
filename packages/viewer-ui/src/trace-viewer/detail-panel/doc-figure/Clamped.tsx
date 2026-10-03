"use client";

/**
 * Clamped — an SSR-safe preview for long detail-panel content.
 *
 * The complete child tree is always rendered. Collapsing only applies a
 * max-height and a visual fade, so server markup, search, copying, and later
 * hydration all retain the full source instead of receiving a sliced string.
 * Full-size viewing is delegated to figure/shell chrome outside this component.
 */
import {
	useEffect,
	useLayoutEffect,
	useState,
	type JSX,
	type ReactNode,
	type Ref,
} from "react";

import { shouldClamp, type ClampPolicy } from "./clamp";
import { observeRenderedHeight, renderedHeightOf } from "./rendered-height";

export function Clamped({
	policy,
	lineCount,
	charCount,
	renderedHeightPx = null,
	measureRef,
	children,
}: {
	policy: ClampPolicy;
	lineCount: number;
	charCount: number;
	/**
	 * The content's laid-out height, for content that soft-wraps; null until
	 * measured. Once known it decides instead of the line count.
	 */
	renderedHeightPx?: number | null;
	/**
	 * Receives the element to measure (see `useRenderedHeight`): the content,
	 * wrapped so the clamp box never constrains it. Measured content keeps one
	 * box whether or not it is clamped, so a decision that changes after mount
	 * restyles the box instead of remounting the content.
	 */
	measureRef?: Ref<HTMLDivElement>;
	children: ReactNode;
}): JSX.Element {
	const needsClamp = shouldClamp(
		policy,
		lineCount,
		charCount,
		renderedHeightPx,
	);

	if (!needsClamp && measureRef === undefined) return <>{children}</>;

	return (
		<div
			{...(needsClamp ? { "data-clamped": "true" } : {})}
			className={needsClamp ? "relative min-w-0 overflow-hidden" : "min-w-0"}
			style={needsClamp ? { maxHeight: `${policy.maxHeightPx}px` } : undefined}
		>
			{measureRef === undefined ? (
				children
			) : (
				<div ref={measureRef} className="min-w-0">
					{children}
				</div>
			)}
			{needsClamp ? (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-background/95"
				/>
			) : null}
		</div>
	);
}

/**
 * Measure the wrapping content a `Clamped` holds: pass `ref` as its
 * `measureRef` and `heightPx` as its `renderedHeightPx`. `heightPx` stays null
 * until the content has been laid out once.
 */
export function useRenderedHeight(enabled: boolean): {
	ref: (content: HTMLDivElement | null) => void;
	heightPx: number | null;
} {
	const [content, setContent] = useState<HTMLDivElement | null>(null);
	const [heightPx, setHeightPx] = useState<number | null>(null);

	// Until a first measurement lands, measure after each commit, before paint:
	// the mount, or the commit that reveals content mounted in a hidden tab.
	// A long paragraph is then clamped in its first painted frame.
	useLayoutEffect(() => {
		if (!enabled || content === null || heightPx !== null) return;
		const measured = renderedHeightOf(content);
		if (measured !== null) setHeightPx(measured);
	});

	// After that, once per width or content change.
	useEffect(() => {
		if (!enabled || content === null) return;
		return observeRenderedHeight(content, setHeightPx);
	}, [content, enabled]);

	return { ref: setContent, heightPx };
}
