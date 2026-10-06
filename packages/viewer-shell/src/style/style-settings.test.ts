import { afterEach, describe, expect, test } from "bun:test";

import { clampStyleRailWidth, loadStyleRailWidth, saveStyleRailWidth } from "./rail-state";
import {
	buildColorExport,
	colorOverrideVars,
	colorTokenDefaultHex,
	colorTokenEffectiveHex,
	defaultStyleSettings,
	getColorToken,
	hexToRgb,
	hexToTriplet,
	hostColorHex,
	loadStyleSettings,
	mergeColorOverrides,
	mergeStyleSettings,
	normalizeColorOverrides,
	normalizeHex,
	normalizeStyleSettings,
	parseHostColor,
	rgbToHex,
	saveStyleSettings,
	SHOW_COLOR_CONTROLS,
	STYLE_PANEL_TAB_OPTIONS,
	styleSettingsStorageKey,
	styleVars,
	tripletToHex,
	effectiveBaseTokens,
	type StyleSystemConfig
} from "./style-settings";

/**
 * A host page for the engine's live-CSS reads: the contract values a host
 * gets from host-contract.css (light theme), triplets and hex as the sheet
 * writes them, plus one value that is not a plain color.
 */
const HOST_CSS: Record<string, string> = {
	"--background": " 253 253 253",
	"--foreground": "42 42 42",
	"--card": "248 248 247",
	"--card-foreground": "42 42 42",
	"--muted": "235 235 233",
	"--muted-foreground": "102 101 98",
	"--border": "230 229 227",
	"--trace-user": "11 110 153",
	"--trace-orchestration": "105 64 165",
	"--selection-color": "0 120 223",
	"--zebra-color": "31 31 31",
	"--editor-bg": "#f9f9f9",
	"--editor-fg": "rgb(31, 31, 31)",
	"--editor-line-number": "color-mix(in srgb, #9b9a97 65%, #666562)"
};

const realDocument = (globalThis as { document?: unknown }).document;
const realGetComputedStyle = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;

/** Install a fake document whose root computes to HOST_CSS; returns the restore. */
function stubHostCss(values: Record<string, string> = HOST_CSS): () => void {
	const root = { tagName: "HTML" };
	(globalThis as { document?: unknown }).document = { documentElement: root };
	(globalThis as { getComputedStyle?: unknown }).getComputedStyle = (element: unknown) => ({
		getPropertyValue: (name: string) => (element === root ? values[name] ?? "" : "")
	});
	return () => {
		(globalThis as { document?: unknown }).document = realDocument;
		(globalThis as { getComputedStyle?: unknown }).getComputedStyle = realGetComputedStyle;
	};
}

/** Every color variable the engine used to write inline on the style shell. */
const CONTRACT_COLOR_VARS = [
	"--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
	"--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted",
	"--muted-foreground", "--border", "--input", "--destructive", "--trace-container", "--trace-orchestration",
	"--trace-user", "--trace-assistant", "--trace-tool", "--trace-lifecycle", "--status-warning",
	"--status-neutral-fill", "--status-neutral-border", "--status-success-fill", "--status-success-border",
	"--status-warning-fill", "--status-warning-border", "--status-info-fill", "--status-info-border",
	"--agentprism-background", "--agentprism-foreground", "--agentprism-muted", "--agentprism-muted-foreground",
	"--agentprism-border-subtle", "--agentprism-code-base", "--editor-bg", "--editor-fg", "--editor-line-number",
	"--tree-caret", "--tree-connector", "--selection-color", "--zebra-color"
];

/** A light-default app binding matching the example app's shape. */
const LIGHT_CONFIG: StyleSystemConfig = {
	settingsStorageKey: "testAppLight.settings",
	railCollapsedStorageKey: "testAppLight.railCollapsed",
	railWidthStorageKey: "testAppLight.railWidth",
	defaultTheme: "light",
	neutralTokenFormat: "triplet"
};

/** A dark-default hex-format binding matching the canvas viewer's shape. */
const DARK_CONFIG: StyleSystemConfig = {
	settingsStorageKey: "testAppDark.settings",
	railCollapsedStorageKey: "testAppDark.railCollapsed",
	railWidthStorageKey: "testAppDark.railWidth",
	defaultTheme: "dark",
	neutralTokenFormat: "hex"
};

