/**
 * Shared viewer style system — settings model and the CSS-variable emission
 * every host app mounts on its style shell.
 *
 * Extracted from examples/simple-research-kernel so all apps composing the
 * @agent-kernel viewer packages (the example app, the canvas-agent viewer, …)
 * share ONE style rail: theme (light/dark), tree-chrome strength, grain/bevel
 * effects, trace icon options and layout geometry.
 *
 * Colors come from the host, never from this module. The host loads
 * @codecaine-ai/design-system's tokens.css and host-contract.css, which declare
 * the contract the viewer packages read (--background, --card,
 * --status-info-fill, --trace-user, …) from --ds-* tokens in both themes.
 * styleVars() writes no color, so nothing here paints over a token.
 *
 * The color pickers that used to override the contract stay in the code behind
 * SHOW_COLOR_CONTROLS (off). With the flag off the panel hides them and
 * styleVars() ignores saved overrides. With it on, an override is written onto
 * its own contract variable and every other color stays the host's.
 *
 * The app-level seam is StyleSystemConfig: each app names its own storage
 * keys, default theme, visible panel sections, and the format its Tailwind
 * setup reads the shared-name neutrals in (used by color overrides only):
 *   "triplet" — `--background: 27 27 28` (Tailwind v3 rgb(var(--x)/<alpha>))
 *   "hex"     — `--background: #1B1B1C` (Tailwind v4 @theme inline var(--x))
 * Viewer-only colors (status-*, trace-*, agentprism-*) are RGB triplets in
 * every host and are always written as triplets.
 */
import type { CSSProperties } from "react";

export type GrainBlendMode = "screen" | "overlay" | "soft-light" | "normal";
export type SofteningChannel = "background" | "font" | "borders" | "icons";

export interface LayoutStyleSettings {
	framePadding: number;
	workspaceMinHeight: number;
	headerHeight: number;
}

/**
 * Softening mix, 0–1 per channel. `background` scales the grain layer's
 * opacity, `font` the text glow, `icons` the icon blur and glow. `borders` is
 * kept for saved blobs but no longer does anything: it mixed the engine's own
 * border colors, which the host's tokens set now (the panel hides it).
 */
export interface SofteningSettings {
	background: number;
	font: number;
	borders: number;
	icons: number;
}

export interface SvgNormalSettings {
	enabled: boolean;
	opacity: number;
	frequency: number;
	depth: number;
	azimuth: number;
	elevation: number;
}

export interface CssBevelSettings {
	enabled: boolean;
	strength: number;
	depth: number;
	highlight: number;
	shadow: number;
	text: number;
}

export interface GrainSettings {
	enabled: boolean;
	opacity: number;
	frequency: number;
	contrast: number;
	blendMode: GrainBlendMode;
	softening: SofteningSettings;
	svgNormal: SvgNormalSettings;
	cssBevel: CssBevelSettings;
}

export type TraceIconSide = "left" | "right";
export type TraceIconStyle = "outline" | "solid";

/**
 * The two themes. The host stamps the choice on <html> as data-theme, and the
 * design-system tokens (with the host contract built on them) follow it.
 */
export type ThemeMode = "light" | "dark";

export type StylePanelTab = "colors" | "effects" | "trace" | "layout";

export interface TraceIconSettings {
	side: TraceIconSide;
	style: TraceIconStyle;
}

/** Which value format the host's Tailwind maps the shared-name neutrals as. */
export type NeutralTokenFormat = "triplet" | "hex";

/**
 * Per-app configuration for the shared style system. Every load/save/merge/
 * emission entry point takes one, so two apps never bleed into each other's
 * storage and each keeps its own default look.
 */
export interface StyleSystemConfig {
	/**
	 * The app's localStorage key for the settings blob (keep stable across
	 * releases). The blob is stored under styleSettingsStorageKey(config), this
	 * key with its version raised by one; this key is only read once, to carry
	 * the non-color settings over.
	 */
	settingsStorageKey: string;
	/** localStorage keys for the rail's collapsed/width chrome state. */
	railCollapsedStorageKey: string;
	railWidthStorageKey: string;
	/** The theme a fresh install (or a pre-theme settings blob) gets. */
	defaultTheme: ThemeMode;
	/** How a --background/--foreground/… override is written (see module doc). */
	neutralTokenFormat: NeutralTokenFormat;
	/** Panel tabs to show; omit for all. First entry is the fallback tab. */
	sections?: readonly StylePanelTab[];
}

export type ColorTokenFormat = "triplet" | "hex";
export type ColorTokenGroup = "neutrals" | "editor" | "accents" | "tree" | "selection" | "code";

/**
 * Tree-chrome strength controls (COLORS tab): band wash/border alphas plus
 * caret/connector opacities. Colors for caret/connector live in COLOR_TOKENS
 * (group "tree"); these are the paired opacity sliders. Emitted as CSS vars
 * (--band-wash-opacity, --band-border-opacity, --tree-caret-opacity,
 * --tree-connector-opacity) consumed by the viewer's band/chrome classes.
 */
export interface TreeChromeSettings {
	bandWashOpacity: number;
	bandBorderOpacity: number;
	caretOpacity: number;
	connectorOpacity: number;
}

/**
 * Selection treatment controls: the ring/bar color lives in COLOR_TOKENS
 * (group "selection", theme-keyed defaults); these are the paired sliders.
 * Emitted as --selection-opacity / --selection-width / --selection-bar-width,
 * consumed by SpanCard/TraceCard's selection classes (baked fallbacks).
 */
