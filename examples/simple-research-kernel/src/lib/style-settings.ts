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

export interface TraceIconSettings {
	side: TraceIconSide;
	style: TraceIconStyle;
}

export interface ResearchStyleSettings {
	layout: LayoutStyleSettings;
	grain: GrainSettings;
	traceIcons: TraceIconSettings;
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

export const DEFAULT_RESEARCH_STYLE_SETTINGS: ResearchStyleSettings = {
	layout: DEFAULT_LAYOUT_STYLE_SETTINGS,
	grain: DEFAULT_GRAIN_SETTINGS,
	traceIcons: DEFAULT_TRACE_ICON_SETTINGS
};

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

export function normalizeResearchStyleSettings(input: ResearchStyleSettingsPatch | Record<string, unknown>): ResearchStyleSettings {
	const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
	return {
		layout: normalizeLayoutSettings(source.layout),
		grain: normalizeGrainSettings(
			source.grain && typeof source.grain === "object"
				? source.grain as Record<string, unknown>
				: {}
		),
		traceIcons: normalizeTraceIconSettings(source.traceIcons)
	};
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
		traceIcons: { ...current.traceIcons, ...(updates.traceIcons ?? {}) }
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

export function researchStyleVars(settings: ResearchStyleSettings): CSSProperties {
	const { background, borders, font, icons } = settings.grain.softening;
	const backgroundMix = background * 0.1;
	const borderMix = borders * 0.16;
	const fontMix = font * 0.08;
	const bevelStrength = settings.grain.cssBevel.enabled ? settings.grain.cssBevel.strength : 0;

	return {
		"--research-layout-padding": `${settings.layout.framePadding}px`,
		"--research-workspace-height": `calc(100vh - ${settings.layout.framePadding * 2}px)`,
		"--research-workspace-min-height": `${settings.layout.workspaceMinHeight}px`,
		"--research-header-height": `${settings.layout.headerHeight}px`,
		"--background": token(mixRgb(BASE_TOKENS.background, SOFT_TARGETS.background, backgroundMix)),
		"--card": token(mixRgb(BASE_TOKENS.card, SOFT_TARGETS.card, backgroundMix)),
		"--card-foreground": token(mixRgb(BASE_TOKENS.cardForeground, SOFT_TARGETS.foreground, fontMix)),
		"--muted": token(mixRgb(BASE_TOKENS.muted, SOFT_TARGETS.muted, backgroundMix)),
		"--foreground": token(mixRgb(BASE_TOKENS.foreground, SOFT_TARGETS.foreground, fontMix)),
		"--muted-foreground": token(mixRgb(BASE_TOKENS.mutedForeground, SOFT_TARGETS.mutedForeground, fontMix)),
		"--border": token(mixRgb(BASE_TOKENS.border, SOFT_TARGETS.border, borderMix)),
		"--input": token(mixRgb(BASE_TOKENS.border, SOFT_TARGETS.border, borderMix)),
		"--trace-container": token(mixRgb(BASE_TOKENS.mutedForeground, SOFT_TARGETS.mutedForeground, fontMix)),
		"--status-neutral-fill": token(mixRgb(BASE_TOKENS.statusNeutralFill, SOFT_TARGETS.muted, backgroundMix)),
		"--status-neutral-border": token(mixRgb(BASE_TOKENS.statusNeutralBorder, SOFT_TARGETS.border, borderMix)),
		"--status-success-fill": token(mixRgb(BASE_TOKENS.statusSuccessFill, SOFT_TARGETS.statusSuccessFill, backgroundMix)),
		"--status-success-border": token(mixRgb(BASE_TOKENS.statusSuccessBorder, SOFT_TARGETS.statusSuccessBorder, borderMix)),
		"--status-warning-fill": token(mixRgb(BASE_TOKENS.statusWarningFill, SOFT_TARGETS.statusWarningFill, backgroundMix)),
		"--status-warning-border": token(mixRgb(BASE_TOKENS.statusWarningBorder, SOFT_TARGETS.statusWarningBorder, borderMix)),
		"--status-info-fill": token(mixRgb(BASE_TOKENS.statusInfoFill, SOFT_TARGETS.statusInfoFill, backgroundMix)),
		"--status-info-border": token(mixRgb(BASE_TOKENS.statusInfoBorder, SOFT_TARGETS.statusInfoBorder, borderMix)),
		"--agentprism-background": token(mixRgb(BASE_TOKENS.background, SOFT_TARGETS.background, backgroundMix)),
		"--agentprism-foreground": token(mixRgb(BASE_TOKENS.foreground, SOFT_TARGETS.foreground, fontMix)),
		"--agentprism-muted": token(mixRgb(BASE_TOKENS.agentPrismMuted, SOFT_TARGETS.muted, backgroundMix)),
		"--agentprism-muted-foreground": token(mixRgb(BASE_TOKENS.mutedForeground, SOFT_TARGETS.mutedForeground, fontMix)),
		"--agentprism-border-subtle": token(mixRgb(BASE_TOKENS.agentPrismBorder, SOFT_TARGETS.border, borderMix)),
		"--agentprism-code-base": token(mixRgb(BASE_TOKENS.agentPrismCodeBase, SOFT_TARGETS.mutedForeground, fontMix)),
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
