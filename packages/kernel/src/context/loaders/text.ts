/**
 * text.ts — Inline-string loader.
 *
 * Carries a literal string baked into an agent's context manifest. Cannot fail
 * — empty content resolves to status='empty'; any other content to status='ok'.
 */

import { hashContent } from "./catalog";
import type { Loader, TextLoaderDeclaration } from "./types";

export const textLoader: Loader<TextLoaderDeclaration> = {
	kind: "text",
	resolve: async (decl) => {
		const content = decl.content;
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

export default textLoader;