export interface SelectionStyleSettings {
	/** Ring + bar opacity, 0.2–1. */
	opacity: number;
	/** Card ring width in px, 1–4. */
	ringWidth: number;
	/** Row gutter bar width in px, 0–6 (0 hides the bar). */
	barWidth: number;
}

/**
 * Code-block controls: zebra stripe color lives in COLOR_TOKENS (group
 * "code", theme-keyed defaults); this is the paired opacity slider. Emitted
 * as --zebra-opacity (with --zebra-color from the token), consumed by the
 * shared code-block component as rgb(var(--zebra-color)/var(--zebra-opacity))
 * with baked fallbacks. 0 disables striping.
 */
export interface CodeBlockStyleSettings {
	/** Zebra stripe opacity, 0–0.15 (0 = no striping). */
	zebraOpacity: number;
}

/**
 * The one flag for the color controls (owner decision for the style engines:
 * hide them, keep their code). Off: the panel hides the color pickers and the
 * Copy CSS / Reset colors export, and styleVars() writes no color override,
 * so every color is the host's design-system token. On: both come back.
 */
export const SHOW_COLOR_CONTROLS = false;

/**
 * The host contract colors the engine once shipped as its own palette, by key,
 * with the contract variable each one is read from.
 */
const BASE_TOKEN_VARS = {
	background: "--background",
	foreground: "--foreground",
	card: "--card",
	cardForeground: "--card-foreground",
	muted: "--muted",
	mutedForeground: "--muted-foreground",
	border: "--border",
	statusNeutralFill: "--status-neutral-fill",
	statusNeutralBorder: "--status-neutral-border",
	statusSuccessFill: "--status-success-fill",
	statusSuccessBorder: "--status-success-border",
	statusWarningFill: "--status-warning-fill",
	statusWarningBorder: "--status-warning-border",
	statusInfoFill: "--status-info-fill",
	statusInfoBorder: "--status-info-border",
	agentPrismMuted: "--agentprism-muted",
	agentPrismBorder: "--agentprism-border-subtle",
	agentPrismCodeBase: "--agentprism-code-base"
} as const;

export type BaseTokenKey = keyof typeof BASE_TOKEN_VARS;

/**
 * A user-picker-editable color token. `id` is the override-map key; `cssVar`
 * is the contract variable it overrides on the shell; `format` decides how the
 * value is serialized (RGB-triplet `27 27 28` neutrals/accents vs literal
 * `#1e1e1e` editor colors). `baseTokenKey` links a neutral back to its
 * effectiveBaseTokens entry; editor and accent tokens have none.
 */
export interface ColorTokenDescriptor {
	id: string;
	label: string;
	group: ColorTokenGroup;
	format: ColorTokenFormat;
	cssVar: string;
	baseTokenKey?: BaseTokenKey;
	reserved?: boolean;
	reservedNote?: string;
}

/** Per-token hex overrides ("#RRGGBB"), keyed by ColorTokenDescriptor.id. */
export type ColorOverrides = Record<string, string>;

export interface StyleSettings {
	theme: ThemeMode;
	layout: LayoutStyleSettings;
	grain: GrainSettings;
	traceIcons: TraceIconSettings;
	treeChrome: TreeChromeSettings;
	selection: SelectionStyleSettings;
	codeBlock: CodeBlockStyleSettings;
	colorOverrides: ColorOverrides;
	activeTab: StylePanelTab;
}

export type GrainSettingsPatch = Omit<Partial<GrainSettings>, "softening" | "svgNormal" | "cssBevel"> & {
	softening?: Partial<SofteningSettings>;
	svgNormal?: Partial<SvgNormalSettings>;
	cssBevel?: Partial<CssBevelSettings>;
};

export interface StyleSettingsPatch {
	theme?: ThemeMode;
	layout?: Partial<LayoutStyleSettings>;
	grain?: GrainSettingsPatch;
	traceIcons?: Partial<TraceIconSettings>;
	treeChrome?: Partial<TreeChromeSettings>;
	selection?: Partial<SelectionStyleSettings>;
	codeBlock?: Partial<CodeBlockStyleSettings>;
	colorOverrides?: ColorOverrides | null;
	activeTab?: StylePanelTab;
}

type Rgb = readonly [number, number, number];

export const DEFAULT_LAYOUT_STYLE_SETTINGS: LayoutStyleSettings = {
	framePadding: 16,
	workspaceMinHeight: 680,
	headerHeight: 72
};

export const DEFAULT_SOFTENING_SETTINGS: SofteningSettings = {
	background: 1,
	font: 0.8,
	borders: 0.8,
	icons: 0.8
};

export const DEFAULT_SVG_NORMAL_SETTINGS: SvgNormalSettings = {
	enabled: false,
	opacity: 0.08,
	frequency: 0.72,
	depth: 1.6,
	azimuth: 135,
	elevation: 44
};

export const DEFAULT_CSS_BEVEL_SETTINGS: CssBevelSettings = {
	enabled: false,
	strength: 0.45,
	depth: 1.2,
	highlight: 0.55,
	shadow: 0.55,
	text: 0.25
};

export const DEFAULT_GRAIN_SETTINGS: GrainSettings = {
	enabled: true,
	opacity: 0.1,
	frequency: 0.8,
	contrast: 1.3,
	blendMode: "screen",
	softening: DEFAULT_SOFTENING_SETTINGS,
	svgNormal: DEFAULT_SVG_NORMAL_SETTINGS,
	cssBevel: DEFAULT_CSS_BEVEL_SETTINGS
};