const normalize = (input: Record<string, unknown>) => normalizeStyleSettings(input, LIGHT_CONFIG);
const merge = mergeStyleSettings.bind(null, LIGHT_CONFIG);
const DEFAULTS = defaultStyleSettings(LIGHT_CONFIG);

describe("hex / triplet utilities", () => {
	test("round-trips and normalizes", () => {
		expect(rgbToHex([27, 27, 28])).toBe("#1B1B1C");
		expect(hexToRgb("#1B1B1C")).toEqual([27, 27, 28]);
		expect(hexToRgb("abc")).toEqual([170, 187, 204]);
		expect(hexToRgb("nope")).toBeNull();
		expect(normalizeHex("#abc")).toBe("#AABBCC");
		expect(normalizeHex("zzz")).toBeNull();
		expect(tripletToHex("  168   168  168 ")).toBe("#A8A8A8");
		expect(tripletToHex("27 27")).toBeNull();
		expect(hexToTriplet("#1B1B1C")).toBe("27 27 28");
		expect(hexToTriplet("nope")).toBeNull();
	});
});

describe("host color reads", () => {
	test("parseHostColor reads triplets, hex and rgb(), and nothing else", () => {
		expect(parseHostColor(" 27 27 28")).toBe("#1B1B1C");
		expect(parseHostColor("27 27 28 / 0.5")).toBe("#1B1B1C");
		expect(parseHostColor("#abc")).toBe("#AABBCC");
		expect(parseHostColor("rgb(31, 31, 31)")).toBe("#1F1F1F");
		expect(parseHostColor("rgba(31, 31, 31, 0.5)")).toBe("#1F1F1F");
		expect(parseHostColor("rgb(31 31 31 / 50%)")).toBe("#1F1F1F");
		expect(parseHostColor("color-mix(in srgb, #9b9a97 65%, #666562)")).toBeNull();
		expect(parseHostColor("var(--x)")).toBeNull();
		expect(parseHostColor("")).toBeNull();
		expect(parseHostColor("27 27")).toBeNull();
	});

	test("hostColorHex reads the document root, and nothing without a DOM", () => {
		expect(hostColorHex("--background")).toBeNull();
		const restore = stubHostCss();
		try {
			expect(hostColorHex("--background")).toBe("#FDFDFD");
			expect(hostColorHex("--editor-bg")).toBe("#F9F9F9");
			expect(hostColorHex("--editor-line-number")).toBeNull();
			expect(hostColorHex("--not-declared")).toBeNull();
		} finally {
			restore();
		}
	});
});

describe("color token catalog", () => {
	test("a token's default is the host's live contract value, empty when unreadable", () => {
		const background = getColorToken("background")!;
		const editorFg = getColorToken("editorFg")!;
		const traceTool = getColorToken("traceTool")!;
		expect(colorTokenDefaultHex(background, "light")).toBe("");
		const restore = stubHostCss();
		try {
			expect(colorTokenDefaultHex(background, "light")).toBe("#FDFDFD");
			expect(colorTokenDefaultHex(editorFg, "light")).toBe("#1F1F1F");
			expect(colorTokenDefaultHex(getColorToken("traceUser")!, "light")).toBe("#0B6E99");
			// Not declared by this host page: no default.
			expect(colorTokenDefaultHex(traceTool, "light")).toBe("");
		} finally {
			restore();
		}
	});

	test("effective hex prefers a valid override, ignores a bad one", () => {
		const background = getColorToken("background")!;
		const restore = stubHostCss();
		try {
			expect(colorTokenEffectiveHex(background, { background: "#123456" }, "dark")).toBe("#123456");
			expect(colorTokenEffectiveHex(background, { background: "nope" }, "dark")).toBe("#FDFDFD");
			expect(colorTokenEffectiveHex(background, {}, "dark")).toBe("#FDFDFD");
		} finally {
			restore();
		}
	});

	test("the color controls are hidden: the colors tab is the Theme tab", () => {
		expect(SHOW_COLOR_CONTROLS).toBe(false);
		expect(STYLE_PANEL_TAB_OPTIONS.find((option) => option.id === "colors")?.label).toBe("Theme");
	});
});

