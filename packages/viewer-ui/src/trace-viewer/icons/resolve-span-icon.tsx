/**
 * resolve-span-icon — maps a span's display type + status to the icon kind and
 * the accent color class the chip should wear.
 *
 * The accent classes are Tailwind text-color utilities over the SAME token
 * family the variant cards already use for their borders/badges (see
 * ../SpanCard/variants and the host theme's --agentprism-badge-* /
 * --status-* / --trace-container tokens). No new colors are introduced — the
 * chip just re-wears the span's existing accent as `currentColor`.
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
	/** Tailwind text-color utility that sets the chip accent via currentColor. */
	accentClassName: string;
}

/** Accent class per display type — mirrors each variant card's border token. */
const ACCENT_BY_DISPLAY: Record<SpanDisplayType, string> = {
	tool: "text-agentprism-badge-tool-foreground",
	spawner: "text-agentprism-badge-agent-foreground",
	agent: "text-agentprism-badge-agent-foreground",
	ui_ask: "text-status-info",
	user: "text-agentprism-badge-chain-foreground",
	assistant: "text-agentprism-badge-llm-foreground",
	system: "text-agentprism-badge-chain-foreground",
	lifecycle: "text-status-neutral",
	container: "text-trace-container",
	generic: "text-agentprism-muted-foreground",
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

export function resolveSpanIcon(input: SpanIconInput): SpanIconDescriptor {
	// Status wins: error/warning spans always flag, regardless of type.
	if (input.status === "error") {
		return { kind: "error", accentClassName: "text-destructive" };
	}
	if (input.status === "warning") {
		return { kind: "warning", accentClassName: "text-status-warning" };
	}

	const accentClassName = ACCENT_BY_DISPLAY[input.displayType];

	if (input.displayType === "lifecycle") {
		return { kind: lifecycleKind(input.lifecycleLabel), accentClassName };
	}
	// The "Provisioning" lifecycle label reaches SpanCard as a lifecycle
	// display; a dedicated system-ish "context build" reads as system.

	return { kind: KIND_BY_DISPLAY[input.displayType], accentClassName };
}