export const DEFAULT_TRACE_ICON_SETTINGS: TraceIconSettings = {
	side: "left",
	style: "outline"
};

/** Matches the styles.css defaults in BOTH themes (wash 10%, border 45%…). */
export const DEFAULT_TREE_CHROME_SETTINGS: TreeChromeSettings = {
	bandWashOpacity: 0.1,
	bandBorderOpacity: 0.45,
	caretOpacity: 1,
	connectorOpacity: 0.8
};

/** Matches the styles.css defaults in BOTH themes (2px ring, 3px bar). */
export const DEFAULT_SELECTION_STYLE_SETTINGS: SelectionStyleSettings = {
	opacity: 1,
	ringWidth: 2,
	barWidth: 3
};

/** Matches today's "slight" striping (theme rule hairline at 4%). */
export const DEFAULT_CODE_BLOCK_STYLE_SETTINGS: CodeBlockStyleSettings = {
	zebraOpacity: 0.04
};

export const DEFAULT_STYLE_PANEL_TAB: StylePanelTab = "colors";

export const DEFAULT_COLOR_OVERRIDES: ColorOverrides = {};

/** Light is the default — the doc-paper viewer look. */
export const DEFAULT_THEME: ThemeMode = "light";

export const THEME_OPTIONS: ReadonlyArray<{ id: ThemeMode; label: string }> = [
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" }
];

export const BASE_DEFAULT_STYLE_SETTINGS: StyleSettings = {
	theme: DEFAULT_THEME,
	layout: DEFAULT_LAYOUT_STYLE_SETTINGS,
	grain: DEFAULT_GRAIN_SETTINGS,
	traceIcons: DEFAULT_TRACE_ICON_SETTINGS,
	treeChrome: DEFAULT_TREE_CHROME_SETTINGS,
	selection: DEFAULT_SELECTION_STYLE_SETTINGS,
	codeBlock: DEFAULT_CODE_BLOCK_STYLE_SETTINGS,
	colorOverrides: DEFAULT_COLOR_OVERRIDES,
	activeTab: DEFAULT_STYLE_PANEL_TAB
};

/**
 * The "colors" tab keeps its id (saved blobs and host `sections` name it).
 * With the color controls hidden it holds the theme switch and the strength
 * sliders only, so it is labeled Theme.
 */
export const STYLE_PANEL_TAB_OPTIONS: ReadonlyArray<{ id: StylePanelTab; label: string }> = [
	{ id: "colors", label: SHOW_COLOR_CONTROLS ? "Colors" : "Theme" },
	{ id: "effects", label: "Effects" },
	{ id: "trace", label: "Trace" },
	{ id: "layout", label: "Layout" }
];

export const GRAIN_BLEND_OPTIONS: ReadonlyArray<{ id: GrainBlendMode; label: string }> = [
	{ id: "screen", label: "Screen" },
	{ id: "overlay", label: "Overlay" },
	{ id: "soft-light", label: "Soft Light" },
	{ id: "normal", label: "Normal" }
];

export const SOFTENING_CHANNEL_OPTIONS: ReadonlyArray<{ id: SofteningChannel; label: string }> = [
	{ id: "background", label: "Background" },
	{ id: "font", label: "Font" },
	{ id: "borders", label: "Borders" },
	{ id: "icons", label: "Icons" }
];

export const TRACE_ICON_SIDE_OPTIONS: ReadonlyArray<{ id: TraceIconSide; label: string }> = [
	{ id: "left", label: "Left" },
	{ id: "right", label: "Right" }
];

export const TRACE_ICON_STYLE_OPTIONS: ReadonlyArray<{ id: TraceIconStyle; label: string }> = [
	{ id: "outline", label: "Outline" },
	{ id: "solid", label: "Solid" }
];

/**
 * The full catalog of picker-editable color tokens. Order within a group is the
 * display order. Neutrals/accents serialize as RGB triplets; editor tokens as
 * literal hex. Alpha-bearing tokens (rules/guides/landmarks) are intentionally
 * excluded — solid colors only this pass.
 */
