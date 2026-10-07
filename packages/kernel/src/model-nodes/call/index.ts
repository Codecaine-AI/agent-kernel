/**
 * `kernel.call` (plan §3.4): one typed model request through the kernel's
 * CallEngine, traced as a call node.
 *
 * Order: validate (engine, function, options, scope; KernelNodeError, no
 * rows) → resolve the model ref (opts → manifest → models.defaults.call →
 * aliases) and its Pi route with the preflight secret set → runModelNode
 * (coalescing, replay / stale recovery, acknowledged claim) → engine.invoke
 * under the operation deadline → attempts become snapshots and turns → one
 * acknowledged completion → the value, or KernelCallError.
 *
 * A route failure (unknown model, missing or short credential) is recorded:
 * the node is claimed, closed as an error without invoking the engine, and
 * the call throws KernelCallError({ kind: "route" }).
 *
 * Secrets (§4.7): the engine receives the preflight set (route api key and
 * sensitive route headers). The Pi transport handed to the engine reads the
 * actual outbound headers; the kernel wraps it to collect every set it
 * returns, and redacts all persisted content again with the union.
 */
import { getTraceBlob } from "@agent-kernel/db";
import type { CallEndData } from "@agent-kernel/protocol";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

import { jsonBlob, textBlob } from "../blobs";
import { resolveModelAlias, type CallNodeContext } from "../context";
import { runModelNode, type NodeEndFields, type NodeExecution, type NodeRunHandle } from "../node-run";
import { createPiTransport, resolveCallRoute, splitModelRef, type CallRouteResult } from "../pi-models";
import { sumNodeUsage } from "../pricing";
import { mergeSecrets, redactDeep, redactText } from "../redact";
import { resolveNodeScope } from "../scope";
import {
	DEFAULT_CALL_REASONING,
	DEFAULT_CALL_TIMEOUT_MS,
	KernelCallError,
	KernelNodeError,
	type CallArgs,
	type CallEngine,
	type CallFailure,
	type EngineAttempt,
	type FnName,
	type KernelCallFn,
	type KernelCallOptions,
	type KernelCallResult,
	type KernelCallsConfig,
	type PiTransport,
} from "../types";
import { attemptsToEvents } from "./attempts-to-events";

type Reasoning = "low" | "medium" | "high";
const REASONING_LEVELS: readonly string[] = ["low", "medium", "high"];

/** What one call node resolves to; KernelCallError is thrown after the completion committed. */
type CallOutcome = { ok: true; value: unknown } | { ok: false; error: KernelCallError };

type CallRoute = (Extract<CallRouteResult, { ok: true }> & { registry: ModelRegistry }) | Extract<CallRouteResult, { ok: false }>;

