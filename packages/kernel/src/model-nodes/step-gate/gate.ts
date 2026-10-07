/**
 * `kernel.gate` (plan §3.6, §4.4, §4.6): ordered step and decide checks
 * combined into one verdict, recorded as a gate_start/gate_end span pair.
 *
 * - Every check is validated (decide questions included) before gate_start,
 *   so a validation error never leaves an open gate.
 * - gate_start is an awaited insert before any check runs; its failure
 *   rejects with KernelNodeError("row-write-failed").
 * - Once gate_start is acknowledged, gate_end is always attempted. Its
 *   failure rejects with row-write-failed (the computed result attached);
 *   the caller never receives a verdict that was not persisted.
 * - A decide check whose decide rejects is recorded as `abstain` with
 *   `error: "<code>"` (a check that produced no verdict never passes, and a
 *   kernel failure is no evidence against the subject); the remaining checks
 *   are skipped, gate_end is written, then KernelGateError is thrown.
 * - A thrown step check is `fail` with its error; the loop continues.
 * - The signal is checked before each check; an abort skips the rest and a
 *   cancelled gate never passes.
 */
import { insertTraceEventsBatch } from "@agent-kernel/db";
import {
	createGateEndEvent,
	createGateStartEvent,
	kernelNodeEventId,
	type GateCheckRecord,
	type GateEndData,
	type GateStartData,
} from "@agent-kernel/protocol";

import type { ModelNodeContext } from "../context";
import { decideInternal, validateDecideRequest } from "../decide";
import { callOptionIssues } from "../decide/validate";
import {
	KernelDecideValidationError,
	KernelGateError,
	KernelNodeError,
	type CheckResult,
	type GateCheckResult,
	type GateCheckSpec,
	type GateResult,
	type GateStepOutcome,
	type JsonPrimitive,
	type KernelGateFn,
} from "../types";
import {
	assertSpanName,
	errorMessageOf,
	errorName,
	recordStep,
	resolveSpanScope,
	spanEventId,
	spanIdFor,
	spanTraceIds,
	type SpanScope,
	type StepSettled,
} from "./step";

type StepCheck = Extract<GateCheckSpec, { kind: "step" }>;
type DecideCheck = Extract<GateCheckSpec, { kind: "decide" }>;

export function createGate(ctx: ModelNodeContext): KernelGateFn {
	return async (name, opts, checks) => {
		assertSpanName("gate", name);
		validateChecks(ctx, checks, opts.stopOn);
		const scope = await resolveSpanScope(ctx, opts);

		const db = ctx.db();
		const spanId = spanIdFor(ctx, opts.requestId);
		const ids = spanTraceIds(scope);
		const startEventId = spanEventId(spanId, "gate_start");
		const logIds = { spanId, gate: name };

		await ctx.ensureSchema();
		const startMs = ctx.clock.nextMs();
		const startData: GateStartData = {
			gate_name: name,
			checks: checks.map((check) => ({ name: check.name, kind: check.kind })),
		};
		try {
			await insertTraceEventsBatch(db, [
				createGateStartEvent(ids, startData, {
					eventId: startEventId,
					spanId,
					timestamp: new Date(startMs).toISOString(),
				}),
			]);
		} catch (error) {
			ctx.logger?.error("gate start write failed", { ...logIds, error: errorName(error) });
			throw new KernelNodeError("row-write-failed", `gate ${name}: start write failed`, { cause: error });
		}

		// gate_start is acknowledged: from here every exit writes gate_end first.
		const run = await runChecks(ctx, checks, {
			scope,
			gate: { spanId, startEventId },
			stopOn: opts.stopOn ?? "never",
			...(opts.requestId !== undefined && { requestId: opts.requestId }),
			...(opts.signal !== undefined && { signal: opts.signal }),
		});

		const endMs = ctx.clock.nextMs();
		const result: GateResult = {
			gateName: name,
			spanId,
			verdict: combineVerdict(run.outcomes.map((o) => o.result), run.aborted),
			aborted: run.aborted,
			checks: run.outcomes.map(({ stepSpanId: _stepSpanId, ...check }) => check),
			durationMs: Math.max(0, endMs - startMs),
		};
		const endData: GateEndData = {
			gate_name: name,
			verdict: result.verdict,
			...(result.aborted && { aborted: true }),
			checks: run.outcomes.map(toCheckRecord),
			duration_ms: result.durationMs,
		};
		try {
			await insertTraceEventsBatch(db, [
				createGateEndEvent(ids, endData, {
					eventId: spanEventId(spanId, "gate_end"),
					spanId,
					timestamp: new Date(endMs).toISOString(),
				}),
			]);
		} catch (error) {
			ctx.logger?.error("gate end write failed", { ...logIds, verdict: result.verdict, error: errorName(error) });
			throw new KernelNodeError("row-write-failed", `gate ${name}: end write failed`, {
				cause: error,
				gateResult: result,
			});
		}

		if (run.rejection) throw new KernelGateError(result, run.rejection.error);
		return result;
	};
}

