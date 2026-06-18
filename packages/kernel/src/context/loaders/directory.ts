/**
 * directory.ts — Glob / directory loader.
 *
 * Scans ctx.cwd for files matching decl.pattern (Bun.Glob), optionally filtered
 * by decl.extensions, and concatenates each match wrapped in <file path="..."/>
 * markers. A zero-match result is legitimate (status='empty') — unlike the
 * single-file loader, a glob returning nothing is not an error.
 *
 * Per-file read failures produce <file path="..." error="..."/> markers inline
 * so a single unreadable file does not fail the whole directory load.
 */

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { hashContent } from "./catalog";
import type { DirectoryLoaderDeclaration, Loader } from "./types";

function scanMatches(pattern: string, cwd: string): string[] {
	try {
		const glob = new Bun.Glob(pattern);
		const matches: string[] = [];
		for (const rel of glob.scanSync({ cwd, onlyFiles: true })) {
			matches.push(rel);
		}
		return matches.sort();
	} catch {
		return [];
	}
}

function readOne(absPath: string, relPath: string): string {
	try {
		const content = readFileSync(absPath, "utf-8");
		return `<file path="${relPath}">\n${content}\n</file>`;
	} catch (err) {
		return `<file path="${relPath}" error="${(err as Error).message}"/>`;
	}
}

export const directoryLoader: Loader<DirectoryLoaderDeclaration> = {
	kind: "directory",
	resolve: async (decl, ctx) => {
		let matches = scanMatches(decl.pattern, ctx.cwd);
		if (decl.extensions && decl.extensions.length > 0) {
			const allowed = new Set(decl.extensions);
			matches = matches.filter((rel) => allowed.has(extname(rel)));
		}

		if (matches.length === 0) {
			return { status: "empty", content: "", bytes: 0, hash: hashContent("") };
		}

		const concatenated = matches
			.map((rel) => readOne(join(ctx.cwd, rel), rel))
			.join("\n\n");

		return {
			status: "ok",
			content: concatenated,
			bytes: Buffer.byteLength(concatenated, "utf8"),
			hash: hashContent(concatenated),
		};
	},
};

export default directoryLoader;
