/**
 * `kernel.step` (plan §3.6, §4.4, §4.6): a deterministic code step recorded
 * as a step_start/step_end span pair on its parent run. Steps record; they do
 * not gate: a failed step_start write is logged and the callback still runs,
 * a failed step_end write is logged, and the callback's own result or error
 * always reaches the caller.
 *
 * Envelope: runId = the parent run (if any), no piSessionUuid, spanId = the
 * step span. Inside a gate, gate_span_id and parentEventId = gate_start id.
 */
import { randomUUID } from "node:crypto";

import { insertTraceEventsBatch, type KernelDatabase } from "@agent-kernel/db";
import {
	createStepEndEvent,
	createStepStartEvent,
	kernelNodeEventId,
	kernelRequestId,
	type StepEndData,
	type StepStartData,
	type TraceEventIds,
} from "@agent-kernel/protocol";

import type { ModelNodeContext } from "../context";
import { resolveNodeScope } from "../scope";
import {
	KernelNodeError,
	type JsonValue,
	type KernelStepFn,
	type StepAttributeValue,
	type StepSpan,
} from "../types";

/** step_end.output_summary cap (UTF-8 bytes of the JSON). */
export const STEP_SUMMARY_MAX_BYTES = 4096;
/** step_end.events cap; later addEvent calls are dropped. */
export const STEP_MAX_EVENTS = 20;

type Attributes = Record<string, StepAttributeValue>;

/** Where a span hangs: its container and, when known, its parent run. */
export interface SpanScope {
	containerId: string;
	parentRunId?: string;
}

/** A step check's verdict, written to step_end.check_result / check_value. */
export interface StepCheckFields {
	check_result: "pass" | "fail" | "abstain";
	check_value?: string | number | boolean | null;
}

export type StepSettled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface RecordStepInput<T> {
	name: string;
	scope: SpanScope;
	spanId: string;
	attributes?: Attributes;
	summarize?: (result: T) => JsonValue;
	/** Inside a gate: the gate span and its gate_start event id. */
	gate?: { spanId: string; startEventId: string };
	/** Inside a gate: the check verdict written to step_end, from how the callback settled. */
	check?: (settled: StepSettled<T>) => StepCheckFields;
}

export function createStep(ctx: ModelNodeContext): KernelStepFn {
	return async (name, opts, fn) => {
		assertSpanName("step", name);
		const scope = await resolveSpanScope(ctx, opts);
		const spanId = spanIdFor(ctx, opts.requestId);
		const settled = await recordStep(ctx, fn, {
			name,
			scope,
			spanId,
			...(opts.attributes !== undefined && { attributes: opts.attributes }),
			...(opts.summarize !== undefined && { summarize: opts.summarize }),
		});
		if (!settled.ok) throw settled.error;
		return settled.value;
	};
}

/** Span id: deterministic from requestId (re-emission dedupes, §4.6), else random. */
export function spanIdFor(ctx: ModelNodeContext, requestId: string | undefined): string {
	return requestId === undefined ? randomUUID() : kernelRequestId(ctx.kernelId, "span", requestId);
}

/** Deterministic event id inside a step or gate span (§4.4: scopeKey "span:" + span id). */
export function spanEventId(spanId: string, type: string): string {
	return kernelNodeEventId(`span:${spanId}`, 0, type);
}

/** Container and parent run for a step or gate; rejects before any write (§4.6). */
export async function resolveSpanScope(
	ctx: ModelNodeContext,
	opts: { containerId?: string; parentRunId?: string },
): Promise<SpanScope> {
	const scope = await resolveNodeScope(
		{
			...(opts.containerId !== undefined && { containerId: opts.containerId }),
			...(opts.parentRunId !== undefined && { parentRunId: opts.parentRunId }),
		},
		{ db: ctx.db() },
	);
	return {
		containerId: scope.containerId,
		...(scope.parentRunId !== undefined && { parentRunId: scope.parentRunId }),
	};
}

export function assertSpanName(kind: "step" | "gate" | "check", name: unknown): void {
	if (typeof name !== "string" || name.length === 0) {
		throw new KernelNodeError("invalid-request", `${kind} name must be a non-empty string`);
	}
}

/** Envelope ids for step and gate events: the parent run, never a Pi session. */
export function spanTraceIds(scope: SpanScope): TraceEventIds {
	return {
		containerId: scope.containerId,
		...(scope.parentRunId !== undefined && { runId: scope.parentRunId }),
	};
}

/**
 * Writes step_start (awaited), runs the callback, writes step_end (awaited),
 * and returns how the callback settled. Never rejects for a write failure or
 * a callback error; both are reported through `settled` and the logger.
 */