export const COLOR_TOKENS: ReadonlyArray<ColorTokenDescriptor> = [
	// Neutrals — written in the host's neutralTokenFormat, with their followers
	// (see NEUTRAL_OVERRIDE_TARGETS).
	{ id: "background", label: "Background", group: "neutrals", format: "triplet", cssVar: "--background", baseTokenKey: "background" },
	{ id: "card", label: "Card / Surface", group: "neutrals", format: "triplet", cssVar: "--card", baseTokenKey: "card" },
	{ id: "muted", label: "Muted / Well", group: "neutrals", format: "triplet", cssVar: "--muted", baseTokenKey: "muted" },
	{ id: "border", label: "Border", group: "neutrals", format: "triplet", cssVar: "--border", baseTokenKey: "border" },
	{ id: "foreground", label: "Foreground", group: "neutrals", format: "triplet", cssVar: "--foreground", baseTokenKey: "foreground" },
	{ id: "mutedForeground", label: "Muted Foreground", group: "neutrals", format: "triplet", cssVar: "--muted-foreground", baseTokenKey: "mutedForeground" },
	// Editor — literal hex, set directly on the shell.
	{ id: "editorBg", label: "Editor BG", group: "editor", format: "hex", cssVar: "--editor-bg" },
	{ id: "editorFg", label: "Editor FG", group: "editor", format: "hex", cssVar: "--editor-fg" },
	{ id: "editorLineNumber", label: "Line Number", group: "editor", format: "hex", cssVar: "--editor-line-number" },
	// Accents — written onto their own variable; reserved diagnostics locked.
	{ id: "traceOrchestration", label: "Orchestration", group: "accents", format: "triplet", cssVar: "--trace-orchestration" },
	{ id: "traceUser", label: "User", group: "accents", format: "triplet", cssVar: "--trace-user" },
	{ id: "traceAssistant", label: "Assistant", group: "accents", format: "triplet", cssVar: "--trace-assistant" },
	{ id: "traceTool", label: "Tool", group: "accents", format: "triplet", cssVar: "--trace-tool" },
	{ id: "traceLifecycle", label: "Lifecycle", group: "accents", format: "triplet", cssVar: "--trace-lifecycle" },
	{ id: "statusWarning", label: "Warning", group: "accents", format: "triplet", cssVar: "--status-warning", reserved: true, reservedNote: "reserved · diagnostics" },
	{ id: "statusError", label: "Error", group: "accents", format: "triplet", cssVar: "--destructive", reserved: true, reservedNote: "reserved · diagnostics" },
	// Tree chrome — carets + connector/indent lines (opacities are sliders).
	{ id: "treeCaret", label: "Caret", group: "tree", format: "triplet", cssVar: "--tree-caret" },
	{ id: "treeConnector", label: "Connector", group: "tree", format: "triplet", cssVar: "--tree-connector" },
	// Selection — the ring/bar highlight color (sliders live beside it).
	{ id: "selectionColor", label: "Highlight", group: "selection", format: "triplet", cssVar: "--selection-color" },
	// Code block — zebra stripe color (the opacity slider lives beside it).
	{ id: "zebraColor", label: "Zebra Stripe", group: "code", format: "triplet", cssVar: "--zebra-color" }
];

const COLOR_TOKENS_BY_ID: Record<string, ColorTokenDescriptor> = Object.fromEntries(
	COLOR_TOKENS.map((token) => [token.id, token])
);

export function getColorToken(id: string): ColorTokenDescriptor | undefined {
	return COLOR_TOKENS_BY_ID[id];
}

function clampChannel(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(255, Math.max(0, Math.round(value)));
}

/** Serialize an RGB triplet as an uppercase `#RRGGBB` hex string. */
export function rgbToHex(rgb: Rgb): string {
	return (
		"#" +
		[rgb[0], rgb[1], rgb[2]]
			.map((channel) => clampChannel(channel).toString(16).padStart(2, "0"))
			.join("")
			.toUpperCase()
	);
}

/**
 * Parse `#RGB` / `#RRGGBB` (with or without the leading `#`, any case) into an
 * RGB triplet. Returns null for anything malformed so callers can reject input.
 */
export function hexToRgb(input: string): Rgb | null {
	if (typeof input !== "string") return null;
	const trimmed = input.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]+$/.test(trimmed)) return null;
	let expanded: string;
	if (trimmed.length === 3) {
		expanded = trimmed.split("").map((char) => char + char).join("");
	} else if (trimmed.length === 6) {
		expanded = trimmed;
	} else {
		return null;
	}
	const r = parseInt(expanded.slice(0, 2), 16);
	const g = parseInt(expanded.slice(2, 4), 16);
	const b = parseInt(expanded.slice(4, 6), 16);
	return [r, g, b];
}

/** Normalize any accepted hex form to canonical `#RRGGBB`, or null if invalid. */
export function normalizeHex(input: string): string | null {
	const rgb = hexToRgb(input);
	return rgb ? rgbToHex(rgb) : null;
}

/** `27 27 28` → `#1B1B1C`. Returns null if the triplet is malformed. */
export function tripletToHex(input: string): string | null {
	const parts = input.trim().split(/\s+/).map((part) => Number(part));
	if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
	return rgbToHex([parts[0], parts[1], parts[2]]);
}

/** `#1B1B1C` → `27 27 28`. Returns null if the hex is malformed. */
export function hexToTriplet(input: string): string | null {
	const rgb = hexToRgb(input);
	return rgb ? `${rgb[0]} ${rgb[1]} ${rgb[2]}` : null;
}

/**
 * A host contract value as canonical `#RRGGBB`: an RGB triplet (`27 27 28`,
 * optionally `/ alpha`), `#RGB`/`#RRGGBB`, or `rgb()`/`rgba()` with numeric
 * channels. The alpha is dropped. Null for anything else (empty, `color-mix()`,
 * an unresolved `var()`).
 */
export function parseHostColor(value: string): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.startsWith("#")) return normalizeHex(trimmed);
	const fn = /^rgba?\((.*)\)$/i.exec(trimmed);
	const body = (fn ? fn[1] : trimmed).split("/")[0].trim();
	const parts = body.split(fn ? /[\s,]+/ : /\s+/).filter(Boolean);
	// rgba(r, g, b, a): the comma form carries the alpha as a fourth part.
	const channels = fn && parts.length === 4 ? parts.slice(0, 3) : parts;
	if (channels.length !== 3 || channels.some((part) => !/^\d{1,3}(\.\d+)?$/.test(part))) return null;
	return tripletToHex(channels.join(" "));
}

/**
 * The host's current value of a contract variable (`--background`,
 * `--trace-user`, …) as `#RRGGBB`, read from the live CSS: the design-system
 * tokens the host loads through host-contract.css. Reads `element`, or the
 * document root, so overrides on the style shell do not count. Null outside a
 * browser or when the value is not a plain color.
 */
