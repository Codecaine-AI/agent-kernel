/**
 * Structural types for the parts of `@boundaryml/baml` the adapter touches.
 *
 * The kernel never imports BAML, not even as a type (one native addon per
 * process; the boundary check enforces it). These interfaces mirror the
 * installed declarations of 0.226.2 (`native.d.ts`, `errors.d.ts`) so the
 * harness's own module object and generated client are assignable to them:
 * class getters become `readonly` properties, native header getters return
 * `object` (normalize with `headerEntries`), and the error constructors carry
 * the fields the failure mapping reads.
 */

export interface BamlUsageLike {
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cachedInputTokens: number | null;
}

export interface BamlTimingLike {
	readonly startTimeUtcMs: number;
	readonly durationMs: number | null;
}

export interface BamlHttpBodyLike {
	text(): string;
	json(): any;
}

export interface BamlHttpRequestLike {
	readonly method: string;
	readonly url: string;
	/** Native getter type; normalize with headerEntries(h). */
	readonly headers: object;
	readonly body: BamlHttpBodyLike;
}

export interface BamlHttpResponseLike {
	readonly status: number;
	readonly headers: object;
	readonly body: BamlHttpBodyLike;
}

export interface BamlSseLike {
	readonly text: string;
	json(): any | null;
}

export interface BamlLlmCallLike {
	readonly clientName: string;
	readonly provider: string;
	readonly selected: boolean;
	readonly timing: BamlTimingLike;
	readonly usage: BamlUsageLike | null;
	readonly httpRequest: BamlHttpRequestLike | null;
	readonly httpResponse: BamlHttpResponseLike | null;
	/** Present on LlmStreamCall only. */
	sseResponses?(): BamlSseLike[] | null;
}

export interface BamlFunctionLogLike {
	readonly calls: BamlLlmCallLike[];
	readonly rawLlmResponse: string | null;
}

export interface BamlCollectorLike {
	readonly last: BamlFunctionLogLike | null;
}

export interface BamlClientRegistryLike {
	addLlmClient(name: string, provider: string, options: { [key: string]: any }, retryPolicy?: string | null): void;
	setPrimary(primary: string): void;
}

type Ctor<T> = abstract new (...args: any[]) => T;

export interface BamlRuntimeLike {
	Collector: new (name?: string | null) => BamlCollectorLike;
	ClientRegistry: new () => BamlClientRegistryLike;
	BamlError: Ctor<Error>;
	BamlValidationError: Ctor<Error & { raw_output: string }>;
	BamlClientFinishReasonError: Ctor<Error & { raw_output: string; finish_reason?: string }>;
	BamlClientHttpError: Ctor<Error & { status_code: number; raw_response?: string }>;
	/** A subclass of BamlClientHttpError: classify it first. */
	BamlTimeoutError: Ctor<Error & { status_code: number }>;
	BamlAbortError: Ctor<Error>;
}

/** Normalizes a native `object` header map to strings (non-string values are JSON-stringified). */
export function headerEntries(h: object): Record<string, string> {
	const out: Record<string, string> = {};
	if (h === null || typeof h !== "object") return out;
	const entries: Iterable<[unknown, unknown]> =
		h instanceof Map
			? (h.entries() as Iterable<[unknown, unknown]>)
			: (Object.entries(h) as Array<[string, unknown]>);
	for (const [key, value] of entries) {
		if (value === undefined) continue;
		// defineProperty, not assignment: a header named "__proto__" stays a header.
		Object.defineProperty(out, String(key), {
			value: typeof value === "string" ? value : JSON.stringify(value),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return out;
}
