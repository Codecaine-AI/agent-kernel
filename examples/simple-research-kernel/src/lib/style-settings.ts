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

export type StylePanelTab = "colors" | "effects" | "trace" | "layout";

export interface TraceIconSettings {
	side: TraceIconSide;
	style: TraceIconStyle;
}

export type ColorTokenFormat = "triplet" | "hex";
export type ColorTokenGroup = "neutrals" | "editor" | "accents";

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
	baseTokenKey?: keyof typeof BASE_TOKENS;
	reserved?: boolean;
	reservedNote?: string;
}

/** Per-token hex overrides ("#RRGGBB"), keyed by ColorTokenDescriptor.id. */
export type ColorOverrides = Record<string, string>;

export interface ResearchStyleSettings {
	layout: LayoutStyleSettings;
	grain: GrainSettings;
	traceIcons: TraceIconSettings;
	colorOverrides: ColorOverrides;
	activeTab: StylePanelTab;
}

export type GrainSettingsPatch = Omit<Partial<GrainSettings>, "softening" | "svgNormal" | "cssBevel"> & {
	softening?: Partial<SofteningSettings>;
	svgNormal?: Partial<SvgNormalSettings>;
	cssBevel?: Partial<CssBevelSettings>;
};

export interface ResearchStyleSettingsPatch {
	layout?: Partial<LayoutStyleSettings>;
	grain?: GrainSettingsPatch;
	traceIcons?: Partial<TraceIconSettings>;
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

export const DEFAULT_STYLE_PANEL_TAB: StylePanelTab = "colors";

export const DEFAULT_COLOR_OVERRIDES: ColorOverrides = {};

export const DEFAULT_RESEARCH_STYLE_SETTINGS: ResearchStyleSettings = {
	layout: DEFAULT_LAYOUT_STYLE_SETTINGS,
	grain: DEFAULT_GRAIN_SETTINGS,
	traceIcons: DEFAULT_TRACE_ICON_SETTINGS,
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

const STYLE_SETTINGS_KEY = "simpleResearchStyleSettings.v1";

// Neutral gray ladder anchored on VS Code Dark+ (#252526 raised surface),
// cohesive with the #1E1E1E editor buffer. Warm-neutral, no blue cast. These
// are the RUNTIME source of truth for the neutral palette — the style overlay
// inlines them onto .research-style-shell, shadowing the styles.css :root
// fallbacks. Keep them in lockstep with styles.css.
const BASE_TOKENS = {
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

// Softening targets: lighter, warm-neutral variants the base grays mix toward
// as the softening sliders rise. Stay on the same neutral family (no blue cast).
const SOFT_TARGETS = {
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

// ── Color picker layer ────────────────────────────────────────────────────
// Accent/status color tokens live only in styles.css :root today (not in
// BASE_TOKENS, and not emitted by researchStyleVars). We mirror their default
// RGB triplets here so the overlay can emit user overrides on top and the
// export builder can print the effective :root lines. These are NOT softened.
const ACCENT_DEFAULTS = {
	traceOrchestration: [167, 139, 250] as Rgb, // #A78BFA
	traceUser: [96, 165, 250] as Rgb,           // #60A5FA
	traceAssistant: [84, 214, 147] as Rgb,      // #54D693
	traceTool: [84, 211, 224] as Rgb,           // #54D3E0
	traceLifecycle: [168, 168, 168] as Rgb,     // #A8A8A8
	statusWarning: [220, 167, 76] as Rgb,       // #DCA74C
	statusError: [225, 91, 88] as Rgb           // #E15B58 (--destructive)
} satisfies Record<string, Rgb>;

// Literal-hex editor defaults (consumed via var(--editor-*, fallback)).
const EDITOR_DEFAULTS = {
	editorBg: "#1e1e1e",
	editorFg: "#d4d4d4",
	editorLineNumber: "#858585"
} satisfies Record<string, string>;

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
	{ id: "statusError", label: "Error", group: "accents", format: "triplet", cssVar: "--destructive", reserved: true, reservedNote: "reserved · diagnostics" }
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

/** The shipped default color for a token, as canonical `#RRGGBB` hex. */
export function colorTokenDefaultHex(token: ColorTokenDescriptor): string {
	if (token.format === "hex") {
		return normalizeHex(EDITOR_DEFAULTS[token.id as keyof typeof EDITOR_DEFAULTS]) ?? "#000000";
	}
	if (token.baseTokenKey) {
		return rgbToHex(BASE_TOKENS[token.baseTokenKey]);
	}
	return rgbToHex(ACCENT_DEFAULTS[token.id as keyof typeof ACCENT_DEFAULTS]);
}

/** The effective (override-or-default) color for a token, as `#RRGGBB` hex. */
export function colorTokenEffectiveHex(token: ColorTokenDescriptor, overrides: ColorOverrides): string {
	const override = overrides[token.id];
	if (override) {
		const normalized = normalizeHex(override);
		if (normalized) return normalized;
	}
	return colorTokenDefaultHex(token);
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

export function normalizeResearchStyleSettings(input: ResearchStyleSettingsPatch | Record<string, unknown>): ResearchStyleSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		layout: normalizeLayoutSettings(source.layout),
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

export function mergeResearchStyleSettings(
	current: ResearchStyleSettings,
	updates: ResearchStyleSettingsPatch
): ResearchStyleSettings {
	return normalizeResearchStyleSettings({
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
		colorOverrides:
			"colorOverrides" in updates
				? mergeColorOverrides(current.colorOverrides, updates.colorOverrides)
				: current.colorOverrides,
		activeTab: updates.activeTab ?? current.activeTab
	});
}

export function loadResearchStyleSettings(): ResearchStyleSettings {
	try {
		const raw = localStorage.getItem(STYLE_SETTINGS_KEY);
		if (!raw) return DEFAULT_RESEARCH_STYLE_SETTINGS;
		return normalizeResearchStyleSettings(JSON.parse(raw) as Record<string, unknown>);
	} catch {
		return DEFAULT_RESEARCH_STYLE_SETTINGS;
	}
}

export function saveResearchStyleSettings(settings: ResearchStyleSettings) {
	try {
		localStorage.setItem(STYLE_SETTINGS_KEY, JSON.stringify(settings));
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

type BaseTokens = { [K in keyof typeof BASE_TOKENS]: Rgb };

/**
 * BASE_TOKENS with neutral picker overrides shadowed in — this is the pre-
 * softening base the overlay mixes toward SOFT_TARGETS. Overriding `foreground`
 * also drives `cardForeground` so body text stays a single color.
 */
export function effectiveBaseTokens(overrides: ColorOverrides): BaseTokens {
	const next = { ...BASE_TOKENS } as BaseTokens;
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

export function researchStyleVars(settings: ResearchStyleSettings): CSSProperties {
	const { background, borders, font, icons } = settings.grain.softening;
	const backgroundMix = background * 0.1;
	const borderMix = borders * 0.16;
	const fontMix = font * 0.08;
	const bevelStrength = settings.grain.cssBevel.enabled ? settings.grain.cssBevel.strength : 0;
	const overrides = settings.colorOverrides;
	const BASE = effectiveBaseTokens(overrides);

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

	return {
		...accentVars,
		"--research-layout-padding": `${settings.layout.framePadding}px`,
		"--research-workspace-height": `calc(100vh - ${settings.layout.framePadding * 2}px)`,
		"--research-workspace-min-height": `${settings.layout.workspaceMinHeight}px`,
		"--research-header-height": `${settings.layout.headerHeight}px`,
		"--background": token(mixRgb(BASE.background, SOFT_TARGETS.background, backgroundMix)),
		"--card": token(mixRgb(BASE.card, SOFT_TARGETS.card, backgroundMix)),
		"--card-foreground": token(mixRgb(BASE.cardForeground, SOFT_TARGETS.foreground, fontMix)),
		"--muted": token(mixRgb(BASE.muted, SOFT_TARGETS.muted, backgroundMix)),
		"--foreground": token(mixRgb(BASE.foreground, SOFT_TARGETS.foreground, fontMix)),
		"--muted-foreground": token(mixRgb(BASE.mutedForeground, SOFT_TARGETS.mutedForeground, fontMix)),
		"--border": token(mixRgb(BASE.border, SOFT_TARGETS.border, borderMix)),
		"--input": token(mixRgb(BASE.border, SOFT_TARGETS.border, borderMix)),
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

export function styleEffectClass(settings: ResearchStyleSettings): string {
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
export function buildColorExport(overrides: ColorOverrides): string {
	const rootLines: string[] = [];
	for (const tokenDesc of COLOR_TOKENS) {
		const hex = colorTokenEffectiveHex(tokenDesc, overrides);
		rootLines.push(`  ${tokenDesc.cssVar}: ${colorTokenCssValue(tokenDesc, hex)};`);
	}

	const base = effectiveBaseTokens(overrides);
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