/**
 * The gate verdict (§3.6): any fail → fail; else any abstain or skipped →
 * abstain; else pass. A gate whose signal fired never passes.
 */
function combineVerdict(results: readonly CheckResult[], aborted: boolean): GateResult["verdict"] {
	if (results.includes("fail")) return "fail";
	if (aborted || results.length === 0 || results.some((r) => r !== "pass")) return "abstain";
	return "pass";
}

// ── validation (before gate_start) ────────────────────────────────────────────

function validateChecks(ctx: ModelNodeContext, checks: readonly GateCheckSpec[], stopOn: unknown): void {
	if (stopOn !== undefined && stopOn !== "never" && stopOn !== "fail") {
		throw new KernelNodeError("invalid-request", 'gate stopOn must be "never" or "fail"');
	}
	if (!Array.isArray(checks) || checks.length === 0) {
		throw new KernelNodeError("invalid-request", "a gate needs at least one check");
	}
	const names = new Set<string>();
	const questionIssues: string[] = [];
	for (const [index, check] of checks.entries()) {
		assertSpanName("check", (check as { name?: unknown } | null)?.name);
		if (names.has(check.name)) {
			throw new KernelNodeError("invalid-request", `gate check names must be unique: "${check.name}" repeats`);
		}
		names.add(check.name);
		if (check.kind === "step") {
			if (typeof check.run !== "function") {
				throw new KernelNodeError("invalid-request", `step check "${check.name}" needs a run function`);
			}
		} else if (check.kind === "decide") {
			questionIssues.push(...decideCheckIssues(ctx, check));
		} else {
			throw new KernelNodeError("invalid-request", `check ${index} has an unknown kind`);
		}
	}
	if (questionIssues.length > 0) throw new KernelDecideValidationError(questionIssues);
}

/**
 * A decide check asks bool questions only (its result needs pass/fail/abstain)
 * and must pass decide's own validation (state, questions with thresholds
 * merged, timeoutMs), so decide cannot reject it for validation mid-gate.
 */
function decideCheckIssues(ctx: ModelNodeContext, check: DecideCheck): string[] {
	const questions: unknown = check.questions;
	if (questions === null || typeof questions !== "object" || Array.isArray(questions)) {
		return [`check "${check.name}": questions must be an object`];
	}
	const issues: string[] = [];
	for (const [id, question] of Object.entries(questions as Record<string, unknown>)) {
		const type = (question as { type?: unknown } | null)?.type;
		if (type !== "bool") {
			issues.push(`check "${check.name}" question "${id}": gate decide checks take bool questions only`);
		}
	}
	if (issues.length > 0) return issues;
	const decideIssues = callOptionIssues({ timeoutMs: check.timeoutMs });
	try {
		validateDecideRequest(ctx, check.state, check.questions);
	} catch (error) {
		if (!(error instanceof KernelDecideValidationError)) throw error;
		decideIssues.unshift(...error.issues);
	}
	return decideIssues.map((issue) => `check "${check.name}": ${issue}`);
}

