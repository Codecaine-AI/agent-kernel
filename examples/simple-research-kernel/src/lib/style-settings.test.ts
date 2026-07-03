import { describe, expect, test } from "bun:test";

import {
	buildColorExport,
	colorTokenDefaultHex,
	colorTokenEffectiveHex,
	effectiveBaseTokens,
	getColorToken,
	hexToRgb,
	hexToTriplet,
	mergeColorOverrides,
	mergeResearchStyleSettings,
	normalizeColorOverrides,
	normalizeHex,
	normalizeResearchStyleSettings,
	researchStyleVars,
	rgbToHex,
	tripletToHex,
	DEFAULT_RESEARCH_STYLE_SETTINGS
} from "./style-settings";

describe("hex / triplet conversion", () => {
	test("rgbToHex pads and uppercases", () => {
		expect(rgbToHex([27, 27, 28])).toBe("#1B1B1C");
		expect(rgbToHex([0, 0, 0])).toBe("#000000");
		expect(rgbToHex([255, 255, 255])).toBe("#FFFFFF");
	});

	test("rgbToHex clamps out-of-range channels", () => {
		expect(rgbToHex([300, -5, 128])).toBe("#FF0080");
	});

	test("hexToRgb accepts #RRGGBB, #RGB, and no-hash forms, any case", () => {
		expect(hexToRgb("#1B1B1C")).toEqual([27, 27, 28]);
		expect(hexToRgb("1b1b1c")).toEqual([27, 27, 28]);
		expect(hexToRgb("#abc")).toEqual([170, 187, 204]);
		expect(hexToRgb("  #FFF  ")).toEqual([255, 255, 255]);
	});

	test("hexToRgb rejects malformed input", () => {
		expect(hexToRgb("#12")).toBeNull();
		expect(hexToRgb("#1234")).toBeNull();
		expect(hexToRgb("#gggggg")).toBeNull();
		expect(hexToRgb("not-a-color")).toBeNull();
	});

	test("normalizeHex canonicalizes", () => {
		expect(normalizeHex("abc")).toBe("#AABBCC");
		expect(normalizeHex("#1b1b1c")).toBe("#1B1B1C");
		expect(normalizeHex("nope")).toBeNull();
	});

	test("triplet <-> hex round trips", () => {
		expect(tripletToHex("27 27 28")).toBe("#1B1B1C");
		expect(tripletToHex("  168   168  168 ")).toBe("#A8A8A8");
		expect(tripletToHex("27 27")).toBeNull();
		expect(hexToTriplet("#1B1B1C")).toBe("27 27 28");
		expect(hexToTriplet("nope")).toBeNull();
	});
});

describe("color token catalog", () => {
	test("neutral default hex derives from BASE_TOKENS", () => {
		const background = getColorToken("background");
		expect(background).toBeDefined();
		expect(colorTokenDefaultHex(background!)).toBe("#1B1B1C");
	});

	test("editor default hex derives from literal editor defaults", () => {
		const editorBg = getColorToken("editorBg");
		expect(colorTokenDefaultHex(editorBg!)).toBe("#1E1E1E");
	});

	test("accent default hex derives from accent defaults", () => {
		const orchestration = getColorToken("traceOrchestration");
		expect(colorTokenDefaultHex(orchestration!)).toBe("#A78BFA");
	});

	test("effective hex prefers a valid override, ignores a bad one", () => {
		const background = getColorToken("background")!;
		expect(colorTokenEffectiveHex(background, { background: "#123456" })).toBe("#123456");
		expect(colorTokenEffectiveHex(background, { background: "nope" })).toBe("#1B1B1C");
		expect(colorTokenEffectiveHex(background, {})).toBe("#1B1B1C");
	});
});

describe("normalizeColorOverrides", () => {
	test("keeps known ids with canonical hex, drops the rest", () => {
		const result = normalizeColorOverrides({
			background: "#abc",
			bogusToken: "#ffffff",
			foreground: "not-a-color",
			traceUser: "60a5fa"
		});
		expect(result).toEqual({ background: "#AABBCC", traceUser: "#60A5FA" });
	});

	test("returns empty object for non-objects", () => {
		expect(normalizeColorOverrides(null)).toEqual({});
		expect(normalizeColorOverrides("x")).toEqual({});
	});
});