describe("normalizeColorOverrides / mergeColorOverrides", () => {
	test("keeps known ids with canonical hex, drops the rest", () => {
		const result = normalizeColorOverrides({
			background: "#abc",
			bogusToken: "#ffffff",
			foreground: "not-a-color",
			traceUser: "60a5fa"
		});
		expect(result).toEqual({ background: "#AABBCC", traceUser: "#60A5FA" });
		expect(normalizeColorOverrides(null)).toEqual({});
	});

	test("merge semantics: null clears, empty string removes one, entries fold in", () => {
		expect(mergeColorOverrides({ background: "#111111" }, null)).toEqual({});
		const current = { background: "#111111" };
		expect(mergeColorOverrides(current, undefined)).toBe(current);
		expect(
			mergeColorOverrides({ background: "#111111", foreground: "#222222" }, { background: "" })
		).toEqual({ foreground: "#222222" });
		expect(mergeColorOverrides({ background: "#111111" }, { foreground: "#222222" })).toEqual({
			background: "#111111",
			foreground: "#222222"
		});
	});
});

describe("normalize / merge settings", () => {
	test("normalize fills defaults for missing fields", () => {
		const normalized = normalize({});
		expect(normalized.colorOverrides).toEqual({});
		expect(normalized.activeTab).toBe("colors");
		expect(normalize({ activeTab: "nonsense" }).activeTab).toBe("colors");
	});

	test("treeChrome normalizes with clamped defaults and merges patches", () => {
		expect(normalize({}).treeChrome).toEqual({
			bandWashOpacity: 0.1,
			bandBorderOpacity: 0.45,
			caretOpacity: 1,
			connectorOpacity: 0.8
		});
		expect(normalize({ treeChrome: { bandWashOpacity: 9, caretOpacity: 0 } }).treeChrome).toEqual({
			bandWashOpacity: 0.25,
			bandBorderOpacity: 0.45,
			caretOpacity: 0.2,
			connectorOpacity: 0.8
		});
		const merged = merge(DEFAULTS, { treeChrome: { bandWashOpacity: 0.05 } });
		expect(merged.treeChrome.bandWashOpacity).toBe(0.05);
		expect(merged.treeChrome.connectorOpacity).toBe(0.8);
		const vars = styleVars(merged, LIGHT_CONFIG) as Record<string, string>;
		expect(vars["--band-wash-opacity"]).toBe("0.05");
		expect(vars["--tree-connector-opacity"]).toBe("0.8");
	});

	test("selection controls normalize, clamp, merge, emit, and export", () => {
		expect(normalize({}).selection).toEqual({ opacity: 1, ringWidth: 2, barWidth: 3 });
		expect(normalize({ selection: { opacity: 0, ringWidth: 99, barWidth: -2 } }).selection).toEqual({
			opacity: 0.2,
			ringWidth: 4,
			barWidth: 0
		});
		const merged = merge(DEFAULTS, { selection: { ringWidth: 3 } });
		expect(merged.selection).toEqual({ opacity: 1, ringWidth: 3, barWidth: 3 });
		const vars = styleVars(merged, LIGHT_CONFIG) as Record<string, string>;
		expect(vars["--selection-opacity"]).toBe("1");
		expect(vars["--selection-width"]).toBe("3px");
		expect(vars["--selection-bar-width"]).toBe("3px");
		// Export carries the host's color + the sliders.
		const restore = stubHostCss();
		try {
			const out = buildColorExport({}, "light", undefined, merged.selection);
			expect(out).toContain("--selection-color: 0 120 223;");
			expect(out).toContain("--selection-width: 3px;");
			expect(out).toContain("--selection-bar-width: 3px;");
		} finally {
			restore();
		}
	});

	test("code-block zebra normalizes, clamps, merges, emits, and exports", () => {
		expect(normalize({}).codeBlock).toEqual({ zebraOpacity: 0.04 });
		expect(normalize({ codeBlock: { zebraOpacity: 9 } }).codeBlock.zebraOpacity).toBe(0.15);
		expect(normalize({ codeBlock: { zebraOpacity: -1 } }).codeBlock.zebraOpacity).toBe(0);
		const merged = merge(DEFAULTS, { codeBlock: { zebraOpacity: 0.1 } });
		expect(merged.codeBlock.zebraOpacity).toBe(0.1);
		const vars = styleVars(merged, LIGHT_CONFIG) as Record<string, string>;
		expect(vars["--zebra-opacity"]).toBe("0.1");
		// Export carries the host's color (or an override) + the slider.
		const restore = stubHostCss();
		try {
			const out = buildColorExport({}, "dark", undefined, undefined, merged.codeBlock);
			expect(out).toContain("--zebra-color: 31 31 31;");
			expect(out).toContain("--zebra-opacity: 0.1;");
			expect(buildColorExport({ zebraColor: "#ffffff" }, "dark")).toContain("--zebra-color: 255 255 255;");
		} finally {
			restore();
		}
	});

	test("theme follows the app default and rejects unknown values", () => {
		expect(normalize({}).theme).toBe("light");
		expect(normalizeStyleSettings({}, DARK_CONFIG).theme).toBe("dark");
		expect(normalize({ theme: "dark" }).theme).toBe("dark");
		expect(normalize({ theme: "sepia" }).theme).toBe("light");
		expect(merge(DEFAULTS, { theme: "dark" }).theme).toBe("dark");
	});

	test("merge folds a colorOverrides patch and persists the active tab", () => {
		const merged = merge(DEFAULTS, {
			colorOverrides: { background: "#101010" },
			activeTab: "effects"
		});
		expect(merged.colorOverrides).toEqual({ background: "#101010" });
		expect(merged.activeTab).toBe("effects");
		const cleared = merge(merged, { colorOverrides: null });
		expect(cleared.colorOverrides).toEqual({});
		expect(cleared.activeTab).toBe("effects");
	});
});

