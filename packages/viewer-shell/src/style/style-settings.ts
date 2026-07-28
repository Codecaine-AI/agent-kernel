/**
 * Shared viewer style system — settings model, per-theme palettes, and the
 * CSS-variable emission every host app mounts on its style shell.
 *
 * Extracted from examples/simple-research-kernel so all apps composing the
 * @agent-kernel viewer packages (the example app, the canvas-agent viewer, …)
 * share ONE style rail: theme (light/dark doc palettes), color pickers,
 * tree-chrome strength, grain/bevel effects, trace icon options.
 *
 * The app-level seam is StyleSystemConfig: each app names its own storage
 * keys, default theme, visible panel sections, and — crucially — the token
 * format its Tailwind setup consumes for the shared-name neutral tokens:
 *   "triplet" — `--background: 27 27 28` (Tailwind v3 rgb(var(--x)/<alpha>))
 *   "hex"     — `--background: #1B1B1C` (Tailwind v4 @theme inline var(--x))
 * Viewer-only tokens (status-*, trace-*, agentprism-*) are RGB triplets in
 * every host and are always emitted as triplets.
 */
import type { CSSProperties } from "react";

export type GrainBlendMode = "screen" | "overlay" | "soft-light" | "normal";
export type SofteningChannel = "background" | "font" | "borders" | "icons";

export interface LayoutStyleSettings {
	framePadding: number;
	workspaceMinHeight: number;
	headerHeight: number;
}

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
 * The two shipped palettes. Light is the default (doc-paper look derived from
 * the state-shapes explainer); dark is the Instrument Telemetry calibration.
 * Both drive the same semantic tokens — see styles.css.
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
	/** localStorage key for the settings blob (keep stable across releases). */
	settingsStorageKey: string;
	/** localStorage keys for the rail's collapsed/width chrome state. */
	railCollapsedStorageKey: string;
	railWidthStorageKey: string;
	/** The theme a fresh install (or a pre-theme settings blob) gets. */
	defaultTheme: ThemeMode;
	/** How --background/--foreground/… are emitted (see module doc). */
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
 * A user-picker-editable color token. `id` is the override-map key; `cssVar`
 * is the custom property set on the shell; `format` decides how the value is
 * serialized (RGB-triplet `27 27 28` neutrals/accents vs literal `#1e1e1e`
 * editor colors). `baseTokenKey` links a neutral/accent back to its BASE_TOKENS
 * entry so the overlay can shadow it BEFORE softening; editor tokens have none.
 */