describe("mergeColorOverrides", () => {
	test("null clears all overrides", () => {
		expect(mergeColorOverrides({ background: "#111111" }, null)).toEqual({});
	});

	test("undefined leaves current untouched", () => {
		const current = { background: "#111111" };
		expect(mergeColorOverrides(current, undefined)).toBe(current);
	});

	test("empty string removes a single token (per-token reset)", () => {
		expect(mergeColorOverrides({ background: "#111111", foreground: "#222222" }, { background: "" })).toEqual({
			foreground: "#222222"
		});
	});

	test("merges new entries over existing", () => {
		expect(mergeColorOverrides({ background: "#111111" }, { foreground: "#222222" })).toEqual({
			background: "#111111",
			foreground: "#222222"
		});
	});
});

describe("normalize / merge settings", () => {
	test("normalize fills defaults for missing color fields", () => {
		const normalized = normalizeResearchStyleSettings({});
		expect(normalized.colorOverrides).toEqual({});
		expect(normalized.activeTab).toBe("colors");
	});

	test("normalize rejects an unknown active tab", () => {
		const normalized = normalizeResearchStyleSettings({ activeTab: "nonsense" });
		expect(normalized.activeTab).toBe("colors");
	});

	test("merge folds a colorOverrides patch and persists the active tab", () => {
		const merged = mergeResearchStyleSettings(DEFAULT_RESEARCH_STYLE_SETTINGS, {
			colorOverrides: { background: "#101010" },
			activeTab: "effects"
		});
		expect(merged.colorOverrides).toEqual({ background: "#101010" });
		expect(merged.activeTab).toBe("effects");

		const cleared = mergeResearchStyleSettings(merged, { colorOverrides: null });
		expect(cleared.colorOverrides).toEqual({});
		// activeTab must survive an unrelated patch.
		expect(cleared.activeTab).toBe("effects");
	});
});

describe("overlay threading", () => {
	test("effectiveBaseTokens shadows neutral overrides and drives cardForeground from foreground", () => {
		const base = effectiveBaseTokens({ background: "#000000", foreground: "#ffffff" });
		expect(base.background).toEqual([0, 0, 0]);
		expect(base.foreground).toEqual([255, 255, 255]);
		expect(base.cardForeground).toEqual([255, 255, 255]);
	});

	test("researchStyleVars emits accent overrides as triplets and leaves untouched accents unset", () => {
		const vars = researchStyleVars(
			mergeResearchStyleSettings(DEFAULT_RESEARCH_STYLE_SETTINGS, {
				colorOverrides: { traceUser: "#60A5FA", editorBg: "#101010" }
			})
		) as Record<string, string>;
		expect(vars["--trace-user"]).toBe("96 165 250");
		expect(vars["--editor-bg"]).toBe("#101010");
		// An accent with no override is omitted so the styles.css :root default stays live.
		expect(vars["--trace-tool"]).toBeUndefined();
	});

	test("a neutral override survives softening (base is shifted, then mixed)", () => {
		const vars = researchStyleVars(
			mergeResearchStyleSettings(DEFAULT_RESEARCH_STYLE_SETTINGS, {
				colorOverrides: { background: "#000000" }
			})
		) as Record<string, string>;
		// With background softening at default (1 → mix 0.1) toward [35,35,36]:
		// round(0*0.9 + 35*0.1) = 4 (was 27-based before override).
		expect(vars["--background"]).toBe("4 4 4");
	});
});

describe("buildColorExport", () => {
	test("emits both section headers and reflects overrides", () => {
		const out = buildColorExport({ background: "#000000", traceUser: "#123456" });
		expect(out).toContain("styles.css :root");
		expect(out).toContain("BASE_TOKENS");
		expect(out).toContain("--background: 0 0 0;");
		expect(out).toContain("--trace-user: 18 52 86;");
		expect(out).toContain("background: [0, 0, 0],");
		// Accents are :root-only, never in the BASE_TOKENS section.
		expect(out).not.toContain("traceUser: [");
	});

	test("with no overrides emits shipped defaults", () => {
		const out = buildColorExport({});
		expect(out).toContain("--background: 27 27 28;");
		expect(out).toContain("--editor-bg: #1E1E1E;");
		expect(out).toContain("--trace-orchestration: 167 139 250;");
	});
});