// ── the check loop ────────────────────────────────────────────────────────────

/** One check's result, plus the step span it ran in (gate_end only). */
type CheckOutcome = GateCheckResult & { stepSpanId?: string };

interface CheckRun {
	outcomes: CheckOutcome[];
	aborted: boolean;
	/** A decide check rejected (or the loop failed unexpectedly): rethrown after gate_end. */
	rejection?: { error: unknown };
}

interface CheckLoopOptions {
	scope: SpanScope;
	gate: { spanId: string; startEventId: string };
	stopOn: "never" | "fail";
	/** The gate's requestId: decide checks without their own derive one from it. */
	requestId?: string;
	signal?: AbortSignal;
}

/** Runs the checks in order. Never rejects: every exit leaves a result per check. */
async function runChecks(
	ctx: ModelNodeContext,
	checks: readonly GateCheckSpec[],
	opts: CheckLoopOptions,
): Promise<CheckRun> {
	const settled: Array<CheckOutcome | undefined> = checks.map(() => undefined);
	let rejection: CheckRun["rejection"];
	let current = -1;
	try {
		for (const [index, check] of checks.entries()) {
			if (opts.signal?.aborted || rejection) break;
			current = index;
			if (check.kind === "step") {
				settled[index] = await runStepCheck(ctx, check, index, opts);
			} else {
				try {
					settled[index] = await runDecideCheck(ctx, check, opts);
				} catch (error) {
					ctx.logger?.error("gate decide check rejected", {
						spanId: opts.gate.spanId,
						check: check.name,
						error: errorName(error),
					});
					settled[index] = { name: check.name, kind: check.kind, result: "abstain", error: rejectionCode(error) };
					rejection = { error };
				}
			}
			if (opts.stopOn === "fail" && settled[index]?.result === "fail") break;
		}
	} catch (error) {
		// Not reachable through a check (both runners settle); kept so a defect still closes the gate.
		ctx.logger?.error("gate check loop failed", { spanId: opts.gate.spanId, error: errorName(error) });
		const check = checks[current];
		if (check && settled[current] === undefined) {
			settled[current] = { name: check.name, kind: check.kind, result: "abstain", error: rejectionCode(error) };
		}
		rejection ??= { error };
	}
	return {
		outcomes: checks.map((check, index) => settled[index] ?? { name: check.name, kind: check.kind, result: "skipped" }),
		aborted: opts.signal?.aborted === true,
		...(rejection !== undefined && { rejection }),
	};
}

async function runStepCheck(
	ctx: ModelNodeContext,
	check: StepCheck,
	index: number,
	opts: CheckLoopOptions,
): Promise<CheckOutcome> {
	// Derived from the gate span, so a gate requestId makes its check spans deterministic too.
	const stepSpanId = kernelNodeEventId(`span:${opts.gate.spanId}`, index, "check_step_span");
	let outcome: Omit<CheckOutcome, "name" | "kind"> = { result: "fail", error: "check did not settle" };
	await recordStep(ctx, check.run, {
		name: check.name,
		scope: opts.scope,
		spanId: stepSpanId,
		...(check.attributes !== undefined && { attributes: check.attributes }),
		gate: opts.gate,
		check: (stepSettled) => {
			outcome = stepCheckOutcome(stepSettled);
			return {
				check_result: outcome.result as "pass" | "fail" | "abstain",
				...(outcome.value !== undefined && { check_value: outcome.value }),
			};
		},
	});
	return { name: check.name, kind: "step", ...outcome, stepSpanId };
}

const STEP_RESULTS: ReadonlySet<unknown> = new Set(["pass", "fail", "abstain"]);

