/**
 * The fork's extract and decide nodes through the Archon provider, driven
 * the way Archon drives them: a new provider for each node attempt, an
 * Archon-shaped `options.env` with `PACK_DIR` and the `TRACE_*` variables,
 * and `model_node` in `nodeConfig`. Each pack's call engine is the kernel's
 * fake call engine, put in the cache before the node runs, so no test sends
 * a model request.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { kernelDatabasePath } from "@codecaine-ai/agent-kernel-db";

import { createKernel } from "../index";
import {
	createFakeCallEngine,
	createFakeClassifier,
	createFakeClassifierRegistry,
	fakeFailure,
	fakeOk,
	type FakeCallEngine,
	type FakeCallResponse,
} from "../model-nodes/testing";
import {
	ARCHON_KERNEL_ID,
	archonKernel,
	archonPackKernel,
	createAgentKernelProvider,
	type AgentKernelChunk,
	type AgentKernelSendQueryOptions,
	type ArchonKernelEntry,
	type DecideModelNode,
	type ExtractModelNode,
} from "./index";
import { runDecide } from "./model-nodes";

interface SupportCalls {
	ExtractSupportEmail(raw: string, options?: unknown): Promise<{ sender: string; ask: string }>;
}

const OUTPUT_FORMAT = {
	type: "json_schema",
	schema: {
		type: "object",
		properties: { sender: { type: "string" }, ask: { type: "string" } },
		required: ["sender", "ask"],
	},
} as const;
const EXTRACT: ExtractModelNode = { kind: "extract", function: "ExtractSupportEmail", tier: "fast", retries: 2 };
const EMAIL = '{"to":"support@acme.dev","from":"ana@example.com","body":"Please reset my password."}';
const parseFailure = () => fakeFailure({ kind: "parse", message: "no JSON in the reply", rawOutput: "Sure thing!" });

let root: string;
let entries: Promise<ArchonKernelEntry>[];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "archon-model-nodes-"));
	entries = [];
	// Routes resolve through this models.json. The fake engines never send, so the URL is never reached.
	const piAgentDir = join(root, "pi-agent");
	mkdirSync(piAgentDir, { recursive: true });
	writeFileSync(
		join(piAgentDir, "models.json"),
		JSON.stringify({
			providers: {
				stub: {
					baseUrl: "http://127.0.0.1:9/v1",
					api: "openai-responses",
					apiKey: "sk-stub-key-0123456789",
					models: ["fast-model", "standard-model"].map((id) => ({
						id,
						name: id,
						reasoning: false,
						input: ["text"],
						contextWindow: 128000,
						maxTokens: 4096,
					})),
				},
			},
		}),
	);
});

afterEach(async () => {
	for (const entry of [archonKernel(root, assistantConfig()), ...entries]) {
		const { kernel } = await entry;
		await kernel.traceWriter.flush();
		kernel.dispose();
	}
	rmSync(root, { recursive: true, force: true });
});

function assistantConfig(): Record<string, unknown> {
	return {
		catalogRoots: [join(import.meta.dir, "__fixtures__")],
		aliases: { fast: "stub/fast-model", standard: "stub/standard-model", strong: "stub/standard-model" },
		piAgentDir: join(root, "pi-agent"),
	};
}

/** A pack folder under the temp root whose kernel calls `engine`, cached before any node runs. */
function pack(name: string, engine: FakeCallEngine<SupportCalls>): string {
	const packDir = join(root, ".archon", "workflows", name);
	mkdirSync(packDir, { recursive: true });
	entries.push(archonPackKernel(root, assistantConfig(), packDir, async () => engine));
	return packDir;
}

function engineAnswering(respond: (index: number) => FakeCallResponse): FakeCallEngine<SupportCalls> {
	return createFakeCallEngine<SupportCalls>({
		functions: ["ExtractSupportEmail"],
		respond: (_req, index) => respond(index),
	});
}

function nodeEnv(node: string, packDir: string, runId = "run-1"): Record<string, string> {
	return {
		TRACE_ENGINE: "archon",
		TRACE_RUN: runId,
		TRACE_NODE_PATH: node,
		TRACE_INVOCATION: `inv-${node}`,
		TRACE_ATTEMPT: "att-1",
		TRACE_LOOP_PATH: "",
		PACK_DIR: packDir,
	};
}

/** One node attempt on a new provider, as Archon's registry makes one per attempt. */
async function attempt(
	prompt: string,
	env: Record<string, string>,
	extra: Partial<AgentKernelSendQueryOptions> = {},
): Promise<AgentKernelChunk[]> {
	const chunks: AgentKernelChunk[] = [];
	const provider = createAgentKernelProvider({ root });
	for await (const chunk of provider.sendQuery(prompt, root, undefined, {
		env,
		assistantConfig: assistantConfig(),
		outputFormat: OUTPUT_FORMAT,
		nodeConfig: { nodeId: env.TRACE_NODE_PATH, model_node: EXTRACT },
		...extra,
	})) {
		chunks.push(chunk);
	}
	return chunks;
}

