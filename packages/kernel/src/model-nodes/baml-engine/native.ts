/**
 * The BAML-native path (plan §4.2 rules 1–3, 5, 6): BAML renders, sends and
 * parses. Each invoke gets a fresh Collector and a one-leaf ClientRegistry
 * named `KernelCall` built from the kernel's resolved route, so the
 * harness's static clients and their env lookups are never used.
 */
import { SHORT_CREDENTIAL_MESSAGE } from "../pi-models";
import { findShortCredential, mergeSecrets } from "../redact";
import type { ResolvedRoute } from "../types";
import { attemptsFromLog, lastFunctionLog, rawLlmText } from "./attempts";
import type { BamlRuntimeLike } from "./baml-runtime-types";
import { classifyBamlError } from "./classify";
import type { BamlCallable } from "./client";
import { bamlCallEnv } from "./log-level";
import { routeSecrets, type EngineInvoke, type EngineRun } from "./outcome";

/** Pi api id → BAML provider. Any other api is a route failure on this path. */
export const BAML_PROVIDER_BY_PI_API: Readonly<Record<string, string>> = {
	"openai-responses": "openai-responses",
	"openai-completions": "openai-generic",
	"anthropic-messages": "anthropic",
};

export const KERNEL_CALL_CLIENT = "KernelCall";

export function bamlProviderFor(api: string): string | undefined {
	return Object.hasOwn(BAML_PROVIDER_BY_PI_API, api) ? BAML_PROVIDER_BY_PI_API[api] : undefined;
}

/** codex-lb's `/backend-api/` route accepts only `stream: true`; `onTick` sends `b.Fn()` through the stream path. */
export function isStreamOnlyRoute(baseUrl: string): boolean {
	return baseUrl.includes("/backend-api/");
}

/**
 * Options for the `KernelCall` leaf. `api_key` is always explicit: without
 * it BAML falls back to the ambient provider variable (`OPENAI_API_KEY`,
 * verified against 0.226.2) and sends that key to `base_url`.
 */
export function kernelCallClientOptions(route: ResolvedRoute, provider: string, timeoutMs: number): Record<string, unknown> {
	return {
		base_url: route.baseUrl,
		api_key: route.apiKey ?? "",
		model: route.modelId,
		headers: { ...route.headers },
		...(Number.isFinite(timeoutMs) && timeoutMs > 0 && { http: { request_timeout_ms: Math.ceil(timeoutMs) } }),
		...(provider === "openai-responses" && { store: false, reasoning: { effort: route.reasoning } }),
	};
}

export async function invokeNative(
	baml: BamlRuntimeLike,
	fn: BamlCallable,
	req: EngineInvoke,
	retryPolicy: string | undefined,
): Promise<EngineRun> {
	const { route } = req;
	const provider = bamlProviderFor(route.api);
	if (provider === undefined) {
		return routeFailure(`no BAML provider for Pi api "${route.api}"; use transport "pi" for this function`);
	}
	// resolveCallRoute refuses these first; a route built elsewhere is refused here, before BAML sees it.
	if (findShortCredential(route.headers, [route.apiKey]) !== undefined) {
		return routeFailure(SHORT_CREDENTIAL_MESSAGE);
	}

	let collector: InstanceType<BamlRuntimeLike["Collector"]> | undefined;
	let result: { ok: true; value: unknown } | { ok: false; error: unknown };
	try {
		collector = new baml.Collector(req.tags.runId ?? req.name);
		const registry = new baml.ClientRegistry();
		registry.addLlmClient(KERNEL_CALL_CLIENT, provider, kernelCallClientOptions(route, provider, req.timeoutMs), retryPolicy ?? null);
		registry.setPrimary(KERNEL_CALL_CLIENT);
		const options = {
			collector,
			clientRegistry: registry,
			tags: { ...req.tags },
			env: bamlCallEnv(),
			...(req.signal !== undefined && { signal: req.signal }),
			...(isStreamOnlyRoute(route.baseUrl) && { onTick: () => {} }),
		};
		result = { ok: true, value: await fn(...req.args, options) };
	} catch (error) {
		result = { ok: false, error };
	}

	const log = collector ? lastFunctionLog(collector) : null;
	const rawText = rawLlmText(log);
	const attempts = attemptsFromLog(log, route.modelId);
	const outcome = result.ok
		? { ok: true as const, value: result.value, attempts, rawText }
		: { ok: false as const, failure: classifyBamlError(baml, result.error, rawText), attempts, rawText };
	return { outcome, secrets: mergeSecrets(req.secrets, routeSecrets(route)) };
}

/**
 * A refusal before BAML sees anything: the outcome holds only fixed text, so
 * it is not scrubbed (a refused 1–7 character credential would otherwise be
 * replaced inside ordinary words).
 */
function routeFailure(message: string): EngineRun {
	return { outcome: { ok: false, failure: { kind: "route", message }, attempts: [], rawText: null }, secrets: [] };
}
