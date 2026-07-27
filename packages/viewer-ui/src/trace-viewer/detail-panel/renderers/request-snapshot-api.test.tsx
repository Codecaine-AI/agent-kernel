/**
 * request-snapshot-api.test.tsx — the apiBase contract.
 *
 * `apiBase` is a URL PREFIX, not an origin. Three values, three meanings:
 * an absolute base, `""` for same-origin (relative paths — the normal setup
 * when the kernel host serves the viewer), and `null` for offline. Only `null`
 * is offline; treating `""` as falsy would leave a same-origin app unable to
 * express itself, which is the bug this file pins shut.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SnapshotContextBody } from "./RequestSnapshotRenderer";
import { blobUrl, hasApiBase, runTurnContextUrl } from "./request-snapshot-api";

describe("apiBase — URL building", () => {
	test("an absolute base prefixes the kernel path", () => {
		expect(blobUrl("https://kernel.example", "b1-abc")).toBe(
			"https://kernel.example/kernel/blobs/b1-abc",
		);
		expect(runTurnContextUrl("https://kernel.example", "run-1", 2)).toBe(
			"https://kernel.example/kernel/runs/run-1/turns/2/context",
		);
	});

	test('"" produces a relative, same-origin URL', () => {
		expect(blobUrl("", "b1-abc")).toBe("/kernel/blobs/b1-abc");
		expect(runTurnContextUrl("", "run-1", 2)).toBe(
			"/kernel/runs/run-1/turns/2/context",
		);
	});
});

// ─── The offline gate ──────────────────────────────────────────────────────

describe("apiBase — the offline gate", () => {
	test("null and absent are offline; every string — including \"\" — is not", () => {
		expect(hasApiBase(null)).toBe(false);
		expect(hasApiBase(undefined)).toBe(false);
		expect(hasApiBase("")).toBe(true);
		expect(hasApiBase("https://kernel.example")).toBe(true);
	});

	test("the truthiness check this replaces swallowed the same-origin case", () => {
		// Regression pin: `!apiBase` was the bug — it made "" indistinguishable
		// from null, so a same-origin app could not express itself at all.
		const truthinessGate = (apiBase: string | null) => !apiBase;
		expect(truthinessGate("")).toBe(true); // wrongly "offline"
		expect(hasApiBase("")).toBe(true); // correctly online
	});

	test("a same-origin body renders relative blob URLs, not \"null/…\"", () => {
		const markup = renderToStaticMarkup(
			createElement(SnapshotContextBody, {
				systemPrompt: null,
				sections: null,
				apiBase: "",
				messages: [
					{
						role: "user",
						content: [
							{ type: "image", blob_hash: "b1-abc", mimeType: "image/png" },
						],
					},
				],
			}),
		);
		expect(markup).toContain('src="/kernel/blobs/b1-abc"');
		expect(markup).not.toContain("null/kernel");
	});
});
