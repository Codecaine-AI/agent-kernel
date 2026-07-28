import { afterEach, describe, expect, test } from "bun:test";

import { clampStyleRailWidth, loadStyleRailWidth, saveStyleRailWidth } from "./rail-state";
import {
	buildColorExport,
	colorTokenDefaultHex,
	colorTokenEffectiveHex,
	defaultStyleSettings,
	getColorToken,
	hexToRgb,
	hexToTriplet,
	loadStyleSettings,
	mergeColorOverrides,
	mergeStyleSettings,
	normalizeColorOverrides,
	normalizeHex,
	normalizeStyleSettings,
	rgbToHex,
	saveStyleSettings,
	styleVars,
	tripletToHex,
	effectiveBaseTokens,
	type StyleSystemConfig
} from "./style-settings";

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

describe("color token catalog", () => {
	test("neutral default hex derives from the theme's base tokens", () => {
		const background = getColorToken("background");
		expect(background).toBeDefined();
		expect(colorTokenDefaultHex(background!, "dark")).toBe("#1B1B1C");
		expect(colorTokenDefaultHex(background!, "light")).toBe("#F9F9F7");
	});

	test("editor default hex derives from literal editor defaults", () => {
		const editorBg = getColorToken("editorBg");
		expect(colorTokenDefaultHex(editorBg!, "dark")).toBe("#1E1E1E");
		expect(colorTokenDefaultHex(editorBg!, "light")).toBe("#FBFBF9");
	});

	test("accent default hex derives from the theme's accent defaults", () => {
		const orchestration = getColorToken("traceOrchestration");
		expect(colorTokenDefaultHex(orchestration!, "dark")).toBe("#A78BFA");
		expect(colorTokenDefaultHex(orchestration!, "light")).toBe("#7C3AED");
		// Tool is ORANGE in both themes (cyan is retired for tools).
		const tool = getColorToken("traceTool");
		expect(colorTokenDefaultHex(tool!, "dark")).toBe("#E8823D");
		expect(colorTokenDefaultHex(tool!, "light")).toBe("#C2410C");
	});

	test("effective hex prefers a valid override, ignores a bad one", () => {
		const background = getColorToken("background")!;
		expect(colorTokenEffectiveHex(background, { background: "#123456" }, "dark")).toBe("#123456");
		expect(colorTokenEffectiveHex(background, { background: "nope" }, "dark")).toBe("#1B1B1C");
		expect(colorTokenEffectiveHex(background, {}, "dark")).toBe("#1B1B1C");
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
		// Color token: theme-keyed defaults (light doc blue / dark HUD cyan).
		const color = getColorToken("selectionColor");
		expect(colorTokenDefaultHex(color!, "light")).toBe("#2A78D6");
		expect(colorTokenDefaultHex(color!, "dark")).toBe("#54D3E0");
		// Export carries color + sliders.
		const out = buildColorExport({}, "light", undefined, merged.selection);
		expect(out).toContain("--selection-color: 42 120 214;");
		expect(out).toContain("--selection-width: 3px;");
		expect(out).toContain("--selection-bar-width: 3px;");
	});

	test("code-block zebra normalizes, clamps, merges, emits, and exports", () => {
		expect(normalize({}).codeBlock).toEqual({ zebraOpacity: 0.04 });
		expect(normalize({ codeBlock: { zebraOpacity: 9 } }).codeBlock.zebraOpacity).toBe(0.15);
		expect(normalize({ codeBlock: { zebraOpacity: -1 } }).codeBlock.zebraOpacity).toBe(0);
		const merged = merge(DEFAULTS, { codeBlock: { zebraOpacity: 0.1 } });
		expect(merged.codeBlock.zebraOpacity).toBe(0.1);
		const vars = styleVars(merged, LIGHT_CONFIG) as Record<string, string>;
		expect(vars["--zebra-opacity"]).toBe("0.1");
		// Color token: theme-keyed defaults (ink on paper / light on the void).
		const zebra = getColorToken("zebraColor");
		expect(colorTokenDefaultHex(zebra!, "light")).toBe("#000000");
		expect(colorTokenDefaultHex(zebra!, "dark")).toBe("#FFFFFF");
		// Export carries color + slider.
		const out = buildColorExport({}, "dark", undefined, undefined, merged.codeBlock);
		expect(out).toContain("--zebra-color: 255 255 255;");
		expect(out).toContain("--zebra-opacity: 0.1;");
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

describe("overlay threading", () => {
	test("effectiveBaseTokens shadows neutral overrides and drives cardForeground from foreground", () => {
		const base = effectiveBaseTokens({ background: "#000000", foreground: "#ffffff" }, "dark");
		expect(base.background).toEqual([0, 0, 0]);
		expect(base.foreground).toEqual([255, 255, 255]);
		expect(base.cardForeground).toEqual([255, 255, 255]);
	});

	test("styleVars emits accent overrides as triplets and leaves untouched accents unset", () => {
		const vars = styleVars(
			merge(DEFAULTS, { colorOverrides: { traceUser: "#60A5FA", editorBg: "#101010" } }),
			LIGHT_CONFIG
		) as Record<string, string>;
		expect(vars["--trace-user"]).toBe("96 165 250");
		expect(vars["--editor-bg"]).toBe("#101010");
		expect(vars["--trace-tool"]).toBeUndefined();
	});

	test("a neutral override survives softening (base is shifted, then mixed)", () => {
		const vars = styleVars(
			merge(DEFAULTS, { theme: "dark", colorOverrides: { background: "#000000" } }),
			LIGHT_CONFIG
		) as Record<string, string>;
		// With background softening at default (1 → mix 0.1) toward [35,35,36].
		expect(vars["--background"]).toBe("4 4 4");
	});

	test("hex hosts get hex neutrals plus derived shadcn aliases; triplet hosts get triplets", () => {
		const dark = defaultStyleSettings(DARK_CONFIG);
		const hexVars = styleVars(dark, DARK_CONFIG) as Record<string, string>;
		expect(hexVars["--background"]).toMatch(/^#/);
		expect(hexVars["--popover"]).toBe(hexVars["--card"]);
		expect(hexVars["--secondary"]).toBe(hexVars["--muted"]);
		// Viewer-only tokens stay triplets in BOTH formats.
		expect(hexVars["--status-info-fill"]).toMatch(/^\d+ \d+ \d+$/);
		const tripletVars = styleVars(DEFAULTS, LIGHT_CONFIG) as Record<string, string>;
		expect(tripletVars["--background"]).toMatch(/^\d+ \d+ \d+$/);
		expect(tripletVars["--popover"]).toBeUndefined();
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
	test("emits both section headers and reflects overrides", () => {
		const out = buildColorExport({ background: "#000000", traceUser: "#123456" }, "dark");
		expect(out).toContain("styles.css :root");
		expect(out).toContain("BASE_TOKENS");
		expect(out).toContain("--background: 0 0 0;");
		expect(out).toContain("--trace-user: 18 52 86;");
		expect(out).toContain("background: [0, 0, 0],");
		expect(out).not.toContain("traceUser: [");
	});

	test("with no overrides emits the active theme's shipped defaults", () => {
		const dark = buildColorExport({}, "dark");
		expect(dark).toContain("--background: 27 27 28;");
		expect(dark).toContain("--editor-bg: #1E1E1E;");
		expect(dark).toContain("--trace-orchestration: 167 139 250;");
		const light = buildColorExport({}, "light");
		expect(light).toContain("--background: 249 249 247;");
		expect(light).toContain("--editor-bg: #FBFBF9;");
		expect(light).toContain("--trace-tool: 194 65 12;");
		expect(light).toContain("--tree-caret: 82 81 78;");
		expect(light).toContain("--tree-connector: 195 194 183;");
		expect(light).toContain("--band-wash-opacity: 0.1;");
		expect(buildColorExport({}, "dark")).toContain("--tree-connector: 58 58 59;");
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
		expect(store.has("testAppLight.settings")).toBe(true);
		expect(store.has("testAppDark.settings")).toBe(false);

		// …app B still loads ITS untouched defaults.
		expect(loadStyleSettings(DARK_CONFIG).theme).toBe("dark");
		expect(loadStyleSettings(DARK_CONFIG).colorOverrides).toEqual({});
		// And app A round-trips its own save.
		const reloaded = loadStyleSettings(LIGHT_CONFIG);
		expect(reloaded.theme).toBe("dark");
		expect(reloaded.colorOverrides).toEqual({ traceUser: "#123456" });
	});

	test("a pre-theme legacy blob adopts the app's default theme (old saves survive)", () => {
		stubStorage();
		// Simulate a blob written before the theme field existed (Ford's saved
		// example-app settings): it must load with the app default, keeping its
		// other fields.
		localStorage.setItem(
			LIGHT_CONFIG.settingsStorageKey,
			JSON.stringify({ colorOverrides: { traceUser: "#60A5FA" }, activeTab: "effects" })
		);
		const loaded = loadStyleSettings(LIGHT_CONFIG);
		expect(loaded.theme).toBe("light");
		expect(loaded.activeTab).toBe("effects");
		expect(loaded.colorOverrides).toEqual({ traceUser: "#60A5FA" });
		// The same blob under the canvas config would adopt dark.
		localStorage.setItem(DARK_CONFIG.settingsStorageKey, JSON.stringify({ activeTab: "trace" }));
		expect(loadStyleSettings(DARK_CONFIG).theme).toBe("dark");
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
