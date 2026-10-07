/**
 * A scripted node spec for lifecycle tests: `execute` calls the test's
 * `invoke` hook (the "engine"), then emits one turn pair, a decision_made for
 * decisions, and a call-output blob; `replay` rebuilds the answer from the
 * stored call_end output blob. Shared by node-run.test.ts and the child
 * process of its cross-process race.
 */
import { getTraceBlob } from "@agent-kernel/db";
import {
	createDecisionMadeEvent,
	createPiTurnEndEvent,
	createPiTurnStartEvent,
	type CallEndData,
	type TraceEvent,
	type TurnUsage,
} from "@agent-kernel/protocol";

import { jsonBlob } from "../blobs";
import type { NodeExecution, NodeRunHandle, NodeRunSpec } from "../node-run";
import type { ResolvedNodeScope } from "../scope";

export const FAKE_MODEL = "fake/fake-model";

export interface FakeNodeOutcome {
	answer: string;
	runId: string;
}

export interface FakeNodeOptions {
	scope: ResolvedNodeScope;
	kind?: "call" | "decision";
	name?: string;
	requestId?: string;
	/** Default 60 s. */
	deadlineMs?: number;
	signal?: AbortSignal;
	answer?: string;
	onNodeStarted?: NodeRunSpec<FakeNodeOutcome>["onNodeStarted"];
	/** The "engine": runs inside execute, after the claim committed. Await to block. */
	invoke?: (run: NodeRunHandle) => Promise<void> | void;
}

export function fakeNodeSpec(opts: FakeNodeOptions): NodeRunSpec<FakeNodeOutcome> {
	const kind = opts.kind ?? "decision";
	const name = opts.name ?? (kind === "decision" ? "fake_decision" : "FakeCall");
	const answer = opts.answer ?? "yes";
	const input = jsonBlob(kind === "decision" ? "classifier-context" : "call-input", { name }, new Date(0).toISOString());
	return {
		kind,
		name,
		scope: opts.scope,
		...(opts.requestId !== undefined && { requestId: opts.requestId }),
		...(opts.signal !== undefined && { signal: opts.signal }),
		...(opts.onNodeStarted !== undefined && { onNodeStarted: opts.onNodeStarted }),
		deadlineMs: opts.deadlineMs ?? 60_000,
		start: {
			engine: kind === "decision" ? "pi-ai" : "baml",
			...(kind === "call" && { transport: "baml-http" as const }),
			model: FAKE_MODEL,
			provider: "fake",
			prompt_hash: kind === "decision" ? "dq1-fake" : "baml1-fake",
			input_blob_hash: input.hash,
		},
		startBlobs: [input.blob],
		async execute(run) {
			const startedAtMs = Date.now();
			await opts.invoke?.(run);
			if (run.signal.aborted) return abortedExecution(run);
			return doneExecution(run, kind, name, answer, startedAtMs);
		},
		async replay({ db, ids, events }) {
			const callEnd = events.find((e) => e.type === "call_end");
			const hash = (callEnd?.eventData as Partial<CallEndData> | undefined)?.output_blob_hash;
			const blob = hash ? await getTraceBlob(db, hash) : undefined;
			if (!blob) throw new Error(`replay: run ${ids.runId} has no output blob`);
			const stored = JSON.parse(Buffer.from(blob.data).toString("utf8")) as { answer: string };
			return { answer: stored.answer, runId: ids.runId };
		},
	};
}

function doneExecution(
	run: NodeRunHandle,
	kind: "call" | "decision",
	name: string,
	answer: string,
	startedAtMs: number,
): NodeExecution<FakeNodeOutcome> {
	const window = run.turnWindow(startedAtMs, Date.now() - startedAtMs);
	const usage: TurnUsage = { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, model: FAKE_MODEL };
	const output = jsonBlob("call-output", { answer }, window.end);
	const events: TraceEvent[] = [
		createPiTurnStartEvent(run.traceIds, {
			turnNumber: 1,
			eventId: run.eventId(0, "pi_turn_start"),
			parentEventId: run.startEventId,
			timestamp: window.start,
		}),
		createPiTurnEndEvent(run.traceIds, {
			turnNumber: 1,
			stopReason: "stop",
			usage,
			eventId: run.eventId(0, "pi_turn_end"),
			parentEventId: run.startEventId,
			timestamp: window.end,
		}),
	];
	if (kind === "decision") {
		events.push(
			createDecisionMadeEvent(
				run.traceIds,
				{
					run_id: run.ids.runId,
					decision_name: name,
					answers: {
						verdict: {
							kind: "choice",
							choice: answer,
							confidenceSource: "native",
							abstained: false,
							thresholdApplied: {},
						},
					},
					chosen: answer,
					confidence_source: "native",
					abstained: false,
					threshold_applied: { verdict: {} },
					engine: "pi-ai",
					provider: "fake",
					model: FAKE_MODEL,
					requested_model: FAKE_MODEL,
				},
				{ eventId: run.eventId(0, "decision_made"), parentEventId: run.startEventId, timestamp: run.timestamp() },
			),
		);
	}
	return {
		outcome: { answer, runId: run.ids.runId },
		runStatus: "done",
		end: { status: "ok", output_blob_hash: output.hash, usage, attempts: 1, resolved_model: FAKE_MODEL },
		events,
		blobs: [output.blob],
	};
}

function abortedExecution(run: NodeRunHandle): NodeExecution<FakeNodeOutcome> {
	return {
		outcome: { answer: "", runId: run.ids.runId },
		runStatus: "aborted",
		end: {
			status: "aborted",
			error: { kind: run.deadlineExceeded() ? "timeout" : "aborted", message: "aborted before an answer" },
			attempts: 0,
		},
		events: [],
		blobs: [],
	};
}