function resultOf(chunks: AgentKernelChunk[]): Extract<AgentKernelChunk, { type: "result" }> {
	const result = chunks.find((chunk) => chunk.type === "result");
	if (result?.type !== "result") throw new Error("the stream has no result");
	return result;
}

function query<T>(sql: string, ...params: string[]): T[] {
	const db = new Database(kernelDatabasePath(root), { readonly: true });
	try {
		return db.query(sql).all(...params) as T[];
	} finally {
		db.close();
	}
}

interface NodeRow {
	id: string;
	kernel_id: string;
	status: string;
	parent_kind: string | null;
	parent_run_id: string | null;
}

function nodeRows(): NodeRow[] {
	return query<NodeRow>(
		`SELECT c.id, c.kernel_id, c.status, p.kind AS parent_kind, p.run_id AS parent_run_id
		 FROM containers c LEFT JOIN containers p ON p.id = c.parent_container_id
		 WHERE c.kind = 'archon-node' ORDER BY c.node_path`,
	);
}

describe("extract nodes", () => {
	test("a valid result is the structured output, from one call with the rendered input", async () => {
		const engine = engineAnswering(() => fakeOk({ sender: "ana@example.com", ask: "reset password" }));
		const chunks = await attempt(EMAIL, nodeEnv("extract", pack("intake", engine)));

		expect(chunks.map((chunk) => chunk.type)).toEqual(["result", "settled"]);
		expect(resultOf(chunks)).toMatchObject({ structuredOutput: { sender: "ana@example.com", ask: "reset password" } });
		expect(resultOf(chunks).isError).toBeUndefined();
		expect(engine.invocations.map((req) => req.args)).toEqual([[EMAIL]]);
		expect(engine.invocations[0]!.route.headers["X-Trace-Node-Path"]).toBe("extract");
		expect(nodeRows().map((row) => row.status)).toEqual(["done"]);
	});

	test("a parse failure, then a valid result, gives the valid result after 2 calls", async () => {
		const engine = engineAnswering((index) => (index === 0 ? parseFailure() : fakeOk({ sender: "ana", ask: "reset" })));
		const chunks = await attempt(EMAIL, nodeEnv("extract", pack("intake", engine)));

		expect(resultOf(chunks).structuredOutput).toEqual({ sender: "ana", ask: "reset" });
		expect(engine.invocations).toHaveLength(2);
	});

	test("when every call fails, the one sendQuery fails after 1 + retries calls", async () => {
		// A parse failure and a result that misses output_format both use up a retry.
		const engine = engineAnswering((index) => (index === 0 ? parseFailure() : fakeOk({ sender: "ana" })));
		const chunks = await attempt(EMAIL, nodeEnv("extract", pack("intake", engine)), {
			nodeConfig: { model_node: { ...EXTRACT, retries: 1 } },
		});

		expect(chunks.map((chunk) => chunk.type)).toEqual(["result", "settled"]);
		expect(resultOf(chunks)).toMatchObject({ isError: true, failure: { class: "unknown" } });
		expect(resultOf(chunks).errors![0]).toContain("extract failed after 2 calls");
		expect(resultOf(chunks).structuredOutput).toBeUndefined();
		expect(engine.invocations).toHaveLength(2);
		expect(nodeRows().map((row) => row.status)).toEqual(["error"]);
	});

	test("an extract that is the first kernel node of a run has its archon-run parent row", async () => {
		const engine = engineAnswering(() => fakeOk({ sender: "ana", ask: "reset" }));
		await attempt(EMAIL, nodeEnv("extract", pack("intake", engine), "run-first"));

		expect(nodeRows()).toEqual([
			expect.objectContaining({ parent_kind: "archon-run", parent_run_id: "run-first", status: "done" }),
		]);
	});

	test("2 pack kernels on one root call their own engines and share one kernel id and database", async () => {
		const engineA = engineAnswering(() => fakeOk({ sender: "a", ask: "from pack a" }));
		const engineB = engineAnswering(() => fakeOk({ sender: "b", ask: "from pack b" }));
		const packA = pack("pack-a", engineA);
		const packB = pack("pack-b", engineB);

		const [a, b] = await Promise.all([
			attempt("email a", nodeEnv("extract-a", packA)),
			attempt("email b", nodeEnv("extract-b", packB)),
		]);

		expect(resultOf(a).structuredOutput).toEqual({ sender: "a", ask: "from pack a" });
		expect(resultOf(b).structuredOutput).toEqual({ sender: "b", ask: "from pack b" });
		expect(engineA.invocations.map((req) => req.args)).toEqual([["email a"]]);
		expect(engineB.invocations.map((req) => req.args)).toEqual([["email b"]]);
		const [entryA, entryB] = await Promise.all(entries);
		expect(entryA!.kernel).not.toBe(entryB!.kernel);
		expect(entryA!.db).toBe(entryB!.db);
		expect(entryA!.kernel.id).toBe(ARCHON_KERNEL_ID);
		expect(new Set(nodeRows().map((row) => row.kernel_id))).toEqual(new Set([ARCHON_KERNEL_ID]));
	});

	test("tier fast on a pack kernel resolves through the aliases of assistantConfig", async () => {
		const engine = engineAnswering(() => fakeOk({ sender: "ana", ask: "reset" }));
		const packDir = pack("intake", engine);
		await attempt(EMAIL, nodeEnv("extract", packDir));
		await attempt(EMAIL, nodeEnv("extract-strong", packDir), { nodeConfig: { model_node: { ...EXTRACT, tier: "strong" } } });

		expect(engine.invocations.map((req) => req.route.modelRef)).toEqual(["stub/fast-model", "stub/standard-model"]);
	});

	test("an extract outside a pack fails with an error that names PACK_DIR", async () => {
		const chunks = await attempt(EMAIL, nodeEnv("extract", ""));

		expect(resultOf(chunks)).toMatchObject({ isError: true, failure: { class: "misconfigured" } });
		expect(resultOf(chunks).errors![0]).toContain("PACK_DIR");
		expect(nodeRows().map((row) => row.status)).toEqual(["error"]);
	});
});