export interface ColorTokenDescriptor {
	id: string;
	label: string;
	group: ColorTokenGroup;
	format: ColorTokenFormat;
	cssVar: string;
	baseTokenKey?: keyof typeof DARK_BASE_TOKENS;
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

export const STYLE_PANEL_TAB_OPTIONS: ReadonlyArray<{ id: StylePanelTab; label: string }> = [
	{ id: "colors", label: "Colors" },
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

// Per-theme neutral palettes. These are the RUNTIME source of truth for the
// neutral ladder — the style overlay inlines them onto .research-style-shell,
// shadowing the styles.css fallbacks. Keep each in lockstep with its styles.css
// block (:root = light, :root[data-theme="dark"] = dark).
//
// DARK: neutral gray ladder anchored on VS Code Dark+ (#252526 raised
// surface), cohesive with the #1E1E1E editor buffer. Warm-neutral, no blue cast.
const DARK_BASE_TOKENS = {
	background: [27, 27, 28],          // #1B1B1C — page base
	foreground: [212, 212, 212],       // #D4D4D4 — primary text
	card: [37, 37, 38],                // #252526 — raised surfaces
	cardForeground: [212, 212, 212],   // #D4D4D4
	muted: [42, 42, 43],               // #2A2A2B — inputs / wells on raised surfaces
	mutedForeground: [168, 168, 168],  // #A8A8A8 — secondary / label text
	border: [58, 58, 59],              // #3A3A3B — solid hairline
	statusNeutralFill: [42, 42, 43],   // #2A2A2B
	statusNeutralBorder: [74, 74, 76], // #4A4A4C
	statusSuccessFill: [10, 30, 22],
	statusSuccessBorder: [38, 92, 70],
	statusWarningFill: [34, 28, 10],
	statusWarningBorder: [96, 74, 28],
	statusInfoFill: [8, 30, 36],
	statusInfoBorder: [28, 84, 96],
	agentPrismMuted: [42, 42, 43],     // #2A2A2B
	agentPrismBorder: [58, 58, 59],    // #3A3A3B
	agentPrismCodeBase: [168, 168, 168] // #A8A8A8
} satisfies Record<string, Rgb>;

// LIGHT: doc-paper ladder from the state-shapes explainer palette.
const LIGHT_BASE_TOKENS = {
	background: [249, 249, 247],        // #F9F9F7 — page paper
	foreground: [26, 26, 25],           // #1A1A19 — ink
	card: [252, 252, 251],              // #FCFCFB — raised surfaces
	cardForeground: [26, 26, 25],
	muted: [241, 240, 235],             // #F1F0EB — inputs / wells
	mutedForeground: [82, 81, 78],      // #52514E — ink-2
	border: [225, 224, 217],            // #E1E0D9 — hairline rules
	statusNeutralFill: [241, 240, 235],
	statusNeutralBorder: [195, 194, 183], // #C3C2B7
	statusSuccessFill: [230, 244, 238],
	statusSuccessBorder: [167, 216, 196],
	statusWarningFill: [249, 243, 227],
	statusWarningBorder: [227, 205, 158],
	statusInfoFill: [232, 241, 251],
	statusInfoBorder: [182, 211, 242],
	agentPrismMuted: [241, 240, 235],
	agentPrismBorder: [225, 224, 217],
	agentPrismCodeBase: [241, 240, 235]
} satisfies Record<string, Rgb>;

const BASE_TOKENS_BY_THEME: Record<ThemeMode, typeof DARK_BASE_TOKENS> = {
	dark: DARK_BASE_TOKENS,
	light: LIGHT_BASE_TOKENS
};

// Softening targets: variants the base grays mix toward as the softening
// sliders rise. Dark mixes lighter; light mixes a touch deeper/warmer. Both
// stay on the same neutral family (no blue cast).
const DARK_SOFT_TARGETS = {
	background: [35, 35, 36],           // #232324
	card: [45, 45, 46],                 // #2D2D2E — hover/active neutral territory
	muted: [52, 52, 53],                // #343435
	foreground: [214, 214, 214],        // #D6D6D6
	mutedForeground: [176, 176, 176],   // #B0B0B0
	border: [74, 74, 76],               // #4A4A4C
	statusSuccessFill: [14, 39, 29],
	statusSuccessBorder: [54, 112, 86],
	statusWarningFill: [43, 36, 16],
	statusWarningBorder: [120, 94, 40],
	statusInfoFill: [13, 42, 49],
	statusInfoBorder: [48, 104, 116]
} satisfies Record<string, Rgb>;

const LIGHT_SOFT_TARGETS = {
	background: [245, 244, 240],
	card: [247, 246, 242],
	muted: [235, 234, 228],
	foreground: [38, 38, 36],
	mutedForeground: [95, 94, 90],
	border: [211, 210, 201],
	statusSuccessFill: [222, 240, 232],
	statusSuccessBorder: [150, 205, 183],
	statusWarningFill: [246, 238, 216],
	statusWarningBorder: [216, 192, 140],
	statusInfoFill: [222, 235, 249],
	statusInfoBorder: [163, 199, 236]
} satisfies Record<string, Rgb>;

const SOFT_TARGETS_BY_THEME: Record<ThemeMode, typeof DARK_SOFT_TARGETS> = {
	dark: DARK_SOFT_TARGETS,
	light: LIGHT_SOFT_TARGETS
};

// ── Color picker layer ────────────────────────────────────────────────────
// Accent/status color tokens live only in styles.css today (not in the base
// token ladders, and not emitted by styleVars). We mirror their
// per-theme default RGB triplets here so the overlay can emit user overrides
// on top and the export builder can print the effective lines. NOT softened.
const ACCENT_DEFAULTS_BY_THEME: Record<ThemeMode, Record<string, Rgb>> = {
	dark: {
		traceOrchestration: [167, 139, 250], // #A78BFA violet — context/snapshots
		traceUser: [96, 165, 250],           // #60A5FA
		traceAssistant: [84, 214, 147],      // #54D693
		traceTool: [232, 130, 61],           // #E8823D orange
		traceLifecycle: [168, 168, 168],     // #A8A8A8
		statusWarning: [220, 167, 76],       // #DCA74C
		statusError: [225, 91, 88],          // #E15B58 (--destructive)
		treeCaret: [168, 168, 168],          // #A8A8A8
		treeConnector: [58, 58, 59],         // #3A3A3B
		selectionColor: [84, 211, 224],      // #54D3E0 HUD cyan
		zebraColor: [255, 255, 255]          // light stripes on the void
	},
	light: {
		traceOrchestration: [124, 58, 237],  // #7C3AED violet — context/snapshots
		traceUser: [29, 102, 193],           // #1D66C1
		traceAssistant: [21, 125, 89],       // #157D59
		traceTool: [194, 65, 12],            // #C2410C orange
		traceLifecycle: [137, 135, 129],     // #898781
		statusWarning: [146, 100, 6],        // #926406
		statusError: [185, 28, 28],          // #B91C1C (--destructive)
		treeCaret: [82, 81, 78],             // #52514E
		treeConnector: [195, 194, 183],      // #C3C2B7
		selectionColor: [42, 120, 214],      // #2A78D6 doc accent blue
		zebraColor: [0, 0, 0]                // ink stripes on paper
	}
};

// Literal-hex editor defaults (consumed via var(--editor-*, fallback)).
const EDITOR_DEFAULTS_BY_THEME: Record<ThemeMode, Record<string, string>> = {
	dark: {
		editorBg: "#1e1e1e",
		editorFg: "#d4d4d4",
		editorLineNumber: "#858585"
	},
	light: {
		editorBg: "#fbfbf9",
		editorFg: "#1a1a19",
		editorLineNumber: "#898781"
	}
};

/**
 * The full catalog of picker-editable color tokens. Order within a group is the
 * display order. Neutrals/accents serialize as RGB triplets; editor tokens as
 * literal hex. Alpha-bearing tokens (rules/guides/landmarks) are intentionally
 * excluded — solid colors only this pass.
 */
export const COLOR_TOKENS: ReadonlyArray<ColorTokenDescriptor> = [
	// Neutrals — shadow BASE_TOKENS entries BEFORE softening.
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
	// Accents — emitted directly (no softening); reserved diagnostics locked.
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

/** The shipped default color for a token in a theme, as canonical `#RRGGBB` hex. */
export function colorTokenDefaultHex(token: ColorTokenDescriptor, theme: ThemeMode): string {
	if (token.format === "hex") {
		return normalizeHex(EDITOR_DEFAULTS_BY_THEME[theme][token.id] ?? "") ?? "#000000";
	}
	if (token.baseTokenKey) {
		return rgbToHex(BASE_TOKENS_BY_THEME[theme][token.baseTokenKey]);
	}
	const accent = ACCENT_DEFAULTS_BY_THEME[theme][token.id];
	return accent ? rgbToHex(accent) : "#000000";
}

/** The effective (override-or-default) color for a token, as `#RRGGBB` hex. */
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

export function loadStyleSettings(config: StyleSystemConfig): StyleSettings {
	try {
		const raw = localStorage.getItem(config.settingsStorageKey);
		if (!raw) return defaultStyleSettings(config);
		return normalizeStyleSettings(JSON.parse(raw) as Record<string, unknown>, config);
	} catch {
		return defaultStyleSettings(config);
	}
}

export function saveStyleSettings(config: StyleSystemConfig, settings: StyleSettings) {
	try {
		localStorage.setItem(config.settingsStorageKey, JSON.stringify(settings));
	} catch {
		// The live settings still apply if storage is unavailable.
	}
}

function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
	return [
		Math.round(left[0] * (1 - amount) + right[0] * amount),
		Math.round(left[1] * (1 - amount) + right[1] * amount),
		Math.round(left[2] * (1 - amount) + right[2] * amount)
	];
}

function token(rgb: Rgb): string {
	return `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
}

type BaseTokens = { [K in keyof typeof DARK_BASE_TOKENS]: Rgb };

/**
 * BASE_TOKENS with neutral picker overrides shadowed in — this is the pre-
 * softening base the overlay mixes toward SOFT_TARGETS. Overriding `foreground`
 * also drives `cardForeground` so body text stays a single color.
 */
export function effectiveBaseTokens(overrides: ColorOverrides, theme: ThemeMode): BaseTokens {
	const next = { ...BASE_TOKENS_BY_THEME[theme] } as BaseTokens;
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

export function styleVars(
	settings: StyleSettings,
	config: StyleSystemConfig
): CSSProperties {
	const asNeutral = (rgb: Rgb): string =>
		config.neutralTokenFormat === "hex" ? rgbToHex(rgb) : token(rgb);
	const { background, borders, font, icons } = settings.grain.softening;
	const backgroundMix = background * 0.1;
	const borderMix = borders * 0.16;
	const fontMix = font * 0.08;
	const bevelStrength = settings.grain.cssBevel.enabled ? settings.grain.cssBevel.strength : 0;
	const overrides = settings.colorOverrides;
	const BASE = effectiveBaseTokens(overrides, settings.theme);
	const SOFT_TARGETS = SOFT_TARGETS_BY_THEME[settings.theme];

	// Accent (trace-*/status) and editor tokens are not softened: emit the
	// override straight onto its CSS var so it wins over the styles.css :root
	// fallback. Untouched tokens are omitted, keeping the :root default live.
	const accentVars: Record<string, string> = {};
	for (const tokenDesc of COLOR_TOKENS) {
		if (tokenDesc.group === "neutrals") continue;
		const override = overrides[tokenDesc.id];
		if (!override) continue;
		accentVars[tokenDesc.cssVar] = colorTokenCssValue(tokenDesc, override);
	}

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
		...accentVars,
		...layoutVars,
		"--band-wash-opacity": String(settings.treeChrome.bandWashOpacity),
		"--band-border-opacity": String(settings.treeChrome.bandBorderOpacity),
		"--tree-caret-opacity": String(settings.treeChrome.caretOpacity),
		"--tree-connector-opacity": String(settings.treeChrome.connectorOpacity),
		"--selection-opacity": String(settings.selection.opacity),
		"--selection-width": `${settings.selection.ringWidth}px`,
		"--selection-bar-width": `${settings.selection.barWidth}px`,
		"--zebra-opacity": String(settings.codeBlock.zebraOpacity),
		"--background": asNeutral(mixRgb(BASE.background, SOFT_TARGETS.background, backgroundMix)),
		"--card": asNeutral(mixRgb(BASE.card, SOFT_TARGETS.card, backgroundMix)),
		"--card-foreground": asNeutral(mixRgb(BASE.cardForeground, SOFT_TARGETS.foreground, fontMix)),
		"--muted": asNeutral(mixRgb(BASE.muted, SOFT_TARGETS.muted, backgroundMix)),
		"--foreground": asNeutral(mixRgb(BASE.foreground, SOFT_TARGETS.foreground, fontMix)),
		"--muted-foreground": asNeutral(mixRgb(BASE.mutedForeground, SOFT_TARGETS.mutedForeground, fontMix)),
		"--border": asNeutral(mixRgb(BASE.border, SOFT_TARGETS.border, borderMix)),
		"--input": asNeutral(mixRgb(BASE.border, SOFT_TARGETS.border, borderMix)),
		// Hex hosts (Tailwind v4 @theme inline maps) also consume these
		// shadcn-style aliases; derive them so page chrome themes too.
		...(config.neutralTokenFormat === "hex"
			? {
					"--popover": asNeutral(mixRgb(BASE.card, SOFT_TARGETS.card, backgroundMix)),
					"--popover-foreground": asNeutral(mixRgb(BASE.cardForeground, SOFT_TARGETS.foreground, fontMix)),
					"--primary": asNeutral(mixRgb(BASE.foreground, SOFT_TARGETS.foreground, fontMix)),
					"--primary-foreground": asNeutral(mixRgb(BASE.background, SOFT_TARGETS.background, backgroundMix)),
					"--secondary": asNeutral(mixRgb(BASE.muted, SOFT_TARGETS.muted, backgroundMix)),
					"--secondary-foreground": asNeutral(mixRgb(BASE.foreground, SOFT_TARGETS.foreground, fontMix)),
				}
			: {}),
		"--trace-container": token(mixRgb(BASE.mutedForeground, SOFT_TARGETS.mutedForeground, fontMix)),
		"--status-neutral-fill": token(mixRgb(BASE.statusNeutralFill, SOFT_TARGETS.muted, backgroundMix)),
		"--status-neutral-border": token(mixRgb(BASE.statusNeutralBorder, SOFT_TARGETS.border, borderMix)),
		"--status-success-fill": token(mixRgb(BASE.statusSuccessFill, SOFT_TARGETS.statusSuccessFill, backgroundMix)),
		"--status-success-border": token(mixRgb(BASE.statusSuccessBorder, SOFT_TARGETS.statusSuccessBorder, borderMix)),
		"--status-warning-fill": token(mixRgb(BASE.statusWarningFill, SOFT_TARGETS.statusWarningFill, backgroundMix)),
		"--status-warning-border": token(mixRgb(BASE.statusWarningBorder, SOFT_TARGETS.statusWarningBorder, borderMix)),
		"--status-info-fill": token(mixRgb(BASE.statusInfoFill, SOFT_TARGETS.statusInfoFill, backgroundMix)),
		"--status-info-border": token(mixRgb(BASE.statusInfoBorder, SOFT_TARGETS.statusInfoBorder, borderMix)),
		"--agentprism-background": token(mixRgb(BASE.background, SOFT_TARGETS.background, backgroundMix)),
		"--agentprism-foreground": token(mixRgb(BASE.foreground, SOFT_TARGETS.foreground, fontMix)),
		"--agentprism-muted": token(mixRgb(BASE.agentPrismMuted, SOFT_TARGETS.muted, backgroundMix)),
		"--agentprism-muted-foreground": token(mixRgb(BASE.mutedForeground, SOFT_TARGETS.mutedForeground, fontMix)),
		"--agentprism-border-subtle": token(mixRgb(BASE.agentPrismBorder, SOFT_TARGETS.border, borderMix)),
		"--agentprism-code-base": token(mixRgb(BASE.agentPrismCodeBase, SOFT_TARGETS.mutedForeground, fontMix)),
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
 * Build a paste-ready CSS/TS block reflecting the EFFECTIVE base colors
 * (defaults + overrides, pre-softening). Two sections, each under a one-line
 * comment header saying where the lines belong:
 *   1. styles.css :root — every picker token as its CSS custom property.
 *   2. src/lib/style-settings.ts BASE_TOKENS — the neutral entries only
 *      (accents/editor tokens don't live in BASE_TOKENS).
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
		rootLines.push(`  ${tokenDesc.cssVar}: ${colorTokenCssValue(tokenDesc, hex)};`);
	}
	rootLines.push(`  --band-wash-opacity: ${treeChrome.bandWashOpacity};`);
	rootLines.push(`  --band-border-opacity: ${treeChrome.bandBorderOpacity};`);
	rootLines.push(`  --tree-caret-opacity: ${treeChrome.caretOpacity};`);
	rootLines.push(`  --tree-connector-opacity: ${treeChrome.connectorOpacity};`);
	rootLines.push(`  --selection-opacity: ${selection.opacity};`);
	rootLines.push(`  --selection-width: ${selection.ringWidth}px;`);
	rootLines.push(`  --selection-bar-width: ${selection.barWidth}px;`);
	rootLines.push(`  --zebra-opacity: ${codeBlock.zebraOpacity};`);

	const base = effectiveBaseTokens(overrides, theme);
	const baseLines: string[] = [];
	for (const tokenDesc of COLOR_TOKENS) {
		if (tokenDesc.group !== "neutrals" || !tokenDesc.baseTokenKey) continue;
		const rgb = base[tokenDesc.baseTokenKey];
		baseLines.push(`  ${tokenDesc.baseTokenKey}: [${rgb[0]}, ${rgb[1]}, ${rgb[2]}],`);
	}

	return [
		"/* → examples/simple-research-kernel/src/styles.css :root */",
		...rootLines,
		"",
		"/* → examples/simple-research-kernel/src/lib/style-settings.ts BASE_TOKENS */",
		...baseLines
	].join("\n");
}
