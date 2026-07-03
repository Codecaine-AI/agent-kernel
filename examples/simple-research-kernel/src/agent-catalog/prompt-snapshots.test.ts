/**
 * Prompt snapshot enforcement (Phase 3, D72 reviewability):
 *  - every agent directory commits a canonical prompt.json, and
 *  - a derived prompt.rendered.md that must match what the renderer produces.
 *
 * If either assertion fails, regenerate with:
 *   bun run scripts/render-prompts-to-json.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import {
	canonicalizePrompt,
	hashPrompt,
	validatePromptDocumentShape,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";

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
		test(`${dir}: prompt.json is canonical and prompt.rendered.md is fresh`, () => {
			const promptJsonPath = join(CATALOG_DIR, dir, "prompt.json");
			const renderedPath = join(CATALOG_DIR, dir, "prompt.rendered.md");

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
