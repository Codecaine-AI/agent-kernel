/**
 * resolve-span-icon — maps a span's display type + status to (a) the icon kind,
 * (b) the semantic GROUP it belongs to, and (c) the Tailwind accent utilities
 * the card should wear (glyph text color + border color + optional edge accent).
 *
 * COLOR SEMANTICS (the one system — nothing per-component):
 *
 *   Kind-colored cards are BANDS, doc-style (state-shapes.html .band): the
 *   ENTIRE card border carries the kind hue at reduced alpha plus a subtle
 *   background wash (~10%) of the same hue, so kinds separate at a glance in
 *   both themes. Four scannable categories:
 *
 *     CONVERSATION  user message → blue (--trace-user)
 *                   assistant reply → green (--trace-assistant)
 *     TOOL          tool calls/results + spawner dispatch → orange (--trace-tool)
 *     CONTEXT       turn snapshots + context build / system prompt → violet
 *                   (--trace-orchestration token, reused — orchestration cards
 *                   are neutral now, so violet exclusively means context)
 *     LIFECYCLE     agents, provisioning, runs/sessions, containers,
 *                   info/debug rows → neutral hairline, NO wash (plumbing)
 *
 *   Ordering of loudness (must stay monotonic):
 *     neutral plumbing < kind band < SELECTION (status-info ring + fill + bar,
 *     applied by SpanCard) < STATUS (error red / warning amber: full-strength
 *     border + wash — the loudest thing in the tree).
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
	| "turn"
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
	/** Tailwind border-color utility for the card frame (band hue or neutral). */
	borderClassName: string;
}

/** Neutral frame + glyph shared by every non-status, non-accented group. */
const NEUTRAL_TEXT = "text-muted-foreground";
const NEUTRAL_BORDER = "border-border";

/**
 * Every group's Tailwind utilities. SINGLE source of truth for span color —
 * tune bands here, nowhere else.
 *   text   — glyph / accent text (currentColor)
 *   border — card frame border: kind hue at reduced alpha for bands, full
 *            strength for status, neutral hairline for plumbing
 *   wash   — band background tint (~10% of the hue); absent = no wash
 */
export const GROUP_ACCENT: Record<
	SpanColorGroup,
	{ text: string; border: string; wash?: string }
> = {
	// Kind bands — full border in the hue + subtle wash. Alphas are theme
	// tokens (--band-border-opacity / --band-wash-opacity, style-panel
	// adjustable) with baked fallbacks so hosts without the vars keep
	// today's look (border 45%, wash 10%).
	user: {
		text: "text-trace-user",
		border: "border-[rgb(var(--trace-user)/var(--band-border-opacity,0.45))]",
		wash: "bg-[rgb(var(--trace-user)/var(--band-wash-opacity,0.1))]",
	},
	assistant: {
		text: "text-trace-assistant",
		border: "border-[rgb(var(--trace-assistant)/var(--band-border-opacity,0.45))]",
		wash: "bg-[rgb(var(--trace-assistant)/var(--band-wash-opacity,0.1))]",
	},
	tool: {
		text: "text-trace-tool",
		border: "border-[rgb(var(--trace-tool)/var(--band-border-opacity,0.45))]",
		wash: "bg-[rgb(var(--trace-tool)/var(--band-wash-opacity,0.1))]",
	},
	context: {
		// Violet token reused for context/turn snapshots — see header comment.
		text: "text-trace-orchestration",
		border: "border-[rgb(var(--trace-orchestration)/var(--band-border-opacity,0.45))]",
		wash: "bg-[rgb(var(--trace-orchestration)/var(--band-wash-opacity,0.1))]",
	},
	// Neutral set — quiet plumbing; icon shape + text differentiate. No wash.
	orchestration: { text: NEUTRAL_TEXT, border: NEUTRAL_BORDER },
	lifecycle: { text: NEUTRAL_TEXT, border: NEUTRAL_BORDER },
	meta: { text: NEUTRAL_TEXT, border: NEUTRAL_BORDER },
	// Status — RESERVED and loudest: full-strength border + wash.
	warning: {
		text: "text-status-warning",
		border: "border-status-warning-border",
		wash: "bg-status-warning-fill/80",
	},
	error: {
		text: "text-destructive",
		border: "border-destructive",
		wash: "bg-destructive/10",
	},
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
	turn: "context",
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
	turn: "turn",
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
