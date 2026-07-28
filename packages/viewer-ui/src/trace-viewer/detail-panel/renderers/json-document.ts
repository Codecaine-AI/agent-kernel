/**
 * json-document — the ONE canonical form for JSON data blocks.
 *
 * Content blocks are otherwise byte-exact: prompts, rendered state, and free
 * text reach the reader exactly as the model saw them. JSON data blocks are the
 * single, deliberate exception. Providers serialize tool arguments and results
 * minified, so a byte-exact render is one endless line that forces horizontal
 * scrolling. Here whitespace — and only whitespace — is canonicalized to a
 * 2-space indent. Every value, and the key order as parsed, is preserved.
 *
 * Anything that does not parse as JSON passes through untouched.
 */

export type JsonDocumentLanguage = "json" | "text";

export interface JsonDocument {
	/** Pretty-printed when `raw` is JSON; otherwise `raw` unchanged. */
	body: string;
	/** "json" only when the body really parsed, so tokenizing is safe. */
	language: JsonDocumentLanguage;
}

/**
 * Re-serialize JSON text with a 2-space indent. Returns the input unchanged
 * when it is not valid JSON, so callers never have to pre-validate.
 *
 * Key order is whatever `JSON.parse` produced, which is source order for the
 * ordinary (non-integer-like) keys traces carry.
 */
export function prettyJson(raw: string): string {
	return jsonDocument(raw).body;
}

/**
 * Body + language for one data block: pretty JSON when the text parses, the
 * untouched text tagged "text" when it does not.
 */
export function jsonDocument(raw: string): JsonDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { body: raw, language: "text" };
	}

	try {
		const formatted = JSON.stringify(parsed, null, 2);
		return {
			body: formatted === undefined ? raw : formatted,
			language: "json",
		};
	} catch {
		// Cyclic values cannot come out of JSON.parse; keep the guard anyway so a
		// pathological input degrades to the exact source rather than throwing.
		return { body: raw, language: "json" };
	}
}
