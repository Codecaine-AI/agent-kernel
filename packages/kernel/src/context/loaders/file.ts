/**
 * file.ts — Single-path file loader.
 *
 * Resolves decl.path against ctx.cwd unless already absolute. Missing path is
 * an error (hardening the legacy warn-on-missing behavior in default-reads.ts).
 * Empty files resolve to status='empty'.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { hashContent } from "./catalog";
import type { FileLoaderDeclaration, Loader } from "./types";

export const fileLoader: Loader<FileLoaderDeclaration> = {
	kind: "file",
	resolve: async (decl, ctx) => {
		const fullPath = isAbsolute(decl.path)
			? decl.path
			: join(ctx.cwd, decl.path);

		if (!existsSync(fullPath)) {
			return {
				status: "error",
				content: "",
				bytes: 0,
				hash: "",
				error: `file not found: ${decl.path}`,
			};
		}

		let content: string;
		try {
			content = readFileSync(fullPath, "utf-8");
		} catch (err) {
			return {
				status: "error",
				content: "",
				bytes: 0,
				hash: "",
				error: (err as Error).message,
			};
		}

		if (!content) {
			return { status: "empty", content: "", bytes: 0, hash: hashContent("") };
		}

		return {
			status: "ok",
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			hash: hashContent(content),
		};
	},
};

export default fileLoader;
