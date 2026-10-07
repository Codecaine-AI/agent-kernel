/**
 * Secret collection and scrubbing for model nodes (plan §4.7).
 *
 * Every collected credential value is scrubbed everywhere, whatever its
 * length. That is only safe because short credentials are refused before any
 * request (`findShortCredential`): a 3-character key would otherwise be
 * replaced inside ordinary words of the prompt and output.
 */

export const REDACTED = "<redacted>";

/** Credentials shorter than this (after stripping `Bearer `/`Basic `) are refused before any request. */
export const MIN_CREDENTIAL_LENGTH = 8;

const SENSITIVE_HEADER_NAMES = new Set([
	"authorization",
	"proxy-authorization",
	"x-api-key",
	"api-key",
	"openai-api-key",
	"cookie",
	"set-cookie",
]);
const SENSITIVE_HEADER_PATTERN = /api[-_]?key|token|secret|cookie|authorization/i;

export function isSensitiveHeaderName(name: string): boolean {
	return SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) || SENSITIVE_HEADER_PATTERN.test(name);
}

/** Header input accepted by the collectors: a plain record (null/undefined values ignored), entries, or a Headers object. */
export type HeaderSource =
	| Record<string, string | null | undefined>
	| Iterable<readonly [string, string]>
	| Headers
	| null
	| undefined;

/** Normalizes any header source to `[name, value]` pairs, skipping empty values. */
export function headerPairs(headers: HeaderSource): Array<[string, string]> {
	if (!headers) return [];
	const pairs: Array<[string, string]> = [];
	const push = (name: unknown, value: unknown) => {
		if (typeof value !== "string" || value.length === 0) return;
		pairs.push([String(name), value]);
	};
	if (typeof Headers !== "undefined" && headers instanceof Headers) {
		headers.forEach((value, name) => push(name, value));
		return pairs;
	}
	if (typeof (headers as Iterable<unknown>)[Symbol.iterator] === "function") {
		for (const entry of headers as Iterable<readonly [string, string]>) push(entry[0], entry[1]);
		return pairs;
	}
	for (const [name, value] of Object.entries(headers as Record<string, unknown>)) push(name, value);
	return pairs;
}

/** The credential part of a header value: `Bearer `/`Basic ` stripped, trimmed. */
export function credentialPart(value: string): string {
	return value.replace(/^\s*(?:bearer|basic)\s+/i, "").trim();
}

/** Replaces sensitive header values with `"<redacted>"`; header names are kept. */
export function redactHeaders(headers: HeaderSource): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of headerPairs(headers)) {
		out[name] = isSensitiveHeaderName(name) ? REDACTED : value;
	}
	return out;
}

/**
 * The exact strings to scrub for one request: every sensitive header value
 * (with and without its `Bearer `/`Basic ` prefix) plus `extra` values such
 * as the resolved api key. Empty values mean "no credential" and are
 * ignored. Longest first, so a value is replaced before any substring of it.
 */
export function collectSecrets(
	headers: HeaderSource,
	extra: ReadonlyArray<string | null | undefined> = [],
): string[] {
	const secrets = new Set<string>();
	const add = (value: string | null | undefined) => {
		if (typeof value !== "string") return;
		const trimmed = value.trim();
		if (trimmed.length > 0) secrets.add(trimmed);
		const part = credentialPart(value);
		if (part.length > 0) secrets.add(part);
	};
	for (const [name, value] of headerPairs(headers)) {
		if (isSensitiveHeaderName(name)) add(value);
	}
	for (const value of extra) add(value);
	return sortSecrets(secrets);
}

/** Merges secret sets (deduplicated, longest first). */
export function mergeSecrets(...sets: ReadonlyArray<ReadonlyArray<string>>): string[] {
	const merged = new Set<string>();
	for (const set of sets) for (const value of set) if (value.length > 0) merged.add(value);
	return sortSecrets(merged);
}

function sortSecrets(values: Iterable<string>): string[] {
	return [...values].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The first credential too short to redact safely (1–7 characters after
 * stripping `Bearer `/`Basic `): a sensitive header name, or `"apiKey"` for
 * an `extra` value. Undefined when every credential is long enough.
 */
export function findShortCredential(
	headers: HeaderSource,
	extra: ReadonlyArray<string | null | undefined> = [],
): string | undefined {
	const isShort = (value: string) => {
		const part = credentialPart(value);
		return part.length > 0 && part.length < MIN_CREDENTIAL_LENGTH;
	};
	for (const [name, value] of headerPairs(headers)) {
		if (isSensitiveHeaderName(name) && isShort(value)) return name;
	}
	for (const value of extra) {
		if (typeof value === "string" && isShort(value)) return "apiKey";
	}
	return undefined;
}

/** Replaces every occurrence of every secret in `text`. */
export function redactText(text: string, secrets: ReadonlyArray<string>): string {
	let out = text;
	for (const secret of secrets) {
		if (secret.length === 0) continue;
		if (out.includes(secret)) out = out.split(secret).join(REDACTED);
	}
	return out;
}

/**
 * Deep copy of `value` with every secret replaced in nested strings and
 * object keys (URLs, raw text, SSE frames and error messages included).
 * Error objects become plain `{ name, message }` records. Values that are
 * not JSON-shaped (numbers, booleans, typed arrays, …) pass through.
 */
export function redactDeep<T>(value: T, secrets: ReadonlyArray<string>): T {
	const live = secrets.filter((s) => s.length > 0);
	if (live.length === 0) return value;
	return scrub(value, live, new WeakMap()) as T;
}

function scrub(value: unknown, secrets: ReadonlyArray<string>, seen: WeakMap<object, unknown>): unknown {
	if (typeof value === "string") return redactText(value, secrets);
	if (value === null || typeof value !== "object") return value;
	const cached = seen.get(value);
	if (cached !== undefined) return cached;
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		seen.set(value, out);
		for (const item of value) out.push(scrub(item, secrets, seen));
		return out;
	}
	if (value instanceof Error) {
		const out = { name: value.name, message: redactText(value.message, secrets) };
		seen.set(value, out);
		return out;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return value;
	const out: Record<string, unknown> = {};
	seen.set(value, out);
	for (const [key, item] of Object.entries(value)) {
		out[redactText(key, secrets)] = scrub(item, secrets, seen);
	}
	return out;
}