/** Called once per kernel from createKernel; throws on an invalid `ctx.calls`. */
export function createCall<TCalls>(ctx: CallNodeContext<TCalls>): KernelCallFn<TCalls> {
	const calls = ctx.calls;
	if (calls) validateCallsConfig(calls);

	return async <K extends FnName<TCalls>>(
		name: K,
		args: CallArgs<TCalls, K>,
		opts: KernelCallOptions = {},
	): Promise<KernelCallResult<TCalls, K>> => {
		// 1. Validate: nothing is written on any of these failures.
		if (!calls) throw new KernelNodeError("no-engine", "kernel.call requires config.calls with a CallEngine");
		const { engine } = calls;
		if (!engine.functionNames().includes(name)) {
			throw new KernelNodeError("unknown-function", `${name} is not a function of the configured call engine`);
		}
		const timeoutMs = opts.timeoutMs ?? calls.defaultTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
		if (!isPositiveFinite(timeoutMs)) {
			throw new KernelNodeError("invalid-request", `${name}: timeoutMs must be a positive finite number`);
		}
		const reasoning = opts.reasoning ?? calls.reasoning ?? DEFAULT_CALL_REASONING;
		if (!REASONING_LEVELS.includes(reasoning)) {
			throw new KernelNodeError("invalid-request", `${name}: reasoning must be low, medium or high`);
		}
		const modelRef = opts.model ?? engine.manifest(name)?.model ?? ctx.models.defaults.call;
		if (!modelRef) {
			throw new KernelNodeError(
				"invalid-request",
				`${name}: no model; pass opts.model, set the manifest model, or set models.defaults.call`,
			);
		}
		const db = ctx.db();
		const scope = await resolveNodeScope(
			{
				...(opts.containerId !== undefined && { containerId: opts.containerId }),
				...(opts.parentRunId !== undefined && { parentRunId: opts.parentRunId }),
				...(opts.parentToolUseId !== undefined && { parentToolUseId: opts.parentToolUseId }),
				...(opts.displayLabel !== undefined && { displayLabel: opts.displayLabel }),
				...(opts.trigger !== undefined && { trigger: opts.trigger }),
			},
			{ db },
		);

		// 2. Model and route. A route failure is recorded below, not thrown here.
		const model = resolveModelAlias(modelRef, ctx.models.aliases);
		const route = await resolveRoute(ctx, model, reasoning);
		const preflight = route.ok ? route.secrets : [];
		const promptHash = engine.promptHash(name);
		const input = jsonBlob("call-input", redactDeep(args, preflight), new Date(ctx.clock.now()).toISOString());
		const provider = route.ok ? route.route.provider : splitModelRef(model)?.provider;

		let outcome: CallOutcome;
		try {
			const result = await runModelNode<CallOutcome>(ctx, {
				kind: "call",
				name,
				scope,
				...(opts.requestId !== undefined && { requestId: opts.requestId }),
				...(opts.signal !== undefined && { signal: opts.signal }),
				...(opts.onNodeStarted !== undefined && { onNodeStarted: opts.onNodeStarted }),
				deadlineMs: timeoutMs,
				start: {
					engine: engine.engine,
					transport: engine.transportFor(name),
					model,
					...(modelRef !== model && { model_alias: modelRef }),
					...(provider !== undefined && { provider }),
					...(route.ok && { api: route.route.api }),
					prompt_hash: promptHash,
					input_blob_hash: input.hash,
				},
				startBlobs: [input.blob],
				execute: (run) =>
					executeCall(ctx, run, {
						engine,
						name,
						args,
						route,
						timeoutMs,
						promptHash,
						...(opts.signal !== undefined && { callerSignal: opts.signal }),
					}),
				async replay({ db: replayDb, ids, events }) {
					const end = events.find((event) => event.type === "call_end")?.eventData as CallEndData | undefined;
					const hash = end?.status === "ok" ? end.output_blob_hash : undefined;
					const blob = hash ? await getTraceBlob(replayDb, hash) : null;
					if (!blob) {
						throw new KernelNodeError("row-write-failed", `call ${name}: run ${ids.runId} has no stored output to replay`);
					}
					return { ok: true, value: JSON.parse(Buffer.from(blob.data).toString("utf8")) as unknown };
				},
			});
			outcome = result.outcome;
		} catch (error) {
			throw withCallValue(error);
		}
		if (!outcome.ok) throw outcome.error;
		return outcome.value as KernelCallResult<TCalls, K>;
	};
}

interface ExecuteCallInput<TCalls, K extends FnName<TCalls>> {
	engine: CallEngine<TCalls>;
	name: K;
	args: CallArgs<TCalls, K>;
	route: CallRoute;
	timeoutMs: number;
	promptHash: string;
	callerSignal?: AbortSignal;
}

