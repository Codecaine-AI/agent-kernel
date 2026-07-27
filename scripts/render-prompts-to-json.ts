/**
 * Prompt migration / snapshot regeneration for agent catalogs.
 *
 * For each agent bundle (a directory containing an agent.json manifest) under
 * the given catalog root(s):
 *   1. If a legacy prompt.ts exists, import its exported `prompt` document
 *      and write the canonical prompt.json (canonicalizePrompt output, so the
 *      committed file is already canonical bytes). One-time Phase 3 migration;
 *      delete prompt.ts afterwards.
 *   2. Always (re)generate the markdown render from prompt.json — the derived,
 *      committed snapshot enforced by the snapshot test. Bundle-form aware:
 *      `prompt.rendered.md` beside a flat `prompt.json`, `prompt/system.md`
 *      inside a folder-form bundle.
 *
 * Steps 2 delegates to the kernel utility behind `agent-kernel-render-prompts`
 * so the script, the CLI and the lab save path emit identical bytes.
 *
 * Usage:
 *   bun run scripts/render-prompts-to-json.ts [catalogRoot ...]
 * Defaults to examples/simple-research-kernel/src/agent-catalog.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	canonicalizePrompt,
	renderXmlMarkdown,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
// Relative, not "@agent-kernel/kernel/*": the repo root is not a workspace
// member, so the kernel package is not linked into its node_modules.
import {
	refreshBundlePromptSnapshot,
	renderedPromptSnapshot,
	RENDERED_SNAPSHOT_HEADER,
} from "../packages/kernel/src/agent-registry/prompt-snapshot";
import {
	collectBundleDirs,
	resolvePromptEntry,
} from "../packages/kernel/src/agent-registry/registry/bundle-layout";

const repoRoot = resolve(import.meta.dir, "..");
const catalogRoots = process.argv.slice(2).length
	? process.argv.slice(2).map((p) => resolve(p))
	: [resolve(repoRoot, "examples/simple-research-kernel/src/agent-catalog")];

export { RENDERED_SNAPSHOT_HEADER };

/** Exact content of the generated markdown snapshot for a document. */
export function renderedSnapshot(doc: PromptDocument): string {
	return renderedPromptSnapshot(renderXmlMarkdown(doc));
}

async function migrateOne(agentDir: string): Promise<void> {
	const promptTs = join(agentDir, "prompt.ts");

	if (existsSync(promptTs)) {
		const mod = (await import(pathToFileURL(promptTs).href)) as {
			prompt?: PromptDocument;
			default?: PromptDocument;
		};
		const doc = mod.prompt ?? mod.default;
		if (!doc || (doc as { kind?: unknown }).kind !== "prompt") {
			throw new Error(`prompt.ts does not export a PromptDocument: ${promptTs}`);
		}
		const target = resolvePromptEntry(agentDir).path ?? join(agentDir, "prompt.json");
		writeFileSync(target, canonicalizePrompt(doc), "utf8");
		console.log(`wrote ${relative(repoRoot, target)} (from prompt.ts)`);
	}

	const result = refreshBundlePromptSnapshot(agentDir);
	console.log(
		`${result.changed || result.canonicalized ? "wrote" : "ok"} ` +
			`${relative(repoRoot, result.renderedFile)} (${result.form} form, ${result.hash})`,
	);
}

if (import.meta.main) {
	for (const root of catalogRoots) {
		if (!existsSync(root)) throw new Error(`catalog root not found: ${root}`);
		for (const agentDir of collectBundleDirs(root)) {
			await migrateOne(agentDir);
		}
	}
}
