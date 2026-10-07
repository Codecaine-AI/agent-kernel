/**
 * Collector → EngineAttempt[] (plan §4.2 rule 6). One attempt per LLM call
 * of the function log, sorted by start time (fallback attempts are not
 * guaranteed to arrive in order), keeping BAML's `selected` flag. Usage
 * comes from the call; reasoning and cache-write tokens from the raw
 * response body, or from the `response.completed` SSE event on a stream.
 * Header maps are normalized and sensitive values replaced; secret values
 * elsewhere are scrubbed by the engine before it returns.
 */
import { redactHeaders } from "../redact";
import type { EngineAttempt } from "../types";
import {
	headerEntries,
	type BamlCollectorLike,
	type BamlFunctionLogLike,
	type BamlHttpBodyLike,
	type BamlLlmCallLike,
} from "./baml-runtime-types";

/** `collector.last`, or null when the native getter throws. */
export function lastFunctionLog(collector: BamlCollectorLike): BamlFunctionLogLike | null {
	try {
		return collector.last ?? null;
	} catch {
		return null;
	}
}

/** The raw LLM text of the log, or null (a failed stream reports `undefined`). */
export function rawLlmText(log: BamlFunctionLogLike | null): string | null {
	const raw = log?.rawLlmResponse;
	return typeof raw === "string" ? raw : null;
}

/**
 * `fallbackModel` (the requested model id) stands in when neither body names
 * the served model. A native getter that throws yields no attempts rather
 * than a rejected invoke.
 */
export function attemptsFromLog(log: BamlFunctionLogLike | null, fallbackModel: string): EngineAttempt[] {
	if (!log) return [];
	try {
		return log.calls
			.map((call) => toAttempt(call, fallbackModel))
			.sort((a, b) => a.startedAtMs - b.startedAtMs);
	} catch {
		return [];
	}
}

function toAttempt(call: BamlLlmCallLike, fallbackModel: string): EngineAttempt {
	const timing = call.timing;
	const httpRequest = call.httpRequest;
	const httpResponse = call.httpResponse;
	const requestBody = httpRequest ? readBody(httpRequest.body) : null;
	const responseBody = httpResponse ? readBody(httpResponse.body) : null;
	const sse = httpResponse ? null : readSse(call);
	const finalBody = httpResponse ? responseBody : completedResponse(sse);
	const details = usageDetails(finalBody);
	const usage = call.usage;
	return {
		transport: "baml-http",
		clientName: call.clientName,
		provider: call.provider,
		startedAtMs: timing.startTimeUtcMs,
		durationMs: timing.durationMs ?? null,
		selected: call.selected,
		status: httpResponse?.status ?? null,
		usage: usage
			? {
					inputTokens: usage.inputTokens ?? 0,
					outputTokens: usage.outputTokens ?? 0,
					cacheReadTokens: usage.cachedInputTokens ?? 0,
					cacheWriteTokens: details.cacheWriteTokens ?? 0,
					model: modelOf(finalBody) ?? modelOf(requestBody) ?? fallbackModel,
				}
			: null,
		...(details.reasoningTokens !== undefined && { reasoningTokens: details.reasoningTokens }),
		request: httpRequest
			? {
					method: httpRequest.method,
					url: httpRequest.url,
					headers: redactHeaders(headerEntries(httpRequest.headers)),
					body: requestBody,
				}
			: null,
		response: httpResponse
			? {
					status: httpResponse.status,
					headers: redactHeaders(headerEntries(httpResponse.headers)),
					body: responseBody,
				}
			: sse && sse.length > 0
				? { sse }
				: null,
	};
}

/** JSON when the body parses, else its text, else null. */
function readBody(body: BamlHttpBodyLike | null | undefined): unknown {
	if (!body) return null;
	try {
		return body.json();
	} catch {
		try {
			return body.text();
		} catch {
			return null;
		}
	}
}

/** Each frame's JSON, or its text when it is not JSON; null for a call without SSE. */
function readSse(call: BamlLlmCallLike): unknown[] | null {
	if (typeof call.sseResponses !== "function") return null;
	let frames: ReturnType<NonNullable<BamlLlmCallLike["sseResponses"]>>;
	try {
		frames = call.sseResponses();
	} catch {
		return null;
	}
	if (!frames) return null;
	return frames.map((frame) => {
		try {
			return frame.json() ?? frame.text;
		} catch {
			return frame.text;
		}
	});
}

function completedResponse(sse: unknown[] | null): unknown {
	const completed = sse?.find((frame) => record(frame)?.type === "response.completed");
	return record(completed)?.response ?? null;
}

/**
 * Reasoning tokens: Responses `output_tokens_details`, else Chat Completions
 * `completion_tokens_details`. Cache writes: Responses
 * `input_tokens_details.cache_write_tokens` (codex-lb reports it), else
 * Anthropic `cache_creation_input_tokens`.
 */
function usageDetails(body: unknown): { reasoningTokens?: number; cacheWriteTokens?: number } {
	const usage = record(record(body)?.usage);
	if (!usage) return {};
	const reasoningTokens =
		count(record(usage.output_tokens_details)?.reasoning_tokens) ??
		count(record(usage.completion_tokens_details)?.reasoning_tokens);
	const cacheWriteTokens =
		count(record(usage.input_tokens_details)?.cache_write_tokens) ?? count(usage.cache_creation_input_tokens);
	return {
		...(reasoningTokens !== undefined && { reasoningTokens }),
		...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
	};
}

function modelOf(body: unknown): string | undefined {
	const model = record(body)?.model;
	return typeof model === "string" && model.length > 0 ? model : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
