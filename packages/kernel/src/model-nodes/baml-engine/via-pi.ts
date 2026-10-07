/**
 * The Pi-transport path (plan §4.2 rule 9): BAML renders and parses, Pi
 * sends. Rendering never touches a static client or the environment: each
 * invoke builds an inert registry (`KernelRender`, a `.invalid` base URL, a
 * placeholder key) and `b.request` does no HTTP. The system and message
 * text of the rendered Responses request go to `transport.complete`, and
 * its text to `b.parse`.
 */
import { PI_TRANSPORT_NOT_ROUTED_MESSAGE, PI_TRANSPORT_UNSUPPORTED_MESSAGE, SHORT_CREDENTIAL_MESSAGE } from "../pi-models";
import { mergeSecrets } from "../redact";
import type { CallFailure, EngineAttempt, PiTransport, PiTransportRequest } from "../types";
import type { BamlClientRegistryLike, BamlHttpRequestLike, BamlRuntimeLike } from "./baml-runtime-types";
import { classifyBamlError, errorMessage } from "./classify";
import type { BamlCallable } from "./client";
import { bamlCallEnv } from "./log-level";
import { routeSecrets, type EngineInvoke, type EngineRun } from "./outcome";

export const KERNEL_RENDER_CLIENT = "KernelRender";
export const RENDER_BASE_URL = "http://render.invalid/v1";
export const RENDER_API_KEY = "render-only";

/** Refusals by the kernel's Pi transport before or instead of sending: route failures, fail closed. */
const ROUTE_REFUSALS: ReadonlySet<string> = new Set([
	SHORT_CREDENTIAL_MESSAGE,
	PI_TRANSPORT_UNSUPPORTED_MESSAGE,
	PI_TRANSPORT_NOT_ROUTED_MESSAGE,
]);

/** A one-leaf openai-responses registry that can only render: nothing it names resolves or authenticates. */
export function inertRenderRegistry(baml: BamlRuntimeLike, modelId: string): BamlClientRegistryLike {
	const registry = new baml.ClientRegistry();
	registry.addLlmClient(KERNEL_RENDER_CLIENT, "openai-responses", {
		base_url: RENDER_BASE_URL,
		api_key: RENDER_API_KEY,
		model: modelId,
	});
	registry.setPrimary(KERNEL_RENDER_CLIENT);
	return registry;
}

export async function invokeViaPi(
	baml: BamlRuntimeLike,
	render: BamlCallable,
	parse: BamlCallable,
	req: EngineInvoke,
): Promise<EngineRun> {
	if (req.signal?.aborted) return failed(req, { kind: "aborted" });

	let registry: BamlClientRegistryLike;
	let prompt: Omit<PiTransportRequest, "signal" | "timeoutMs">;
	try {
		registry = inertRenderRegistry(baml, req.route.modelId);
		const rendered = (await render(...req.args, { clientRegistry: registry, env: bamlCallEnv() })) as BamlHttpRequestLike;
		const extracted = promptFromResponsesBody(rendered.body.json());
		if (!extracted.ok) return failed(req, { kind: "other", message: extracted.message });
		prompt = extracted.prompt;
	} catch (error) {
		return failed(req, classifyBamlError(baml, error, null));
	}

	let completed: Awaited<ReturnType<PiTransport["complete"]>>;
	try {
		completed = await req.transport.complete({
			...prompt,
			...(req.signal !== undefined && { signal: req.signal }),
			timeoutMs: req.timeoutMs,
		});
	} catch (error) {
		return failed(req, req.signal?.aborted ? { kind: "aborted" } : { kind: "other", message: errorMessage(error) });
	}

	const secrets = mergeSecrets(req.secrets, routeSecrets(req.route), completed.secrets ?? []);
	const attempts = [completed.attempt];
	const text = completed.text;
	if (text === null) {
		return { outcome: { ok: false, failure: transportFailure(completed, req.signal), attempts, rawText: null }, secrets };
	}
	try {
		const value = await parse(text, { clientRegistry: registry, env: bamlCallEnv() });
		return { outcome: { ok: true, value, attempts, rawText: text }, secrets };
	} catch (error) {
		const failure: CallFailure = { kind: "parse", message: errorMessage(error), rawOutput: text };
		return { outcome: { ok: false, failure, attempts, rawText: text }, secrets };
	}
}

function failed(req: EngineInvoke, failure: CallFailure): EngineRun {
	return { outcome: { ok: false, failure, attempts: [], rawText: null }, secrets: req.secrets };
}

/**
 * The Responses request BAML rendered, as a Pi prompt: `system`/`developer`
 * text (and `instructions`) becomes the system prompt, `user`/`assistant`
 * messages keep their order. Non-text content cannot ride the text-only Pi
 * transport and fails the call.
 */
export function promptFromResponsesBody(
	body: unknown,
): { ok: true; prompt: Omit<PiTransportRequest, "signal" | "timeoutMs"> } | { ok: false; message: string } {
	const request = record(body);
	const input = request?.input;
	if (!Array.isArray(input)) return { ok: false, message: "rendered request has no Responses input" };
	const system: string[] = [];
	if (typeof request?.instructions === "string" && request.instructions.length > 0) system.push(request.instructions);
	const messages: PiTransportRequest["messages"] = [];
	for (const item of input) {
		const role = record(item)?.role;
		const text = textOf(record(item)?.content);
		if (text === undefined) {
			return { ok: false, message: `rendered ${String(role)} message has non-text content; the Pi transport sends text only` };
		}
		if (role === "system" || role === "developer") system.push(text);
		else if (role === "user" || role === "assistant") messages.push({ role, text });
		else return { ok: false, message: `rendered message role "${String(role)}" is not supported by the Pi transport` };
	}
	return { ok: true, prompt: { ...(system.length > 0 && { systemPrompt: system.join("\n") }), messages } };
}

function textOf(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const parts: string[] = [];
	for (const part of content) {
		const text = record(part)?.text;
		if (typeof text !== "string") return undefined;
		parts.push(text);
	}
	return parts.join("\n");
}

function transportFailure(completed: { attempt: EngineAttempt; errorMessage?: string }, signal?: AbortSignal): CallFailure {
	const message = completed.errorMessage ?? "pi transport returned no text";
	if (ROUTE_REFUSALS.has(message)) return { kind: "route", message };
	if (signal?.aborted) return { kind: "aborted" };
	const status = completed.attempt.status;
	if (status !== null && status >= 400) {
		return { kind: "http", status, rawResponse: rawResponseOf(completed.attempt) ?? message };
	}
	if (/\btime(?:d)? ?out\b/i.test(message)) return { kind: "timeout" };
	return { kind: "other", message };
}

function rawResponseOf(attempt: EngineAttempt): string | undefined {
	const response = attempt.response;
	if (!response || !("body" in response) || response.body === null || response.body === undefined) return undefined;
	return typeof response.body === "string" ? response.body : JSON.stringify(response.body);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