/** Steps 6–8 of §3.4: invoke the engine (only after the committed claim) and build the outcome. */
async function executeCall<TCalls, K extends FnName<TCalls>>(
	ctx: CallNodeContext<TCalls>,
	run: NodeRunHandle,
	input: ExecuteCallInput<TCalls, K>,
): Promise<NodeExecution<CallOutcome>> {
	const { route, name } = input;
	if (!route.ok) return failedExecution(ctx, run, name, route.failure, { attempts: [], rawText: null }, []);

	// Outbound credential sets the Pi transport returns (it reads the real request headers).
	const outbound: string[][] = [];
	const piTransport = createPiTransport(route.registry, route.model, {
		reasoning: route.route.reasoning,
		secrets: route.secrets,
	});
	const transport: PiTransport = {
		async complete(req) {
			const signal = req.signal && req.signal !== run.signal ? AbortSignal.any([req.signal, run.signal]) : run.signal;
			const out = await piTransport.complete({ ...req, signal, timeoutMs: req.timeoutMs ?? input.timeoutMs });
			outbound.push(out.secrets);
			return out;
		},
	};

	const outcome = await input.engine.invoke({
		name,
		args: input.args,
		route: route.route,
		transport,
		signal: run.signal,
		timeoutMs: input.timeoutMs,
		tags: { runId: run.ids.runId, containerId: run.ids.containerId, functionName: name },
		secrets: route.secrets,
	});
	const secrets = mergeSecrets(route.secrets, ...outbound);

	if (!outcome.ok) {
		const aborted = outcome.failure.kind === "aborted" || run.signal.aborted;
		const failure: CallFailure = aborted
			? input.callerSignal?.aborted !== true && run.deadlineExceeded()
				? { kind: "timeout" }
				: { kind: "aborted" }
			: outcome.failure;
		return failedExecution(ctx, run, name, failure, outcome, secrets, {
			aborted,
			promptHash: input.promptHash,
			provider: route.route.provider,
		});
	}

	const turns = attemptsToEvents(run, {
		attempts: outcome.attempts,
		secrets,
		promptHash: input.promptHash,
		provider: route.route.provider,
		...(ctx.models.prices !== undefined && { prices: ctx.models.prices }),
		selectedStopReason: "stop",
	});
	const output = jsonBlob("call-output", redactDeep(outcome.value, secrets), run.timestamp());
	const usage = sumNodeUsage(turns.usages);
	ctx.logger?.debug("model call done", { name, runId: run.ids.runId, attempts: outcome.attempts.length });
	return {
		outcome: { ok: true, value: outcome.value },
		runStatus: "done",
		end: {
			status: "ok",
			output_blob_hash: output.hash,
			...(usage !== undefined && { usage }),
			attempts: outcome.attempts.length,
			...(turns.resolvedModel !== undefined && { resolved_model: turns.resolvedModel }),
		},
		events: turns.events,
		blobs: [...turns.blobs, output.blob],
	};
}

/**
 * Closes a failed call: status error (aborted for an abort or the deadline),
 * the attempts' turns, and the raw model text as a call-raw-output blob on
 * call_end.output_blob_hash. The thrown KernelCallError carries the redacted
 * failure; call_end's message is kernel-written and never holds prompt or
 * output text.
 */