describe("no inline colors", () => {
	test("styleVars writes no contract color, whatever the saved overrides", () => {
		const overridden = merge(DEFAULTS, {
			theme: "dark",
			colorOverrides: { background: "#000000", foreground: "#ffffff", traceUser: "#60A5FA", editorBg: "#101010" }
		});
		for (const config of [LIGHT_CONFIG, DARK_CONFIG]) {
			for (const settings of [defaultStyleSettings(config), overridden]) {
				const vars = styleVars(settings, config) as Record<string, string>;
				for (const name of CONTRACT_COLOR_VARS) expect(vars[name]).toBeUndefined();
			}
		}
	});

	test("the remaining emission is knobs only: opacities, widths, effects, layout", () => {
		const vars = styleVars(DEFAULTS, LIGHT_CONFIG) as Record<string, string>;
		for (const value of Object.values(vars)) {
			expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|^\d+ \d+ \d+$/i);
		}
		expect(vars["--zebra-opacity"]).toBe("0.04");
	});
});

describe("color overrides (code kept behind SHOW_COLOR_CONTROLS)", () => {
	test("viewer-only and editor overrides go onto their own variable; untouched ones stay unset", () => {
		const vars = colorOverrideVars({ traceUser: "#60A5FA", editorBg: "#101010" }, LIGHT_CONFIG);
		expect(vars).toEqual({ "--trace-user": "96 165 250", "--editor-bg": "#101010" });
		expect(colorOverrideVars({ traceUser: "nope" }, LIGHT_CONFIG)).toEqual({});
	});

	test("a neutral override drives its followers, in the host's format", () => {
		expect(colorOverrideVars({ foreground: "#ffffff", border: "#3a3a3b" }, LIGHT_CONFIG)).toEqual({
			"--foreground": "255 255 255",
			"--card-foreground": "255 255 255",
			"--agentprism-foreground": "255 255 255",
			"--border": "58 58 59",
			"--input": "58 58 59"
		});
		const hex = colorOverrideVars({ background: "#1b1b1c", card: "#252526" }, DARK_CONFIG);
		expect(hex).toEqual({
			"--background": "#1B1B1C",
			"--agentprism-background": "27 27 28",
			"--primary-foreground": "#1B1B1C",
			"--card": "#252526",
			"--popover": "#252526"
		});
	});

	test("effectiveBaseTokens reads the host and shadows neutral overrides", () => {
		const restore = stubHostCss();
		try {
			const base = effectiveBaseTokens({ background: "#000000", foreground: "#ffffff" }, "light");
			expect(base.background).toEqual([0, 0, 0]);
			expect(base.foreground).toEqual([255, 255, 255]);
			expect(base.cardForeground).toEqual([255, 255, 255]);
			expect(base.card).toEqual([248, 248, 247]);
			expect(base.border).toEqual([230, 229, 227]);
		} finally {
			restore();
		}
	});
});

