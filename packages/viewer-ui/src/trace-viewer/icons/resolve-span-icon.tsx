/**
 * resolve-span-icon — maps a span's display type + status to (a) the icon kind,
 * (b) the semantic GROUP it belongs to, and (c) the Tailwind accent utilities
 * the card should wear (glyph text color + border color + optional edge accent).
 *
 * COLOR SEMANTICS (the one system — nothing per-component):
 *
 *   Cards are quiet surfaces: neutral hairline frame, differentiated by icon
 *   shape + a SMALL kind→hue system applied as glyph tint + thin left-edge
 *   accent (never full colored boxes). Four scannable categories:
 *
 *     CONVERSATION  user message → blue (--trace-user)
 *                   assistant reply → green (--trace-assistant)
 *     TOOL          tool calls/results + spawner dispatch → cyan (--trace-tool)
 *     CONTEXT       context build / system prompt / snapshots → violet
 *                   (--trace-orchestration token, reused — orchestration cards
 *                   are neutral now, so violet exclusively means context)
 *     LIFECYCLE     agents, provisioning, runs/sessions, containers,
 *                   info/debug rows → neutral/muted (plumbing)
 *
 *   Beyond the kind hues, color is reserved for:
 *     - SELECTION — the strongest visual in the tree (info-cyan fill + left
 *       bar, applied by SpanCard, matching the trace-list selection idiom).
 *     - STATUS — error → red, warning → amber. A healthy span shows no status
 *       color. These are the ONLY full colored frames.
 *
 *   The same accent shows in the detail-panel header (TabShell) so the color
 *   seen in the tree is the color seen when the span is opened.
 *
 * Group tokens live in the host theme (--trace-* in styles.css) and are exposed
 * as Tailwind `*-trace-*` color utilities. Only existing host tokens are used
 * so downstream apps inherit the system without theme changes.
 */
import type { SpanIconKind } from "./span-icons";

/** The display-type discriminant, aligned with SpanCard's getSpanDisplay(). */
export type SpanDisplayType =
	| "user"
	| "assistant"
	| "tool"
	| "spawner"
	| "ui_ask"
	| "agent"
	| "lifecycle"
	| "system"
	| "container"
	| "generic";

/** The semantic color group a card belongs to. */
export type SpanColorGroup =
	| "orchestration"
	| "user"
	| "assistant"
	| "tool"
	| "context"
	| "lifecycle"
	| "meta"
	| "warning"
	| "error";

export interface SpanIconInput {
	/** The display type SpanCard picked, or "generic" for the fallback card. */
	displayType: SpanDisplayType;
	/** The span status; "error"/"warning" override the glyph for scannability. */
	status?: string;
	/**
	 * Optional finer lifecycle label so run/phase/provisioning lifecycle spans
	 * get distinct glyphs. SpanCard passes the lifecycle label through.
	 */
	lifecycleLabel?: string;
}

export interface SpanIconDescriptor {
	kind: SpanIconKind;
	/** The semantic group this span belongs to. */
	group: SpanColorGroup;
	/** Tailwind text-color utility that sets the cap glyph accent via currentColor. */
	accentClassName: string;
	/** Tailwind border-color utility for the card frame (neutral unless status). */
	borderClassName: string;
}

/** Neutral frame + glyph shared by every non-status, non-accented group. */
const NEUTRAL_TEXT = "text-muted-foreground";
const NEUTRAL_BORDER = "border-border";

/**
 * Every group's Tailwind utilities. Single source of truth for span color.
 *   text   — cap glyph accent (currentColor)
 *   border — card frame border (neutral for everything except status groups)
 *   edge   — optional thin left-edge accent for the structural set
 */
export const GROUP_ACCENT: Record<
	SpanColorGroup,
	{ text: string; border: string; edge?: string }
> = {
	// Structural accents — thin left edge only, frame stays neutral.
	user: {
		text: "text-trace-user",
		border: NEUTRAL_BORDER,
		edge: "border-l-2 border-l-trace-user",
	},
	assistant: {
		text: "text-trace-assistant",
		border: NEUTRAL_BORDER,
		edge: "border-l-2 border-l-trace-assistant",
	},
	tool: {
		text: "text-trace-tool",
		border: NEUTRAL_BORDER,
		edge: "border-l-2 border-l-trace-tool",
	},
	context: {
		// Violet token reused for context/snapshot — see header comment.
		text: "text-trace-orchestration",
		border: NEUTRAL_BORDER,
		edge: "border-l-2 border-l-trace-orchestration",
	},
	// Neutral set — quiet plumbing; icon shape + text differentiate.
	orchestration: { text: NEUTRAL_TEXT, border: NEUTRAL_BORDER },
	lifecycle: { text: NEUTRAL_TEXT, border: NEUTRAL_BORDER },
	meta: { text: NEUTRAL_TEXT, border: NEUTRAL_BORDER },
	// Status — RESERVED; the only groups allowed a full colored frame.
	warning: { text: "text-status-warning", border: "border-status-warning-border" },
	error: { text: "text-destructive", border: "border-destructive" },
};

/** The group each display type belongs to. */
const GROUP_BY_DISPLAY: Record<SpanDisplayType, SpanColorGroup> = {
	tool: "tool",
	// Spawner dispatch IS a tool call — it scans with tool activity.
	spawner: "tool",
	agent: "orchestration",
	ui_ask: "user",
	user: "user",
	assistant: "assistant",
	system: "context",
	lifecycle: "lifecycle",
	container: "lifecycle",
	generic: "meta",
};

/** Icon kind per display type (before status/lifecycle overrides). */
const KIND_BY_DISPLAY: Record<SpanDisplayType, SpanIconKind> = {
	tool: "tool",
	spawner: "spawner",
	agent: "agent",
	ui_ask: "generic",
	user: "user",
	assistant: "assistant",
	system: "system",
	lifecycle: "lifecycle",
	container: "container",
	generic: "generic",
};

function lifecycleKind(label: string | undefined): SpanIconKind {
	const l = (label ?? "").toLowerCase();
	if (l.includes("provision")) return "provisioning";
	if (l.includes("phase")) return "phase";
	if (l.includes("run")) return "run";
	return "lifecycle";
}

function descriptor(kind: SpanIconKind, group: SpanColorGroup): SpanIconDescriptor {
	const accent = GROUP_ACCENT[group];
	return {
		kind,
		group,
		accentClassName: accent.text,
		borderClassName: accent.border,
	};
}

export function resolveSpanIcon(input: SpanIconInput): SpanIconDescriptor {
	// Status wins: error/warning spans always flag, regardless of type. These
	// are the ONLY paths that reach the reserved amber/red groups.
	if (input.status === "error") {
		return descriptor("error", "error");
	}
	if (input.status === "warning") {
		return descriptor("warning", "warning");
	}

	const group = GROUP_BY_DISPLAY[input.displayType];

	if (input.displayType === "lifecycle") {
		return descriptor(lifecycleKind(input.lifecycleLabel), group);
	}

	return descriptor(KIND_BY_DISPLAY[input.displayType], group);
}
