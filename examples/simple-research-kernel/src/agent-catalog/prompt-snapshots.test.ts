/**
 * Prompt snapshot enforcement (Phase 3, D72 reviewability) over folder-form
 * bundles:
 *  - every agent bundle commits a canonical prompt/prompt.json, and
 *  - a generated prompt/system.md that must match what the renderer produces.
 *
 * If either assertion fails, regenerate with:
 *   bun run scripts/render-prompts-to-json.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import {
	canonicalizePrompt,
	hashPrompt,
	validatePromptDocumentShape,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import { resolvePromptEntry } from "@agent-kernel/kernel/agent-registry";

import { renderedSnapshot } from "../../../../scripts/render-prompts-to-json";

const CATALOG_DIR = import.meta.dir;

const agentDirs = readdirSync(CATALOG_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

describe("agent catalog prompt snapshots", () => {
	test("catalog contains the three research agents", () => {
		expect(agentDirs).toEqual([
			"research-coordinator",
			"source-scout",
			"synthesis-writer",
		]);
	});

	for (const dir of agentDirs) {
		const bundleDir = join(CATALOG_DIR, dir);

		test(`${dir}: bundle is in folder form`, () => {
			// The exemplar catalog teaches the bundle tree: every section that
			// exists is a folder with an index entry point, and nothing is left
			// behind at the old flat path.
			expect(resolvePromptEntry(bundleDir).form).toBe("folder");
			expect(existsSync(join(bundleDir, "context", "index.ts"))).toBe(true);
			expect(existsSync(join(bundleDir, "tools", "index.ts"))).toBe(true);
			expect(existsSync(join(bundleDir, "prompt.json"))).toBe(false);
			expect(existsSync(join(bundleDir, "prompt.rendered.md"))).toBe(false);
			expect(existsSync(join(bundleDir, "context.ts"))).toBe(false);
			expect(existsSync(join(bundleDir, "tools.ts"))).toBe(false);
		});

		test(`${dir}: prompt.json is canonical and system.md is fresh`, () => {
			const promptJsonPath = join(bundleDir, "prompt", "prompt.json");
			const renderedPath = join(bundleDir, "prompt", "system.md");

			const raw = readFileSync(promptJsonPath, "utf8");
			const parsed = JSON.parse(raw) as unknown;
			const shape = validatePromptDocumentShape(parsed);
			expect(shape.errors).toEqual([]);
			const doc = parsed as PromptDocument;

			// The committed file must already be canonical bytes.
			expect(canonicalizePrompt(doc)).toBe(raw);
			expect(hashPrompt(doc)).toStartWith("pk1-");

			// The committed rendered snapshot must match the renderer output.
			const committed = readFileSync(renderedPath, "utf8");
			expect(committed).toBe(renderedSnapshot(doc));
			expect(committed).toContain("derived from prompt.json — do not edit");
		});
	}
});