export function hostColorHex(cssVar: string, element?: Element | null): string | null {
	const doc = (globalThis as { document?: Document }).document;
	const target = element ?? doc?.documentElement;
	if (!target || typeof globalThis.getComputedStyle !== "function") return null;
	return parseHostColor(globalThis.getComputedStyle(target).getPropertyValue(cssVar));
}

/**
 * A token's default color (its value before any override), as `#RRGGBB`: the
 * host's live contract value (hostColorHex). That value follows the document's
 * active theme, which hosts keep equal to settings.theme, so `theme` only
 * documents the caller's intent. Empty string when the value cannot be read.
 */
export function colorTokenDefaultHex(token: ColorTokenDescriptor, _theme: ThemeMode): string {
	return hostColorHex(token.cssVar) ?? "";
}

/**
 * The effective (override-or-default) color for a token, as `#RRGGBB` hex.
 * Empty string when there is no override and the default cannot be read.
 */
export function colorTokenEffectiveHex(
	token: ColorTokenDescriptor,
	overrides: ColorOverrides,
	theme: ThemeMode
): string {
	const override = overrides[token.id];
	if (override) {
		const normalized = normalizeHex(override);
		if (normalized) return normalized;
	}
	return colorTokenDefaultHex(token, theme);
}

/**
 * The value to write into a token's CSS custom property: a triplet string for
 * neutrals/accents, a hex string for editor tokens.
 */
export function colorTokenCssValue(token: ColorTokenDescriptor, hex: string): string {
	if (token.format === "triplet") {
		return hexToTriplet(hex) ?? hex;
	}
	return normalizeHex(hex) ?? hex;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.min(max, Math.max(min, numeric));
}

function isGrainBlendMode(value: unknown): value is GrainBlendMode {
	return GRAIN_BLEND_OPTIONS.some((option) => option.id === value);
}

function normalizeLayoutSettings(input: unknown): LayoutStyleSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		framePadding: clampNumber(source.framePadding, 8, 28, DEFAULT_LAYOUT_STYLE_SETTINGS.framePadding),
		workspaceMinHeight: clampNumber(source.workspaceMinHeight, 560, 820, DEFAULT_LAYOUT_STYLE_SETTINGS.workspaceMinHeight),
		headerHeight: clampNumber(source.headerHeight, 56, 88, DEFAULT_LAYOUT_STYLE_SETTINGS.headerHeight)
	};
}

function normalizeSofteningSettings(input: unknown): SofteningSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		background: clampNumber(source.background, 0, 1, DEFAULT_SOFTENING_SETTINGS.background),
		font: clampNumber(source.font, 0, 1, DEFAULT_SOFTENING_SETTINGS.font),
		borders: clampNumber(source.borders, 0, 1, DEFAULT_SOFTENING_SETTINGS.borders),
		icons: clampNumber(source.icons, 0, 1, DEFAULT_SOFTENING_SETTINGS.icons)
	};
}

function normalizeSvgNormalSettings(input: unknown): SvgNormalSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SVG_NORMAL_SETTINGS.enabled,
		opacity: clampNumber(source.opacity, 0, 0.2, DEFAULT_SVG_NORMAL_SETTINGS.opacity),
		frequency: clampNumber(source.frequency, 0.12, 1.8, DEFAULT_SVG_NORMAL_SETTINGS.frequency),
		depth: clampNumber(source.depth, 0, 8, DEFAULT_SVG_NORMAL_SETTINGS.depth),
		azimuth: clampNumber(source.azimuth, 0, 360, DEFAULT_SVG_NORMAL_SETTINGS.azimuth),
		elevation: clampNumber(source.elevation, 5, 90, DEFAULT_SVG_NORMAL_SETTINGS.elevation)
	};
}

function normalizeCssBevelSettings(input: unknown): CssBevelSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CSS_BEVEL_SETTINGS.enabled,
		strength: clampNumber(source.strength, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.strength),
		depth: clampNumber(source.depth, 0, 4, DEFAULT_CSS_BEVEL_SETTINGS.depth),
		highlight: clampNumber(source.highlight, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.highlight),
		shadow: clampNumber(source.shadow, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.shadow),
		text: clampNumber(source.text, 0, 1, DEFAULT_CSS_BEVEL_SETTINGS.text)
	};
}

export function normalizeGrainSettings(input: GrainSettingsPatch | Record<string, unknown>): GrainSettings {
	return {
		enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_GRAIN_SETTINGS.enabled,
		opacity: clampNumber(input.opacity, 0, 0.24, DEFAULT_GRAIN_SETTINGS.opacity),
		frequency: clampNumber(input.frequency, 0.25, 1.6, DEFAULT_GRAIN_SETTINGS.frequency),
		contrast: clampNumber(input.contrast, 0.55, 2.2, DEFAULT_GRAIN_SETTINGS.contrast),
		blendMode: isGrainBlendMode(input.blendMode) ? input.blendMode : DEFAULT_GRAIN_SETTINGS.blendMode,
		softening: normalizeSofteningSettings(input.softening),
		svgNormal: normalizeSvgNormalSettings(input.svgNormal),
		cssBevel: normalizeCssBevelSettings(input.cssBevel)
	};
}

function isTraceIconSide(value: unknown): value is TraceIconSide {
	return TRACE_ICON_SIDE_OPTIONS.some((option) => option.id === value);
}

function isTraceIconStyle(value: unknown): value is TraceIconStyle {
	return TRACE_ICON_STYLE_OPTIONS.some((option) => option.id === value);
}

