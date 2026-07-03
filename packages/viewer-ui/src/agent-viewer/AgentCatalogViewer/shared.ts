// Shared view-mode types + small formatting/token helpers used across slices.

import type { PromptViewSize } from "../../trace-viewer/detail-panel/PromptView";

export type Scope = "system" | "context" | "combined";
export type Form = "rendered" | "raw";
export type SidebarTab = "files" | "variables" | "tools";
export type FontScale = "small" | "medium" | "large";

export const FONT_SCALE_TO_SIZE: Record<FontScale, PromptViewSize> = {
	small: "sm",
	medium: "md",
	large: "lg",
};

export function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return value || "\"\"";
	if (typeof value === "boolean" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return `[${value.length} items]`;
	if (typeof value === "object") return `{${Object.keys(value).length} keys}`;
	return String(value);
}

/**
 * Estimate token count from a byte size.
 *
 * Per-file content isn't captured in the kernel trace event (only byte sizes
 * are), so for the trace-level file list we can't run `estimateTokenCount` on
 * raw text. The `~4 chars/token` heuristic tracks tokenx's empirical output
 * (~3.8-4.7 chars/token on real text per its benchmarks). For inline blocks
 * parsed out of the rendered context string we DO have content and use real
 * `estimateTokenCount` directly (see collapseContextFiles).
 */
export function estimateTokensFromBytes(bytes: number): number {
	if (!Number.isFinite(bytes) || bytes <= 0) return 0;
	return Math.round(bytes / 4);
}

export function formatTimestamp(value: string | null | undefined): string {
	if (!value) return "not rendered";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

export function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

export function extensionLabel(ext: true | false | string[]): string {
	if (ext === true) return "all";
	if (ext === false) return "disabled";
	return ext.length > 0 ? ext.join(", ") : "none";
}
