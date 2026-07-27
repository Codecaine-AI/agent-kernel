/**
 * Prompt markdown snapshots — `prompt.json` → the generated markdown render.
 *
 * `prompt.json` is the source of truth. The markdown beside it exists so the
 * prompt is readable and diffable in the format the model actually receives;
 * it is generated, never hand-edited, and never parsed by the registry.
 *
 * Where it lands follows the bundle form (see registry/bundle-layout.ts):
 *   file form:   <bundle>/prompt.json        → <bundle>/prompt.rendered.md
 *   folder form: <bundle>/prompt/prompt.json → <bundle>/prompt/system.md
 *
 * The render itself is prompt-kit's `renderXmlMarkdown` — the very same
 * function the registry uses to build the system-prompt body — so the file on
 * disk is byte-for-byte the prompt body, prefixed with a generated-file
 * header. There is no second, lower-fidelity renderer.
 */
import { readFileSync, writeFileSync } from "node:fs";

import {
	canonicalizePrompt,
	hashPrompt,
	renderXmlMarkdown,
	validatePromptDocumentShape,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";

import {
	collectBundleDirs,
	renderedPromptPathFor,
	resolvePromptEntry,
} from "./registry/bundle-layout";

/** Marks the file as generated and names the command that regenerates it. */
export const RENDERED_SNAPSHOT_HEADER =
	"<!-- derived from prompt.json — do not edit. regenerate: bunx agent-kernel-render-prompts <catalog-root> -->\n\n";

/** Header + an already-rendered prompt body, newline-terminated. */
export function renderedPromptSnapshot(body: string): string {
	return `${RENDERED_SNAPSHOT_HEADER}${body.endsWith("\n") ? body : `${body}\n`}`;
}

/** The exact bytes of the markdown snapshot for a prompt document. */
export function promptSnapshotFor(document: PromptDocument): string {
	return renderedPromptSnapshot(renderXmlMarkdown(document));
}

export interface PromptSnapshotResult {
	/** The bundle directory (the agent.json's parent). */
	agentDir: string;
	/** The prompt.json that was read. */
	promptFile: string;
	/** The markdown file that was (re)written. */
	renderedFile: string;
	/** Which bundle form the prompt resolved to. */
	form: "file" | "folder";
	/** Content address of the document, `pk1-<sha256>`. */
	hash: string;
	/** True when the markdown on disk differed from the freshly rendered bytes. */
	changed: boolean;
	/** True when prompt.json itself was rewritten into canonical bytes. */
	canonicalized: boolean;
}

export interface RefreshPromptSnapshotOptions {
	/**
	 * Also rewrite prompt.json in canonical bytes, so a hand edit normalizes
	 * back to the form the hash is computed over. Default true.
	 */
	canonicalize?: boolean;
	/** Report what would change without writing anything. Default false. */
	dryRun?: boolean;
}

/**
 * Regenerate the markdown snapshot for one bundle directory. Throws when the
 * bundle has no prompt.json in either form, or when the document fails the
 * PromptDocument shape check.
 */
export function refreshBundlePromptSnapshot(
	agentDir: string,
	opts: RefreshPromptSnapshotOptions = {},
): PromptSnapshotResult {
	const entry = resolvePromptEntry(agentDir);
	if (!entry.path || !entry.form) {
		throw new Error(
			`no prompt.json in ${agentDir} (looked for prompt.json and prompt/prompt.json)`,
		);
	}
	const promptFile = entry.path;
	const raw = readFileSync(promptFile, "utf8");
	const parsed = JSON.parse(raw) as unknown;
	const shape = validatePromptDocumentShape(parsed);
	if (!shape.valid) {
		throw new Error(
			`invalid prompt.json at ${promptFile}:\n  - ${shape.errors.join("\n  - ")}`,
		);
	}
	const document = parsed as PromptDocument;

	const canonicalize = opts.canonicalize ?? true;
	const canonical = canonicalizePrompt(document);
	const canonicalized = canonicalize && canonical !== raw;
	if (canonicalized && !opts.dryRun) writeFileSync(promptFile, canonical, "utf8");

	const renderedFile = renderedPromptPathFor(promptFile);
	const next = promptSnapshotFor(document);
	let previous: string | null = null;
	try {
		previous = readFileSync(renderedFile, "utf8");
	} catch {
		previous = null;
	}
	const changed = previous !== next;
	if (changed && !opts.dryRun) writeFileSync(renderedFile, next, "utf8");

	return {
		agentDir,
		promptFile,
		renderedFile,
		form: entry.form,
		hash: hashPrompt(document),
		changed,
		canonicalized,
	};
}

/**
 * Regenerate the markdown snapshot for every bundle under the given catalog
 * roots, in sorted path order.
 */
export function refreshCatalogPromptSnapshots(
	roots: string[],
	opts: RefreshPromptSnapshotOptions = {},
): PromptSnapshotResult[] {
	const results: PromptSnapshotResult[] = [];
	for (const root of roots) {
		for (const agentDir of collectBundleDirs(root)) {
			results.push(refreshBundlePromptSnapshot(agentDir, opts));
		}
	}
	return results;
}