describe("scale neutrality", () => {
	test("hosts without the LAYOUT section get no layout geometry vars", () => {
		const vars = styleVars(defaultStyleSettings(DARK_CONFIG), {
			...DARK_CONFIG,
			sections: ["colors", "effects", "trace"]
		}) as Record<string, string>;
		expect(vars["--research-layout-padding"]).toBeUndefined();
		expect(vars["--research-workspace-height"]).toBeUndefined();
		expect(vars["--research-header-height"]).toBeUndefined();
		// Chrome/color vars still flow.
		expect(vars["--band-wash-opacity"]).toBe("0.1");
	});

	test("hosts with LAYOUT (or all sections) still get the geometry vars", () => {
		const all = styleVars(DEFAULTS, LIGHT_CONFIG) as Record<string, string>;
		expect(all["--research-header-height"]).toBe("72px");
		const explicit = styleVars(DEFAULTS, {
			...LIGHT_CONFIG,
			sections: ["colors", "layout"]
		}) as Record<string, string>;
		expect(explicit["--research-layout-padding"]).toBe("16px");
	});

	test("the emission never contains sizing-context properties", () => {
		for (const config of [LIGHT_CONFIG, DARK_CONFIG]) {
			const vars = styleVars(defaultStyleSettings(config), config) as Record<string, string>;
			for (const key of Object.keys(vars)) {
				expect(key.startsWith("--")).toBe(true); // custom properties only
				expect(key).not.toMatch(/font-size|zoom|transform|scale/i);
			}
		}
	});
});

describe("buildColorExport", () => {
	test("prints the host's effective values with overrides, and skips unreadable ones", () => {
		const restore = stubHostCss();
		try {
			const out = buildColorExport({ background: "#000000", traceUser: "#123456" }, "light");
			expect(out).toContain("host-contract.css");
			expect(out).toContain("--background: 0 0 0;");
			expect(out).toContain("--trace-user: 18 52 86;");
			expect(out).toContain("--card: 248 248 247;");
			expect(out).toContain("--editor-bg: #F9F9F9;");
			expect(out).not.toContain("--editor-line-number:");
			expect(out).not.toContain("--trace-tool:");
			expect(out).toContain("--band-wash-opacity: 0.1;");
		} finally {
			restore();
		}
	});

	test("without a DOM only overrides and knobs are printed", () => {
		const out = buildColorExport({ traceUser: "#123456" }, "dark");
		expect(out).toContain("--trace-user: 18 52 86;");
		expect(out).not.toContain("--background:");
		expect(out).toContain("--tree-connector-opacity: 0.8;");
	});
});