function normalizeTraceIconSettings(input: unknown): TraceIconSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		side: isTraceIconSide(source.side) ? source.side : DEFAULT_TRACE_ICON_SETTINGS.side,
		style: isTraceIconStyle(source.style) ? source.style : DEFAULT_TRACE_ICON_SETTINGS.style
	};
}

function normalizeTreeChromeSettings(input: unknown): TreeChromeSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		bandWashOpacity: clampNumber(source.bandWashOpacity, 0, 0.25, DEFAULT_TREE_CHROME_SETTINGS.bandWashOpacity),
		bandBorderOpacity: clampNumber(source.bandBorderOpacity, 0.1, 1, DEFAULT_TREE_CHROME_SETTINGS.bandBorderOpacity),
		caretOpacity: clampNumber(source.caretOpacity, 0.2, 1, DEFAULT_TREE_CHROME_SETTINGS.caretOpacity),
		connectorOpacity: clampNumber(source.connectorOpacity, 0, 1, DEFAULT_TREE_CHROME_SETTINGS.connectorOpacity)
	};
}

function normalizeSelectionSettings(input: unknown): SelectionStyleSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		opacity: clampNumber(source.opacity, 0.2, 1, DEFAULT_SELECTION_STYLE_SETTINGS.opacity),
		ringWidth: clampNumber(source.ringWidth, 1, 4, DEFAULT_SELECTION_STYLE_SETTINGS.ringWidth),
		barWidth: clampNumber(source.barWidth, 0, 6, DEFAULT_SELECTION_STYLE_SETTINGS.barWidth)
	};
}

function normalizeCodeBlockSettings(input: unknown): CodeBlockStyleSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		zebraOpacity: clampNumber(source.zebraOpacity, 0, 0.15, DEFAULT_CODE_BLOCK_STYLE_SETTINGS.zebraOpacity)
	};
}

function isThemeMode(value: unknown): value is ThemeMode {
	return THEME_OPTIONS.some((option) => option.id === value);
}

function isStylePanelTab(value: unknown): value is StylePanelTab {
	return STYLE_PANEL_TAB_OPTIONS.some((option) => option.id === value);
}

/**
 * Keep only known token ids with valid, canonicalized hex values. Unknown ids
 * and malformed values are dropped so persisted state can never poison the UI.
 */
export function normalizeColorOverrides(input: unknown): ColorOverrides {
	if (!input || typeof input !== "object") return {};
	const source = input as Record<string, unknown>;
	const result: ColorOverrides = {};
	for (const token of COLOR_TOKENS) {
		const raw = source[token.id];
		if (typeof raw !== "string") continue;
		const normalized = normalizeHex(raw);
		if (normalized) result[token.id] = normalized;
	}
	return result;
}

export function normalizeStyleSettings(
	input: StyleSettingsPatch | Record<string, unknown>,
	config: StyleSystemConfig
): StyleSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		// A blob that never stored a theme gets the APP default, not the shared one.
		theme: isThemeMode(source.theme) ? source.theme : config.defaultTheme,
		layout: normalizeLayoutSettings(source.layout),
		treeChrome: normalizeTreeChromeSettings(source.treeChrome),
		selection: normalizeSelectionSettings(source.selection),
		codeBlock: normalizeCodeBlockSettings(source.codeBlock),
		grain: normalizeGrainSettings(
			source.grain && typeof source.grain === "object"
				? source.grain as Record<string, unknown>
				: {}
		),
		traceIcons: normalizeTraceIconSettings(source.traceIcons),
		colorOverrides: normalizeColorOverrides(source.colorOverrides),
		activeTab: isStylePanelTab(source.activeTab) ? source.activeTab : DEFAULT_STYLE_PANEL_TAB
	};
}

/**
 * Fold a colorOverrides patch into the current map. A `null` patch clears every
 * override (reset-all); otherwise each entry is merged, and an empty-string
 * value removes that single token's override (per-token reset).
 */
export function mergeColorOverrides(
	current: ColorOverrides,
	patch: ColorOverrides | null | undefined
): ColorOverrides {
	if (patch === null) return {};
	if (!patch) return current;
	const next: ColorOverrides = { ...current };
	for (const [id, value] of Object.entries(patch)) {
		if (value === "") {
			delete next[id];
		} else {
			next[id] = value;
		}
	}
	return next;
}

export function mergeStyleSettings(
	config: StyleSystemConfig,
	current: StyleSettings,
	updates: StyleSettingsPatch
): StyleSettings {
	return normalizeStyleSettings({
		...current,
		...updates,
		layout: { ...current.layout, ...(updates.layout ?? {}) },
		grain: {
			...current.grain,
			...(updates.grain ?? {}),
			softening: { ...current.grain.softening, ...(updates.grain?.softening ?? {}) },
			svgNormal: { ...current.grain.svgNormal, ...(updates.grain?.svgNormal ?? {}) },
			cssBevel: { ...current.grain.cssBevel, ...(updates.grain?.cssBevel ?? {}) }
		},
		traceIcons: { ...current.traceIcons, ...(updates.traceIcons ?? {}) },
		treeChrome: { ...current.treeChrome, ...(updates.treeChrome ?? {}) },
		selection: { ...current.selection, ...(updates.selection ?? {}) },
		codeBlock: { ...current.codeBlock, ...(updates.codeBlock ?? {}) },
		colorOverrides:
			"colorOverrides" in updates
				? mergeColorOverrides(current.colorOverrides, updates.colorOverrides)
				: current.colorOverrides,
		activeTab: updates.activeTab ?? current.activeTab
	}, config);
}