function failedExecution<TCalls>(
	ctx: CallNodeContext<TCalls>,
	run: NodeRunHandle,
	name: string,
	failure: CallFailure,
	engineOutcome: { attempts: readonly EngineAttempt[]; rawText: string | null },
	secrets: readonly string[],
	opts: { aborted?: boolean; promptHash?: string; provider?: string } = {},
): NodeExecution<CallOutcome> {
	const scrubbed = redactDeep(failure, secrets);
	const turns =
		engineOutcome.attempts.length > 0 && opts.promptHash !== undefined && opts.provider !== undefined
			? attemptsToEvents(run, {
					attempts: engineOutcome.attempts,
					secrets,
					promptHash: opts.promptHash,
					provider: opts.provider,
					...(ctx.models.prices !== undefined && { prices: ctx.models.prices }),
					selectedStopReason: stopReasonOf(scrubbed),
				})
			: undefined;
	const rawText = engineOutcome.rawText ?? ("rawOutput" in failure ? failure.rawOutput : null);
	const raw = rawText !== null ? textBlob("call-raw-output", redactText(rawText, secrets), run.timestamp()) : undefined;
	const usage = turns ? sumNodeUsage(turns.usages) : undefined;
	const end: NodeEndFields = {
		status: opts.aborted ? "aborted" : "error",
		...(raw !== undefined && { output_blob_hash: raw.hash }),
		error: {
			kind: scrubbed.kind,
			message: failureMessage(scrubbed),
			...(scrubbed.kind === "http" && { http_status: scrubbed.status }),
		},
		...(usage !== undefined && { usage }),
		attempts: engineOutcome.attempts.length,
		...(turns?.resolvedModel !== undefined && { resolved_model: turns.resolvedModel }),
	};
	ctx.logger?.info("model call failed", {
		name,
		runId: run.ids.runId,
		kind: scrubbed.kind,
		attempts: engineOutcome.attempts.length,
	});
	return {
		outcome: { ok: false, error: new KernelCallError(name, run.ids.runId, scrubbed) },
		runStatus: opts.aborted ? "aborted" : "error",
		end,
		events: turns?.events ?? [],
		blobs: [...(turns?.blobs ?? []), ...(raw ? [raw.blob] : [])],
	};
}

/** call_end.error.message: kernel-written, no prompt or model text (§4.7). */
function failureMessage(failure: CallFailure): string {
	switch (failure.kind) {
		case "parse":
			return "model output did not parse";
		case "http":
			return `HTTP ${failure.status}`;
		case "timeout":
			return "timed out";
		case "aborted":
			return "aborted";
		case "finish_reason":
			return `model stopped: ${failure.finishReason ?? "unknown finish reason"}`;
		case "route":
			return failure.message;
		case "other":
			return "engine error";
	}
}

function stopReasonOf(failure: CallFailure): string {
	if (failure.kind === "aborted" || failure.kind === "timeout") return "aborted";
	if (failure.kind === "finish_reason") return failure.finishReason ?? "length";
	return "error";
}

async function resolveRoute<TCalls>(ctx: CallNodeContext<TCalls>, model: string, reasoning: Reasoning): Promise<CallRoute> {
	try {
		const registry = await ctx.piModels().registry();
		const result = await resolveCallRoute(registry, model, reasoning);
		return result.ok ? { ...result, registry } : result;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { ok: false, failure: { kind: "route", message: `Pi models unavailable: ${reason}` } };
	}
}

/**
 * runModelNode attaches the internal outcome to a completion-write failure;
 * the caller gets the call's value instead (§4.6: `error.value`).
 */
function withCallValue(error: unknown): unknown {
	if (!(error instanceof KernelNodeError) || error.code !== "row-write-failed" || !isCallOutcome(error.value)) {
		return error;
	}
	const outcome = error.value;
	return new KernelNodeError("row-write-failed", error.message, {
		cause: error.cause,
		...(outcome.ok && { value: outcome.value }),
	});
}

function isCallOutcome(value: unknown): value is CallOutcome {
	return value !== null && typeof value === "object" && typeof (value as { ok?: unknown }).ok === "boolean";
}

function validateCallsConfig<TCalls>(calls: KernelCallsConfig<TCalls>): void {
	if (!calls.engine || typeof calls.engine.invoke !== "function") {
		throw new KernelNodeError("invalid-request", "config.calls.engine must be a CallEngine");
	}
	if (calls.defaultTimeoutMs !== undefined && !isPositiveFinite(calls.defaultTimeoutMs)) {
		throw new KernelNodeError("invalid-request", "config.calls.defaultTimeoutMs must be a positive finite number");
	}
	if (calls.reasoning !== undefined && !REASONING_LEVELS.includes(calls.reasoning)) {
		throw new KernelNodeError("invalid-request", "config.calls.reasoning must be low, medium or high");
	}
}

function isPositiveFinite(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}
