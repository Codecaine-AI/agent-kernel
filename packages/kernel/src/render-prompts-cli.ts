#!/usr/bin/env bun
/**
 * Prompt markdown renderer CLI — regenerate the generated markdown render of
 * every bundle's `prompt.json` under one or more catalog roots.
 *
 * `prompt.json` is the source of truth; the markdown beside it is generated so
 * the prompt stays readable and diffable. Where it lands follows the bundle
 * form: `<bundle>/prompt.rendered.md` for a flat `prompt.json`, and
 * `<bundle>/prompt/system.md` for the folder form.
 *
 * Usage:
 *   bunx agent-kernel-render-prompts <catalog-root> [more-roots ...]
 *   bunx agent-kernel-render-prompts --check <catalog-root>   # exit 1 if stale
 *   bunx agent-kernel-render-prompts --agent <bundle-dir>     # one bundle
 *
 * Flags:
 *   --check          do not write; exit non-zero when anything is stale
 *   --agent <dir>    treat <dir> as a single bundle instead of a catalog root
 *   --no-canonical   leave prompt.json bytes alone (default: re-canonicalize)
 */
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
	refreshBundlePromptSnapshot,
	refreshCatalogPromptSnapshots,
	type PromptSnapshotResult,
} from "./agent-registry/prompt-snapshot";

const USAGE =
	"usage: agent-kernel-render-prompts [--check] [--no-canonical] [--agent] <catalog-root ...>";

export function renderPromptsCliMain(
	argv: string[] = process.argv.slice(2),
): number {
	let check = false;
	let canonicalize = true;
	let singleBundle = false;
	const paths: string[] = [];
	for (const arg of argv) {
		if (arg === "--check") check = true;
		else if (arg === "--no-canonical") canonicalize = false;
		else if (arg === "--agent") singleBundle = true;
		else if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			return 0;
		} else if (arg.startsWith("-")) {
			console.error(`agent-kernel-render-prompts: unknown flag ${arg}`);
			console.error(USAGE);
			return 2;
		} else paths.push(resolve(arg));
	}

	if (paths.length === 0) {
		console.error("agent-kernel-render-prompts: no catalog root given");
		console.error(USAGE);
		return 2;
	}
	for (const path of paths) {
		if (!existsSync(path)) {
			console.error(`agent-kernel-render-prompts: path not found: ${path}`);
			return 2;
		}
	}

	const opts = { canonicalize, dryRun: check };
	let results: PromptSnapshotResult[];
	try {
		results = singleBundle
			? paths.map((dir) => refreshBundlePromptSnapshot(dir, opts))
			: refreshCatalogPromptSnapshots(paths, opts);
	} catch (err) {
		console.error(
			`agent-kernel-render-prompts: ${err instanceof Error ? err.message : String(err)}`,
		);
		return 2;
	}

	const cwd = process.cwd();
	let stale = 0;
	for (const r of results) {
		const where = relative(cwd, r.renderedFile) || r.renderedFile;
		if (r.changed || r.canonicalized) {
			stale += 1;
			const what = [
				r.changed ? (check ? "stale" : "wrote") : null,
				r.canonicalized ? (check ? "non-canonical prompt.json" : "canonicalized prompt.json") : null,
			]
				.filter(Boolean)
				.join(" + ");
			console.log(`${what}: ${where} (${r.form} form, ${r.hash})`);
		} else {
			console.log(`ok: ${where} (${r.form} form, ${r.hash})`);
		}
	}

	if (results.length === 0) {
		console.error("agent-kernel-render-prompts: no agent bundles found");
		return 2;
	}
	if (check && stale > 0) {
		console.error(
			`agent-kernel-render-prompts: ${stale} bundle(s) out of date — rerun without --check`,
		);
		return 1;
	}
	return 0;
}

if (import.meta.main) {
	try {
		process.exit(renderPromptsCliMain());
	} catch (err) {
		console.error("agent-kernel-render-prompts failed:", err);
		process.exit(2);
	}
}
