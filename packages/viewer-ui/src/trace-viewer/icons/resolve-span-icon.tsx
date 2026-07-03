/**
 * resolve-span-icon — maps a span's display type + status to (a) the icon kind,
 * (b) the semantic GROUP it belongs to, and (c) the Tailwind accent utilities
 * the card should wear (glyph text color + border color).
 *
 * Color carries meaning. Every card — its border, icon cap, title accent, and
 * badges — keys off exactly ONE group so the eye can read type by hue:
 *
 *   orchestration  agents, spawner dispatch, runs/sessions   → violet
 *   user           user messages                             → blue
 *   assistant      assistant messages                        → green
 *   tool           tool calls                                → cyan
 *   lifecycle      system / provisioning / phases / containers → neutral gray
 *   meta           info / debug fallback rows                 → muted gray
 *   warning        RESERVED — diagnostics only                → amber
 *   error          RESERVED — diagnostics only                → red
 *
 * Group tokens live in the host theme (--trace-* in styles.css) and are exposed
 * as Tailwind `*-trace-*` color utilities. Warning/amber and error/red are
 * reserved: after this change nothing non-diagnostic may render amber or red.
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

/** The semantic color group a card belongs to. One hue per group. */
export type SpanColorGroup =
	| "orchestration"
	| "user"
	| "assistant"
	| "tool"
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
	/** Tailwind border-color utility matching the group, for the card frame. */
	borderClassName: string;
}

/** Every group's Tailwind text + border utilities. Single source of truth. */
export const GROUP_ACCENT: Record<
	SpanColorGroup,
	{ text: string; border: string }
> = {
	orchestration: { text: "text-trace-orchestration", border: "border-trace-orchestration" },
	user: { text: "text-trace-user", border: "border-trace-user" },
	assistant: { text: "text-trace-assistant", border: "border-trace-assistant" },
	tool: { text: "text-trace-tool", border: "border-trace-tool" },
	lifecycle: { text: "text-trace-lifecycle", border: "border-trace-lifecycle" },
	meta: { text: "text-trace-meta", border: "border-trace-meta" },
	warning: { text: "text-status-warning", border: "border-status-warning-border" },
	error: { text: "text-destructive", border: "border-destructive" },
};

/** The group each display type belongs to. */
const GROUP_BY_DISPLAY: Record<SpanDisplayType, SpanColorGroup> = {
	tool: "tool",
	spawner: "orchestration",
	agent: "orchestration",
	ui_ask: "user",
	user: "user",
	assistant: "assistant",
	system: "lifecycle",
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