describe("decide nodes", () => {
	const DECIDE: DecideModelNode = {
		kind: "decide",
		question: "What does this email ask for?",
		enum: ["reply", "code_change", "ignore", "other"],
		classifier: "",
		threshold: { minProbability: 0.7, minMargin: 0.2 },
	};

	/** A kernel on the shared handle whose classifier is the fake, and the tagged container of one decide node. */
	async function decideKernel(probabilities: Record<string, number>) {
		const { db } = await archonKernel(root, assistantConfig());
		const fake = createFakeClassifier();
		fake.setScript(() => {
			const [choice] = Object.entries(probabilities).sort(([, p], [, q]) => q - p)[0]!;
			return { answers: { choice: { type: "choice", choice, probabilities, confidence: 0.9 } } };
		});
		const { registry } = await createFakeClassifierRegistry(fake);
		const kernel = createKernel({ id: ARCHON_KERNEL_ID, db, stateRoot: root, decide: { models: registry } });
		const traceTags = { engine: "archon", run_id: "run-1", node_path: "classify", invocation_id: "inv-1", attempt_id: "att-1" };
		const run = await kernel.container({ kind: "archon-run", key: ["run-1"], traceTags: { engine: "archon", run_id: "run-1" } });
		const node = await kernel.container({ kind: "archon-node", key: ["run-1", "inv-1", "att-1"], parent: run, traceTags });
		return { kernel, fake, scope: { containerId: node.id, traceTags, prompt: '{"sender":"ana","ask":"reset"}' } };
	}

	test("an abstain answers other with its reason, and leaves an agent_runs row under the node container", async () => {
		const { kernel, fake, scope } = await decideKernel({ reply: 0.4, code_change: 0.35, ignore: 0.15, other: 0.1 });
		const result = await runDecide(kernel, { ...DECIDE, classifier: fake.ref }, scope);
		await kernel.traceWriter.flush();

		expect(result).toEqual({ choice: "other", reason: "low-confidence", probability: 0.1, abstained: true });
		// The grammar gives only the labels, so each label describes itself.
		const asked = fake.calls[0]!.context.questions.choice as { criteria: Record<string, string> };
		expect(asked.criteria).toEqual({ reply: "reply", code_change: "code_change", ignore: "ignore", other: "other" });
		expect(query("SELECT id FROM agent_runs WHERE container_id = ?", scope.containerId)).toHaveLength(1);
		kernel.dispose();
	});

	test("a clear answer gives its choice, its probability and the margin over the runner-up", async () => {
		const { kernel, fake, scope } = await decideKernel({ reply: 0.88, code_change: 0.07, ignore: 0.03, other: 0.02 });
		const result = await runDecide(kernel, { ...DECIDE, classifier: fake.ref }, scope);

		expect(result).toEqual({ choice: "reply", reason: "top 0.88, margin 0.81", probability: 0.88, abstained: false });
		kernel.dispose();
	});
});
