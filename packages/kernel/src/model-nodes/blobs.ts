/**
 * Content-addressed JSON blobs for node payloads (plan §4.4 blob kinds:
 * call-input, call-output, call-raw-output, call-request, call-response,
 * classifier-context, classifier-request). Callers redact before building.
 */
import { hashTraceBlobBytes, type TraceBlobInput } from "@agent-kernel/db";

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return value;
	const out: Record<string, unknown> = {};
	// defineProperty, not assignment: an own "__proto__" key (as JSON.parse makes it) stays a key
	// instead of hitting the prototype setter and vanishing from the canonical form.
	for (const key of Object.keys(value).sort()) defineOwn(out, key, sortKeys((value as Record<string, unknown>)[key]));
	return out;
}

/** Defines an own enumerable data property, whatever the key ("__proto__" included). */
export function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** A canonical-JSON blob of `kind` and its hash. */
export function jsonBlob(kind: string, value: unknown, createdAt: string): { hash: string; blob: TraceBlobInput } {
	return bytesBlob(kind, "application/json", new TextEncoder().encode(canonicalJson(value)), createdAt);
}

/** A UTF-8 text blob of `kind` (raw model output, system prompts) and its hash. */
export function textBlob(kind: string, text: string, createdAt: string): { hash: string; blob: TraceBlobInput } {
	return bytesBlob(kind, "text/plain", new TextEncoder().encode(text), createdAt);
}

function bytesBlob(
	kind: string,
	mimeType: string,
	bytes: Uint8Array,
	createdAt: string,
): { hash: string; blob: TraceBlobInput } {
	const hash = hashTraceBlobBytes(bytes);
	return {
		hash,
		blob: { hash, kind, mimeType, byteLength: bytes.byteLength, data: Buffer.from(bytes), createdAt },
	};
}