/** The app's default settings: shared defaults + the app's default theme. */
export function defaultStyleSettings(config: StyleSystemConfig): StyleSettings {
	return { ...BASE_DEFAULT_STYLE_SETTINGS, theme: config.defaultTheme };
}

/**
 * The localStorage key the settings blob is stored under: the app's
 * settingsStorageKey with its trailing `.v<N>` raised by one
 * (`simpleResearchStyleSettings.v1` → `simpleResearchStyleSettings.v2`), or
 * `.v2` appended when it has none. The raise marks the token-seeded engine: a
 * blob saved before it can hold color overrides, which would paint over the
 * host's design-system tokens.
 */
export function styleSettingsStorageKey(config: StyleSystemConfig): string {
	const match = /^(.*)\.v(\d+)$/.exec(config.settingsStorageKey);
	return match ? `${match[1]}.v${Number(match[2]) + 1}` : `${config.settingsStorageKey}.v2`;
}

/**
 * Load the app's settings. Without a blob under styleSettingsStorageKey, the
 * first load carries the non-color settings (theme, layout, effects, trace
 * icons, strengths, active tab) over from the app's own key and drops its
 * color overrides. The old blob is left where it is.
 */
export function loadStyleSettings(config: StyleSystemConfig): StyleSettings {
	try {
		const raw = localStorage.getItem(styleSettingsStorageKey(config));
		if (raw) return normalizeStyleSettings(JSON.parse(raw) as Record<string, unknown>, config);
		const legacy = localStorage.getItem(config.settingsStorageKey);
		if (!legacy) return defaultStyleSettings(config);
		const parsed: unknown = JSON.parse(legacy);
		const source = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
		return normalizeStyleSettings({ ...source, colorOverrides: {} }, config);
	} catch {
		return defaultStyleSettings(config);
	}
}

export function saveStyleSettings(config: StyleSystemConfig, settings: StyleSettings) {
	try {
		localStorage.setItem(styleSettingsStorageKey(config), JSON.stringify(settings));
	} catch {
		// The live settings still apply if storage is unavailable.
	}
}

type BaseTokens = { [K in BaseTokenKey]: Rgb };

/** Channels for a contract color the live CSS does not give (no DOM): never painted. */
const UNREAD_RGB: Rgb = [0, 0, 0];

/**
 * The host's neutral and status contract colors (read from the live CSS, see
 * hostColorHex) with neutral picker overrides shadowed in. Overriding
 * `foreground` also drives `cardForeground` so body text stays a single color.
 * `theme` documents the caller's intent, as in colorTokenDefaultHex.
 */
export function effectiveBaseTokens(overrides: ColorOverrides, _theme: ThemeMode): BaseTokens {
	const next = {} as BaseTokens;
	for (const key of Object.keys(BASE_TOKEN_VARS) as BaseTokenKey[]) {
		next[key] = hexToRgb(hostColorHex(BASE_TOKEN_VARS[key]) ?? "") ?? UNREAD_RGB;
	}
	for (const tokenDesc of COLOR_TOKENS) {
		if (tokenDesc.group !== "neutrals" || !tokenDesc.baseTokenKey) continue;
		const override = overrides[tokenDesc.id];
		if (!override) continue;
		const rgb = hexToRgb(override);
		if (!rgb) continue;
		next[tokenDesc.baseTokenKey] = rgb;
		if (tokenDesc.baseTokenKey === "foreground") next.cardForeground = rgb;
	}
	return next;
}

/**
 * Where a neutral override is written: its own variable and the shadcn names
 * that follow it (in the host's neutralTokenFormat), the viewer-only names
 * that follow it (always triplets), and the shadcn aliases only Tailwind v4
 * hex hosts read.
 */
const NEUTRAL_OVERRIDE_TARGETS: Record<string, { neutral: string[]; triplet: string[]; hexAliases: string[] }> = {
	background: { neutral: ["--background"], triplet: ["--agentprism-background"], hexAliases: ["--primary-foreground"] },
	card: { neutral: ["--card"], triplet: [], hexAliases: ["--popover"] },
	muted: { neutral: ["--muted"], triplet: [], hexAliases: ["--secondary"] },
	border: { neutral: ["--border", "--input"], triplet: [], hexAliases: [] },
	foreground: {
		neutral: ["--foreground", "--card-foreground"],
		triplet: ["--agentprism-foreground"],
		hexAliases: ["--popover-foreground", "--primary", "--secondary-foreground"]
	},
	mutedForeground: {
		neutral: ["--muted-foreground"],
		triplet: ["--trace-container", "--agentprism-muted-foreground"],
		hexAliases: []
	}
};

/**
 * The variables a set of color overrides writes onto the style shell: each
 * overridden token on its own contract variable (neutrals in the host's
 * neutralTokenFormat with their followers, viewer-only colors as triplets,
 * editor colors as hex). A token without an override writes nothing, so the
 * host's token stays live. styleVars() uses it only while SHOW_COLOR_CONTROLS
 * is on.
 */
