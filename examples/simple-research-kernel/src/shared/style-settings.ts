/**
 * App binding for the SHARED viewer style system (@agent-kernel/viewer-shell).
 *
 * The machinery (settings model, palettes, panel, rail, overlay, emission)
 * lives in viewer-shell/src/style; this module pins the app's config —
 * unchanged storage keys so previously saved settings survive, light default
 * theme, triplet token format for the app's Tailwind v3 setup — and re-exports
 * the shared API under the names the app has always imported.
 */
import {
	defaultStyleSettings,
	loadStyleSettings,
	mergeStyleSettings,
	normalizeStyleSettings,
	saveStyleSettings,
	styleVars,
	type StyleSettings,
	type StyleSettingsPatch,
	type StyleSystemConfig
} from "@agent-kernel/viewer-shell";
import type { CSSProperties } from "react";

export * from "@agent-kernel/viewer-shell";

/** This app's style-system binding. Storage keys predate the extraction. */
export const RESEARCH_STYLE_CONFIG: StyleSystemConfig = {
	settingsStorageKey: "simpleResearchStyleSettings.v1",
	railCollapsedStorageKey: "simpleResearchStyleRailCollapsed",
	railWidthStorageKey: "simpleResearchStyleRailWidth",
	defaultTheme: "light",
	neutralTokenFormat: "triplet"
};

export type ResearchStyleSettings = StyleSettings;
export type ResearchStyleSettingsPatch = StyleSettingsPatch;

export const DEFAULT_RESEARCH_STYLE_SETTINGS: ResearchStyleSettings =
	defaultStyleSettings(RESEARCH_STYLE_CONFIG);

export function loadResearchStyleSettings(): ResearchStyleSettings {
	return loadStyleSettings(RESEARCH_STYLE_CONFIG);
}

export function saveResearchStyleSettings(settings: ResearchStyleSettings) {
	saveStyleSettings(RESEARCH_STYLE_CONFIG, settings);
}

export function mergeResearchStyleSettings(
	current: ResearchStyleSettings,
	updates: ResearchStyleSettingsPatch
): ResearchStyleSettings {
	return mergeStyleSettings(RESEARCH_STYLE_CONFIG, current, updates);
}

export function normalizeResearchStyleSettings(
	input: ResearchStyleSettingsPatch | Record<string, unknown>
): ResearchStyleSettings {
	return normalizeStyleSettings(input, RESEARCH_STYLE_CONFIG);
}

export function researchStyleVars(settings: ResearchStyleSettings): CSSProperties {
	return styleVars(settings, RESEARCH_STYLE_CONFIG);
}