describe("per-app config isolation", () => {
	const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

	afterEach(() => {
		(globalThis as { localStorage?: unknown }).localStorage = realLocalStorage;
	});

	function stubStorage(): Map<string, string> {
		const store = new Map<string, string>();
		(globalThis as { localStorage?: unknown }).localStorage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
			removeItem: (key: string) => void store.delete(key)
		};
		return store;
	}

	test("the settings key is the app's key with its version raised by one", () => {
		expect(styleSettingsStorageKey(LIGHT_CONFIG)).toBe("testAppLight.settings.v2");
		const key = (settingsStorageKey: string) => styleSettingsStorageKey({ ...LIGHT_CONFIG, settingsStorageKey });
		expect(key("simpleResearchStyleSettings.v1")).toBe("simpleResearchStyleSettings.v2");
		expect(key("canvasAgentViewerStyle.v1")).toBe("canvasAgentViewerStyle.v2");
		expect(key("observatory.viewerStyle.v1")).toBe("observatory.viewerStyle.v2");
		expect(key("app.style.v9")).toBe("app.style.v10");
	});

	test("two apps: different storage keys and default themes, no bleed", () => {
		const store = stubStorage();

		// Fresh installs: each app gets ITS default theme.
		expect(loadStyleSettings(LIGHT_CONFIG).theme).toBe("light");
		expect(loadStyleSettings(DARK_CONFIG).theme).toBe("dark");

		// App A saves a customized state…
		saveStyleSettings(
			LIGHT_CONFIG,
			mergeStyleSettings(LIGHT_CONFIG, defaultStyleSettings(LIGHT_CONFIG), {
				theme: "dark",
				colorOverrides: { traceUser: "#123456" }
			})
		);
		expect(store.has("testAppLight.settings.v2")).toBe(true);
		expect(store.has("testAppLight.settings")).toBe(false);
		expect(store.has("testAppDark.settings.v2")).toBe(false);

		// …app B still loads ITS untouched defaults.
		expect(loadStyleSettings(DARK_CONFIG).theme).toBe("dark");
		expect(loadStyleSettings(DARK_CONFIG).colorOverrides).toEqual({});
		// And app A round-trips its own save.
		const reloaded = loadStyleSettings(LIGHT_CONFIG);
		expect(reloaded.theme).toBe("dark");
		expect(reloaded.colorOverrides).toEqual({ traceUser: "#123456" });
	});

	test("first load after the key raise keeps the non-color settings and drops the saved colors", () => {
		const store = stubStorage();
		// A blob saved under the app's own key before the raise (Ford's saved
		// settings): a theme, effects, a tab and a picked color.
		const legacy = JSON.stringify({
			theme: "dark",
			grain: { enabled: false, opacity: 0.2 },
			selection: { ringWidth: 3 },
			colorOverrides: { background: "#000000", traceUser: "#60A5FA" },
			activeTab: "effects"
		});
		localStorage.setItem(LIGHT_CONFIG.settingsStorageKey, legacy);
		const loaded = loadStyleSettings(LIGHT_CONFIG);
		expect(loaded.theme).toBe("dark");
		expect(loaded.grain.enabled).toBe(false);
		expect(loaded.grain.opacity).toBe(0.2);
		expect(loaded.selection.ringWidth).toBe(3);
		expect(loaded.activeTab).toBe("effects");
		expect(loaded.colorOverrides).toEqual({});
		// The old blob is never deleted or rewritten.
		expect(store.get(LIGHT_CONFIG.settingsStorageKey)).toBe(legacy);

		// Once the new key holds a blob, the old one is not read again.
		saveStyleSettings(LIGHT_CONFIG, { ...loaded, theme: "light" });
		expect(loadStyleSettings(LIGHT_CONFIG).theme).toBe("light");
		expect(store.get(LIGHT_CONFIG.settingsStorageKey)).toBe(legacy);
	});

	test("a pre-theme legacy blob adopts the app's default theme (old saves survive)", () => {
		stubStorage();
		// A blob written before the theme field existed: it loads with the app
		// default, keeping its other non-color fields.
		localStorage.setItem(
			LIGHT_CONFIG.settingsStorageKey,
			JSON.stringify({ colorOverrides: { traceUser: "#60A5FA" }, activeTab: "effects" })
		);
		const loaded = loadStyleSettings(LIGHT_CONFIG);
		expect(loaded.theme).toBe("light");
		expect(loaded.activeTab).toBe("effects");
		expect(loaded.colorOverrides).toEqual({});
		// The same blob under the canvas config would adopt dark.
		localStorage.setItem(DARK_CONFIG.settingsStorageKey, JSON.stringify({ activeTab: "trace" }));
		expect(loadStyleSettings(DARK_CONFIG).theme).toBe("dark");
		// A malformed old blob falls back to the defaults.
		localStorage.setItem(DARK_CONFIG.settingsStorageKey, "not json");
		expect(loadStyleSettings(DARK_CONFIG)).toEqual(defaultStyleSettings(DARK_CONFIG));
	});

	test("rail state is config-keyed", () => {
		const store = stubStorage();
		expect(clampStyleRailWidth(9999)).toBe(560);
		saveStyleRailWidth(LIGHT_CONFIG, 400);
		expect(store.get("testAppLight.railWidth")).toBe("400");
		expect(loadStyleRailWidth(DARK_CONFIG)).toBe(380); // untouched default
		expect(loadStyleRailWidth(LIGHT_CONFIG)).toBe(400);
	});
});