/** true → pass, false → fail, an outcome object as given; a throw or a malformed outcome fails. */
function stepCheckOutcome(settled: StepSettled<GateStepOutcome>): Omit<CheckOutcome, "name" | "kind"> {
	if (!settled.ok) return { result: "fail", error: errorMessageOf(settled.error) };
	const value: unknown = settled.value;
	if (value === true) return { result: "pass" };
	if (value === false) return { result: "fail" };
	if (value !== null && typeof value === "object" && STEP_RESULTS.has((value as { result?: unknown }).result)) {
		const outcome = value as Exclude<GateStepOutcome, boolean>;
		return {
			result: outcome.result,
			...(isJsonPrimitive(outcome.value) && { value: outcome.value }),
			...(typeof outcome.reason === "string" && { reason: outcome.reason }),
		};
	}
	return { result: "fail", error: "invalid check outcome: expected a boolean or { result }" };
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

async function runDecideCheck(ctx: ModelNodeContext, check: DecideCheck, opts: CheckLoopOptions): Promise<CheckOutcome> {
	// A re-run of an idempotent gate replays its decisions instead of asking again; the check's own requestId wins.
	const requestId = check.requestId ?? (opts.requestId !== undefined ? `${opts.requestId}:check:${check.name}` : undefined);
	const outcome = await decideInternal(
		ctx,
		check.name,
		check.state,
		{
			questions: check.questions,
			containerId: opts.scope.containerId,
			...(opts.scope.parentRunId !== undefined && { parentRunId: opts.scope.parentRunId }),
			...(check.model !== undefined && { model: check.model }),
			...(requestId !== undefined && { requestId }),
			...(check.timeoutMs !== undefined && { timeoutMs: check.timeoutMs }),
			...(opts.signal !== undefined && { signal: opts.signal }),
		},
		{ gateSpanId: opts.gate.spanId },
	);
	const questions = Object.keys(check.questions).map((questionId) => {
		const answer = outcome.answers[questionId];
		// A bool answer without a verdict, or a missing answer, never passes.
		const result: "pass" | "fail" | "abstain" = !answer || answer.abstained ? "abstain" : (answer.verdict ?? "abstain");
		return {
			questionId,
			result,
			runId: outcome.ids.runId,
			...(answer?.probability !== undefined && { probability: answer.probability }),
			thresholdApplied: answer?.thresholdApplied ?? {},
			...(answer?.abstainReason !== undefined
				? { abstainReason: answer.abstainReason }
				: !answer && { abstainReason: "engine-error" as const }),
		};
	});
	return {
		name: check.name,
		kind: "decide",
		result: combineVerdict(questions.map((q) => q.result), false),
		questions,
	};
}

/** `error` for a check whose decide rejected: the KernelNodeError code, else the error name. */
function rejectionCode(error: unknown): string {
	if (error instanceof KernelNodeError) return error.code;
	if (error instanceof Error) return error.name;
	return "error";
}

function toCheckRecord(check: CheckOutcome): GateCheckRecord {
	return {
		name: check.name,
		kind: check.kind,
		result: check.result,
		...(check.value !== undefined && { value: check.value }),
		...(check.reason !== undefined && { reason: check.reason }),
		...(check.error !== undefined && { error: check.error }),
		...(check.stepSpanId !== undefined && { step_span_id: check.stepSpanId }),
		...(check.questions !== undefined && {
			questions: check.questions.map((q) => ({
				question_id: q.questionId,
				result: q.result,
				run_id: q.runId,
				...(q.probability !== undefined && { probability: q.probability }),
				...(q.thresholdApplied.passAt !== undefined && { pass_at: q.thresholdApplied.passAt }),
				...(q.thresholdApplied.failAt !== undefined && { fail_at: q.thresholdApplied.failAt }),
				...(q.abstainReason !== undefined && { abstain_reason: q.abstainReason }),
			})),
		}),
	};
}
