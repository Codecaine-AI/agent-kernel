/*
 * span-icons — maps a span's display type to a scannability icon.
 *
 * Icons are Nucleo UI glyphs (see ./nucleo-icons for the license NOTICE). Each
 * icon kind resolves to a component that renders in either the "outline" or
 * "fill" variant, matching the two chip treatments the SpanCard offers.
 *
 * The accent for each kind is NOT chosen here — the chip reuses the span's
 * existing accent token (the same family the card border/badges use). This
 * module only picks the glyph.
 */
import type { FC } from "react";

import type { NucleoIconVariant, NucleoIconProps } from "./nucleo-icons";
import {
	ChatBubbleIcon,
	CircleInfoIcon,
	CircleUserIcon,
	CircleWarningIcon,
	CubeIcon,
	DatabaseIcon,
	FlagIcon,
	GearIcon,
	MediaPlayIcon,
	PaperPlaneIcon,
	RobotIcon,
	TriangleWarningIcon,
	WrenchIcon,
} from "./nucleo-icons";

export type { NucleoIconVariant };

/**
 * The distinct icon kinds a span card can carry. This is a superset of the
 * SpanCard display types: it splits out status-driven (warning/error) and
 * lifecycle sub-kinds (run/phase/provisioning) that share a display type but
 * warrant a distinct glyph.
 */
export type SpanIconKind =
	| "tool"
	| "spawner"
	| "agent"
	| "run"
	| "phase"
	| "container"
	| "user"
	| "assistant"
	| "system"
	| "lifecycle"
	| "provisioning"
	| "warning"
	| "error"
	| "generic";

const ICON_BY_KIND: Record<SpanIconKind, FC<NucleoIconProps>> = {
	tool: WrenchIcon,
	spawner: PaperPlaneIcon,
	agent: RobotIcon,
	run: MediaPlayIcon,
	phase: FlagIcon,
	container: CubeIcon,
	user: CircleUserIcon,
	assistant: ChatBubbleIcon,
	system: GearIcon,
	lifecycle: GearIcon,
	provisioning: DatabaseIcon,
	warning: TriangleWarningIcon,
	error: CircleWarningIcon,
	generic: CircleInfoIcon,
};

/** All icon kinds, for exhaustive iteration (e.g. in tests). */
export const SPAN_ICON_KINDS = Object.keys(ICON_BY_KIND) as SpanIconKind[];

/**
 * Resolve the icon component for a span display kind. `variant` selects the
 * outline vs. fill glyph so the returned component renders the correct treatment
 * when the caller only passes `size`.
 */
export function spanIconFor(
	kind: SpanIconKind,
	variant: NucleoIconVariant,
): FC<Omit<NucleoIconProps, "variant">> {
	const Base = ICON_BY_KIND[kind] ?? ICON_BY_KIND.generic;
	const Bound: FC<Omit<NucleoIconProps, "variant">> = (props) => (
		<Base variant={variant} {...props} />
	);
	Bound.displayName = `SpanIcon(${kind},${variant})`;
	return Bound;
}