export async function recordStep<T>(
	ctx: ModelNodeContext,
	fn: (span: StepSpan) => T | Promise<T>,
	input: RecordStepInput<T>,
): Promise<StepSettled<T>> {
	const db = ctx.db();
	const ids = spanTraceIds(input.scope);
	const startEventId = spanEventId(input.spanId, "step_start");
	const parentEventId = input.gate?.startEventId;
	const gateSpanId = input.gate?.spanId;
	const logIds = { spanId: input.spanId, step: input.name, ...(gateSpanId !== undefined && { gateSpanId }) };

	await ctx.ensureSchema();
	const startMs = ctx.clock.nextMs();
	const startData: StepStartData = {
		step_name: input.name,
		...(input.attributes !== undefined && Object.keys(input.attributes).length > 0 && {
			attributes: { ...input.attributes },
		}),
		...(gateSpanId !== undefined && { gate_span_id: gateSpanId }),
	};
	await insertOrLog(ctx, db, "step start write failed", logIds, () =>
		createStepStartEvent(ids, startData, {
			eventId: startEventId,
			spanId: input.spanId,
			...(parentEventId !== undefined && { parentEventId }),
			timestamp: new Date(startMs).toISOString(),
		}),
	);

	const span = new RecordingSpan(input.spanId, startMs, ctx.clock.now);
	let settled: StepSettled<T>;
	try {
		settled = { ok: true, value: await fn(span) };
	} catch (error) {
		settled = { ok: false, error };
	}
	span.close();

	const endMs = ctx.clock.nextMs();
	const status = settled.ok ? (span.status?.status ?? "ok") : "error";
	const errorMessage = settled.ok ? span.status?.message : errorMessageOf(settled.error);
	const summary = settled.ok && input.summarize ? summarizeOrLog(ctx, input.summarize, settled.value, logIds) : undefined;
	const check = input.check?.(settled);
	const endData: StepEndData = {
		step_name: input.name,
		status,
		duration_ms: Math.max(0, endMs - startMs),
		...(Object.keys(span.attributes).length > 0 && { attributes: span.attributes }),
		...(span.events.length > 0 && { events: span.events }),
		...(summary !== undefined && { output_summary: summary }),
		...(status === "error" && errorMessage !== undefined && { error_message: errorMessage }),
		...(check !== undefined && { check_result: check.check_result }),
		...(check?.check_value !== undefined && { check_value: check.check_value }),
		...(gateSpanId !== undefined && { gate_span_id: gateSpanId }),
	};
	await insertOrLog(ctx, db, "step end write failed", logIds, () =>
		createStepEndEvent(ids, endData, {
			eventId: spanEventId(input.spanId, "step_end"),
			spanId: input.spanId,
			...(parentEventId !== undefined && { parentEventId }),
			timestamp: new Date(endMs).toISOString(),
		}),
	);
	return settled;
}

class RecordingSpan implements StepSpan {
	readonly attributes: Attributes = {};
	readonly events: NonNullable<StepEndData["events"]> = [];
	status: { status: "ok" | "error"; message?: string } | undefined;
	private closed = false;

	constructor(
		readonly spanId: string,
		private readonly startMs: number,
		private readonly now: () => number,
	) {}

	setAttributes(attrs: Attributes): void {
		if (!this.closed) Object.assign(this.attributes, attrs);
	}

	setStatus(status: "ok" | "error", message?: string): void {
		if (!this.closed) this.status = { status, ...(message !== undefined && { message }) };
	}

	addEvent(name: string, attrs?: Attributes): void {
		if (this.closed || this.events.length >= STEP_MAX_EVENTS) return;
		this.events.push({
			name,
			// ms since the step started
			at_ms: Math.max(0, this.now() - this.startMs),
			...(attrs !== undefined && Object.keys(attrs).length > 0 && { attributes: { ...attrs } }),
		});
	}

	/** The span is ended; later calls are ignored (step_end is already built). */
	close(): void {
		this.closed = true;
	}
}

/** The summary as JSON, or `{ truncated: true, bytes }` over the cap. A throwing summarize is logged and omitted. */
function summarizeOrLog<T>(
	ctx: ModelNodeContext,
	summarize: (result: T) => JsonValue,
	value: T,
	logIds: Record<string, unknown>,
): unknown {
	let json: string | undefined;
	try {
		json = JSON.stringify(summarize(value));
	} catch (error) {
		ctx.logger?.warn("step summarize failed", { ...logIds, error: errorName(error) });
		return undefined;
	}
	if (json === undefined) return undefined;
	const bytes = Buffer.byteLength(json, "utf8");
	return bytes > STEP_SUMMARY_MAX_BYTES ? { truncated: true, bytes } : (JSON.parse(json) as unknown);
}

/** Awaited insert of one span event; a failure is logged by id only (§4.6 steps). */
async function insertOrLog(
	ctx: ModelNodeContext,
	db: KernelDatabase,
	message: string,
	logIds: Record<string, unknown>,
	build: () => Parameters<typeof insertTraceEventsBatch>[1][number],
): Promise<void> {
	try {
		await insertTraceEventsBatch(db, [build()]);
	} catch (error) {
		ctx.logger?.error(message, { ...logIds, error: errorName(error) });
	}
}

/** The harness's own error message for step_end.error_message / a check's `error`. */
export function errorMessageOf(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	return String(error);
}

/** Error name only, for logs (§4.7): messages may embed payloads. */
export function errorName(error: unknown): string {
	if (error instanceof KernelNodeError) return `${error.name}(${error.code})`;
	if (error instanceof Error) return error.name;
	return typeof error;
}
