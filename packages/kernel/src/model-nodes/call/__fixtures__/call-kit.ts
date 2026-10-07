/**
 * `kernel.call` test kit: a temp kernel database (§7.2), the fake call
 * engine over a two-function client, an offline keyed Pi provider for
 * routes, and the call function built exactly as createKernel builds it
 * (`createCall(ctx)`), with the Pi models injected.
 */
import { getTraceBlob, type KernelDatabase } from "@agent-kernel/db";

import type { ModelPriceTable } from "../../../emitter";
import { createModelNodeContext, type CallNodeContext, type ModelNodeLogger } from "../../context";
import type { CallManifest, KernelCallFn } from "../../types";
import { createTempKernelDb, type TempKernelDb } from "../../__fixtures__/temp-kernel";
import { createCall } from "../index";
import {
	createFakeCallEngine,
	fakeOk,
	fakePiModels,
	FAKE_CALL_MODEL_REF,
	type FakeCallEngine,
	type FakeCallEngineOptions,
	type FakePiModels,
	type FakePiModelsOptions,
} from "./fake-call-engine";

/** The generated-client shape the kit's engine stands in for. */
export interface TestClient {
	Extract(note: string, opts?: { signal?: AbortSignal }): Promise<{ kept: string[]; reason: string }>;
	Summarize(text: string, limit: number, opts?: { signal?: AbortSignal }): Promise<string>;
}

export interface CallKitOptions {
	respond?: FakeCallEngineOptions<TestClient>["respond"];
	transport?: "baml-http" | "pi";
	manifests?: Partial<Record<"Extract" | "Summarize", CallManifest>>;
	models?: { aliases?: Record<string, string>; prices?: ModelPriceTable; defaults?: { call?: string } };
	pi?: FakePiModelsOptions;
	logger?: ModelNodeLogger;
	defaultTimeoutMs?: number;
}

export interface CallKit {
	temp: TempKernelDb;
	pi: FakePiModels;
	engine: FakeCallEngine<TestClient>;
	ctx: CallNodeContext<TestClient>;
	call: KernelCallFn<TestClient>;
	cleanup(): void;
}

export async function createCallKit(opts: CallKitOptions = {}): Promise<CallKit> {
	const temp = await createTempKernelDb();
	const pi = fakePiModels(opts.pi);
	const engine = createFakeCallEngine<TestClient>({
		functions: ["Extract", "Summarize"],
		respond: opts.respond ?? (() => fakeOk({ kept: [], reason: "none" })),
		...(opts.transport !== undefined && { transport: opts.transport }),
		...(opts.manifests !== undefined && { manifests: opts.manifests }),
	});
	const ctx = createModelNodeContext<TestClient>({
		kernelId: temp.kernelId,
		db: temp.db,
		...(opts.logger !== undefined && { logger: opts.logger }),
		models: {
			...opts.models,
			defaults: { call: FAKE_CALL_MODEL_REF, ...opts.models?.defaults },
		},
		calls: { engine, ...(opts.defaultTimeoutMs !== undefined && { defaultTimeoutMs: opts.defaultTimeoutMs }) },
		piModels: () => pi,
	});
	const raw = createCall(ctx);
	// Calls hang under the seeded container unless the test names a scope.
	const call: KernelCallFn<TestClient> = (name, args, callOpts) =>
		raw(name, args, { containerId: temp.containerId, ...callOpts });
	return { temp, pi, engine, ctx, call, cleanup: () => temp.cleanup() };
}

/** A stored blob's kind and UTF-8 text. */
export async function readBlob(db: KernelDatabase, hash: string | null | undefined): Promise<{ kind: string; text: string }> {
	if (!hash) throw new Error("no blob hash");
	const blob = await getTraceBlob(db, hash);
	if (!blob) throw new Error(`blob ${hash} not stored`);
	return { kind: blob.kind, text: Buffer.from(blob.data).toString("utf8") };
}
