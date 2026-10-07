/**
 * Real-BAML cancellation scenarios for `cancel.test.ts` (plan §4.6): a full
 * `kernel.call` lifecycle (temp database, offline Pi route, `bamlEngine`)
 * against a local mock provider, cancelled while BAML's native request is in
 * flight and while its retry policy is backing off.
 *
 * Nothing under packages/ may load BAML, so the caller injects the module, a
 * generated client with `ExtractCheckpointNote(note)`, its sources, and the
 * name of a retry policy declared in those sources. The test runs this from
 * the spike's child process (`.work/model-nodes/spikes/baml-bun/src/kernel-cancel-child.ts`),
 * which owns the real `@boundaryml/baml`.
 */
import { getAgentRun, getTraceEventsForRun } from "@agent-kernel/db";
import type { CallEndData } from "@agent-kernel/protocol";

import { runTraceDoctor } from "../../../doctor";
import { createTempKernelDb } from "../../__fixtures__/temp-kernel";
import { createCall } from "../../call";
import { fakePiModels, FAKE_CALL_MODEL_REF } from "../../call/__fixtures__/fake-call-engine";
import { createModelNodeContext } from "../../context";
import { KernelCallError } from "../../types";
import type { BamlRuntimeLike } from "../baml-runtime-types";
import { bamlEngine } from "../index";

export interface CancelScenarioClient {
	ExtractCheckpointNote(note: string, opts?: object): Promise<unknown>;
}

export interface CancelScenarioInput {
	baml: BamlRuntimeLike;
	client: CancelScenarioClient;
	sources: Record<string, string>;
	/** A retry_policy declared in `sources` with a backoff delay well above 100 ms. */
	retryPolicy: string;
}

export interface CancelScenarioResult {
	name: string;
	/** The KernelCallError failure kind, or "ok"/"unexpected" when the call did not fail as a call. */
	outcome: string;
	runStatus: string | null;
	endStatus: string | null;
	endKind: string | null;
	/** Requests the mock provider received, counted after a settle wait longer than one backoff. */
	requests: number;
	/** The provider saw the client close a held request. */
	clientClosed: boolean;
	/** From the cancel (abort or deadline) to the call settling. */
	settleMs: number;
	doctorOk: boolean;
}

/** Longer than the backoff the scenarios cancel inside, so a retry that was not cancelled would land. */
const SETTLE_WAIT_MS = 1_000;

export async function runBamlCancelScenarios(input: CancelScenarioInput): Promise<CancelScenarioResult[]> {
	let requests = 0;
	let clientClosed = false;
	let onRequest: (() => void) | undefined;
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			requests++;
			onRequest?.();
			if (new URL(req.url).pathname.startsWith("/hold/")) {
				// Held until the client goes away (or 5 s, which would fail the bound).
				await new Promise<void>((resolve) => {
					req.signal.addEventListener("abort", () => {
						clientClosed = true;
						resolve();
					});
					setTimeout(resolve, 5_000);
				});
				return Response.json({ error: { message: "held too long" } }, { status: 500 });
			}
			return Response.json({ error: { message: "overloaded" } }, { status: 500 });
		},
	});
	const temp = await createTempKernelDb();
	const base = `http://127.0.0.1:${server.port}`;
	const engine = bamlEngine({
		client: input.client,
		baml: input.baml,
		sources: input.sources,
		manifests: {},
		retryPolicy: input.retryPolicy,
	});

	async function scenario(
		name: string,
		opts: { path: string; abortAfterFirstRequestMs?: number; timeoutMs: number },
	): Promise<CancelScenarioResult> {
		requests = 0;
		clientClosed = false;
		const controller = new AbortController();
		let cancelledAt = 0;
		onRequest =
			opts.abortAfterFirstRequestMs === undefined
				? undefined
				: () => {
						if (requests !== 1) return;
						setTimeout(() => {
							cancelledAt = Date.now();
							controller.abort();
						}, opts.abortAfterFirstRequestMs);
					};
		const call = createCall(
			createModelNodeContext({
				kernelId: temp.kernelId,
				db: temp.db,
				calls: { engine },
				models: { defaults: { call: FAKE_CALL_MODEL_REF } },
				piModels: () => fakePiModels({ baseUrl: `${base}${opts.path}` }),
			}),
		);
		const startedAt = Date.now();
		let outcome = "ok";
		let runId: string | undefined;
		try {
			await call("ExtractCheckpointNote", ["Checkpoint 3: kept type_erasing_cast."], {
				containerId: temp.containerId,
				signal: controller.signal,
				timeoutMs: opts.timeoutMs,
			});
		} catch (error) {
			if (error instanceof KernelCallError) {
				outcome = error.failure.kind;
				runId = error.runId;
			} else {
				outcome = `unexpected ${error instanceof Error ? error.name : typeof error}`;
			}
		}
		const settledAt = Date.now();
		if (cancelledAt === 0) cancelledAt = startedAt + opts.timeoutMs;
		await Bun.sleep(SETTLE_WAIT_MS);

		const run = runId ? await getAgentRun(temp.db, runId) : undefined;
		const [end] = runId ? await getTraceEventsForRun(temp.db, runId, ["call_end"]) : [];
		const endData = end?.eventData as CallEndData | undefined;
		return {
			name,
			outcome,
			runStatus: run?.status ?? null,
			endStatus: endData?.status ?? null,
			endKind: endData?.error?.kind ?? null,
			requests,
			clientClosed,
			settleMs: settledAt - cancelledAt,
			doctorOk: (await runTraceDoctor(temp.db)).ok,
		};
	}

	try {
		return [
			// Control: without a cancel, the policy retries the 500 once.
			await scenario("retry-control", { path: "/fail/v1", timeoutMs: 10_000 }),
			await scenario("abort-during-request", { path: "/hold/v1", abortAfterFirstRequestMs: 150, timeoutMs: 10_000 }),
			await scenario("abort-during-backoff", { path: "/fail/v1", abortAfterFirstRequestMs: 100, timeoutMs: 10_000 }),
			await scenario("deadline-during-backoff", { path: "/fail/v1", timeoutMs: 150 }),
		];
	} finally {
		server.stop(true);
		temp.cleanup();
	}
}