export function colorOverrideVars(overrides: ColorOverrides, config: StyleSystemConfig): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const tokenDesc of COLOR_TOKENS) {
		const hex = normalizeHex(overrides[tokenDesc.id] ?? "");
		if (!hex) continue;
		const targets = tokenDesc.group === "neutrals" ? NEUTRAL_OVERRIDE_TARGETS[tokenDesc.id] : undefined;
		if (!targets) {
			vars[tokenDesc.cssVar] = colorTokenCssValue(tokenDesc, hex);
			continue;
		}
		const triplet = hexToTriplet(hex) ?? hex;
		const neutral = config.neutralTokenFormat === "hex" ? hex : triplet;
		for (const name of targets.neutral) vars[name] = neutral;
		for (const name of targets.triplet) vars[name] = triplet;
		if (config.neutralTokenFormat === "hex") for (const name of targets.hexAliases) vars[name] = hex;
	}
	return vars;
}

export function styleVars(
	settings: StyleSettings,
	config: StyleSystemConfig
): CSSProperties {
	const { font, icons } = settings.grain.softening;
	const bevelStrength = settings.grain.cssBevel.enabled ? settings.grain.cssBevel.strength : 0;

	// No color here: the host's tokens (host-contract.css) color the shell.
	// Saved overrides are written only while the color controls are shown.
	const colorVars = SHOW_COLOR_CONTROLS ? colorOverrideVars(settings.colorOverrides, config) : {};

	// SCALE NEUTRALITY: the shared system must never change a host's sizing
	// context. Layout geometry vars (padding/workspace/header heights) are
	// example-app knobs; they are emitted ONLY when the host opts into the
	// LAYOUT section. Nothing here may ever set font-size/zoom/transform.
	const emitLayoutVars =
		config.sections === undefined || config.sections.includes("layout");
	const layoutVars: Record<string, string> = emitLayoutVars
		? {
				"--research-layout-padding": `${settings.layout.framePadding}px`,
				"--research-workspace-height": `calc(100vh - ${settings.layout.framePadding * 2}px)`,
				"--research-workspace-min-height": `${settings.layout.workspaceMinHeight}px`,
				"--research-header-height": `${settings.layout.headerHeight}px`,
			}
		: {};

	return {
		...colorVars,
		...layoutVars,
		"--band-wash-opacity": String(settings.treeChrome.bandWashOpacity),
		"--band-border-opacity": String(settings.treeChrome.bandBorderOpacity),
		"--tree-caret-opacity": String(settings.treeChrome.caretOpacity),
		"--tree-connector-opacity": String(settings.treeChrome.connectorOpacity),
		"--selection-opacity": String(settings.selection.opacity),
		"--selection-width": `${settings.selection.ringWidth}px`,
		"--selection-bar-width": `${settings.selection.barWidth}px`,
		"--zebra-opacity": String(settings.codeBlock.zebraOpacity),
		"--style-bevel-depth": `${settings.grain.cssBevel.depth * bevelStrength}px`,
		"--style-bevel-highlight-alpha": String(settings.grain.cssBevel.highlight * bevelStrength * 0.24),
		"--style-bevel-shadow-alpha": String(settings.grain.cssBevel.shadow * bevelStrength * 0.32),
		"--style-bevel-text-highlight-alpha": String(settings.grain.cssBevel.text * bevelStrength * 0.12),
		"--style-bevel-text-shadow-alpha": String(settings.grain.cssBevel.text * bevelStrength * 0.18),
		"--style-soften-font-glow": `${font * 0.2}px`,
		"--style-soften-icon-blur": `${icons * 0.08}px`,
		"--style-soften-icon-glow": `${icons * 0.24}px`,
		"--style-soften-icon-opacity": String(1 - icons * 0.04)
	} as CSSProperties;
}

export function styleEffectClass(settings: StyleSettings): string {
	return settings.grain.cssBevel.enabled && settings.grain.cssBevel.strength > 0
		? "style-bevel-enabled"
		: "";
}

/**
 * Build a paste-ready CSS block of the EFFECTIVE contract colors (the host's
 * live values with overrides applied) and the strength knobs, for a host
 * stylesheet's :root after host-contract.css. A token whose value cannot be
 * read as a plain color is left out.
 */
export function buildColorExport(
	overrides: ColorOverrides,
	theme: ThemeMode,
	treeChrome: TreeChromeSettings = DEFAULT_TREE_CHROME_SETTINGS,
	selection: SelectionStyleSettings = DEFAULT_SELECTION_STYLE_SETTINGS,
	codeBlock: CodeBlockStyleSettings = DEFAULT_CODE_BLOCK_STYLE_SETTINGS
): string {
	const rootLines: string[] = [];
	for (const tokenDesc of COLOR_TOKENS) {
		const hex = colorTokenEffectiveHex(tokenDesc, overrides, theme);
		if (hex) rootLines.push(`  ${tokenDesc.cssVar}: ${colorTokenCssValue(tokenDesc, hex)};`);
	}
	rootLines.push(`  --band-wash-opacity: ${treeChrome.bandWashOpacity};`);
	rootLines.push(`  --band-border-opacity: ${treeChrome.bandBorderOpacity};`);
	rootLines.push(`  --tree-caret-opacity: ${treeChrome.caretOpacity};`);
	rootLines.push(`  --tree-connector-opacity: ${treeChrome.connectorOpacity};`);
	rootLines.push(`  --selection-opacity: ${selection.opacity};`);
	rootLines.push(`  --selection-width: ${selection.ringWidth}px;`);
	rootLines.push(`  --selection-bar-width: ${selection.barWidth}px;`);
	rootLines.push(`  --zebra-opacity: ${codeBlock.zebraOpacity};`);

	return ["/* → host stylesheet :root, after host-contract.css */", ...rootLines].join("\n");
}
