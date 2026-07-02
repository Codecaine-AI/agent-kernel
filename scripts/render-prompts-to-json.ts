/**
 * Prompt migration / snapshot regeneration for agent catalogs.
 *
 * For each agent directory (containing agent.ts) under the given catalog
 * root(s):
 *   1. If a legacy prompt.ts exists, import its exported `prompt` document
 *      and write the canonical prompt.json (canonicalizePrompt output, so the
 *      committed file is already canonical bytes). One-time Phase 3 migration;
 *      delete prompt.ts afterwards.
 *   2. Always (re)generate prompt.rendered.md from prompt.json — the derived,
 *      committed snapshot enforced by the snapshot test.
 *
 * Usage:
 *   bun run scripts/render-prompts-to-json.ts [catalogRoot ...]
 * Defaults to examples/simple-research-kernel/src/agent-catalog.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Relative import: repo-root scripts are outside the workspace packages, so
// the "@codecaine-ai/prompt-kit" specifier does not resolve from here.
import {
	canonicalizePrompt,
	hashPrompt,
	renderXmlMarkdown,
	validatePromptDocumentShape,
	type PromptDocument,
} from "../packages/prompt-kit/src/index";

const repoRoot = resolve(import.meta.dir, "..");
const catalogRoots = process.argv.slice(2).length
	? process.argv.slice(2).map((p) => resolve(p))
	: [resolve(repoRoot, "examples/simple-research-kernel/src/agent-catalog")];

export const RENDERED_SNAPSHOT_HEADER =
	"<!-- derived from prompt.json — do not edit. regenerate: bun run scripts/render-prompts-to-json.ts -->\n\n";

/** Exact content of a prompt.rendered.md snapshot for a document. */
export function renderedSnapshot(doc: PromptDocument): string {
	const body = renderXmlMarkdown(doc);
	return `${RENDERED_SNAPSHOT_HEADER}${body.endsWith("\n") ? body : `${body}\n`}`;
}

function collectAgentDirs(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...collectAgentDirs(full));
		else if (entry.name === "agent.ts") out.push(dirname(full));
	}
	return out.sort();
}

async function migrateOne(agentDir: string): Promise<void> {
	const promptTs = join(agentDir, "prompt.ts");
	const promptJson = join(agentDir, "prompt.json");
	const renderedMd = join(agentDir, "prompt.rendered.md");

	if (existsSync(promptTs)) {
		const mod = (await import(pathToFileURL(promptTs).href)) as {
			prompt?: PromptDocument;
			default?: PromptDocument;
		};
		const doc = mod.prompt ?? mod.default;
		if (!doc || (doc as { kind?: unknown }).kind !== "prompt") {
			throw new Error(`prompt.ts does not export a PromptDocument: ${promptTs}`);
		}
		writeFileSync(promptJson, canonicalizePrompt(doc), "utf8");
		console.log(`wrote ${relative(repoRoot, promptJson)} (from prompt.ts)`);
	}

	if (!existsSync(promptJson)) {
		throw new Error(`no prompt.json or prompt.ts in ${agentDir}`);
	}

	const parsed = JSON.parse(readFileSync(promptJson, "utf8")) as unknown;
	const shape = validatePromptDocumentShape(parsed);
	if (!shape.valid) {
		throw new Error(
			`invalid prompt.json at ${promptJson}:\n  - ${shape.errors.join("\n  - ")}`,
		);
	}
	const doc = parsed as PromptDocument;

	// Re-canonicalize in place so hand edits normalize back to canonical bytes.
	writeFileSync(promptJson, canonicalizePrompt(doc), "utf8");

	writeFileSync(renderedMd, renderedSnapshot(doc), "utf8");
	console.log(
		`wrote ${relative(repoRoot, renderedMd)} (${hashPrompt(doc)})`,
	);
}

if (import.meta.main) {
	for (const root of catalogRoots) {
		if (!existsSync(root)) throw new Error(`catalog root not found: ${root}`);
		for (const agentDir of collectAgentDirs(root)) {
			await migrateOne(agentDir);
		}
	}
}
