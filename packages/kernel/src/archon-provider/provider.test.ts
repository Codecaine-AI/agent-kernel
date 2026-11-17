/**
 * The Archon provider, driven the way Archon drives it: a new provider for
 * each node attempt, an Archon-shaped `options.env` with the `TRACE_*`
 * variables, and the `assistants.agent-kernel` block as `assistantConfig`.
 * The echo bundle's model goes to a local stub through the aliases.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getTraceEventsForRun, kernelDatabasePath } from "@codecaine-ai/agent-kernel-db";

import { createFakeCallEngine, fakeOk } from "../model-nodes/testing";
import {
	realFetch,
	responsesStream,
	startTraceHeaderStub,
	toolCallItem,
	type TraceHeaderStub,
} from "../model-nodes/__fixtures__/trace-header-stub";
import {
	AGENT_KERNEL_CAPABILITIES,
	archonKernel,
	createAgentKernelProvider,
	createArchonKernel,
	type AgentKernelChunk,
	type AgentKernelSendQueryOptions,
} from "./index";

const FIXTURES = join(import.meta.dir, "__fixtures__");
const STUB_MODEL = "stub/stub-model";
const OUTPUT_FORMAT = {
	type: "json_schema",
	schema: { type: "object", properties: { echo: { type: "string" } }, required: ["echo"] },
} as const;

let root: string;
let stub: TraceHeaderStub;
/** The text the stub answers with, by the first line of the user's message. */
let answers: Record<string, string>;
/** The body of each model request the stub got. */
let bodies: string[];
/** Called on each model request, before the stub answers. */
let onRequest: () => void;
/** Answers a request before `answers` does, when it returns a reply. */
let route: (body: string) => Response | Promise<Response> | undefined;
let savedPiAgentDirEnv: string | undefined;

/** A Responses stream of one message, sent as 2 text deltas. */
function textStream(text: string): Response {
	const half = Math.ceil(text.length / 2);
	const item = { type: "message", id: "msg_stub", role: "assistant", status: "in_progress", content: [] };
	const events = [
		{ type: "response.created", response: { id: "resp_stub", status: "in_progress", output: [] } },
		{ type: "response.output_item.added", output_index: 0, item },
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text.slice(0, half) },
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text.slice(half) },
		{
			type: "response.output_item.done",
			output_index: 0,
			item: { ...item, status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
		},
		{
			type: "response.completed",
			response: { id: "resp_stub", status: "completed", output: [], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } },
		},
	];
	const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A Pi agent dir whose one model, `stub/<modelId>`, goes to the stub. */
function writePiAgentDir(dir: string, modelId: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "models.json"),
		JSON.stringify({
			providers: {
				stub: {
					baseUrl: stub.url,
					api: "openai-responses",
					apiKey: "sk-stub-key-0123456789",
					models: [{ id: modelId, name: "Stub", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
				},
			},
		}),
	);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "archon-provider-"));
	answers = {};
	bodies = [];
	onRequest = () => {};
	route = () => undefined;
	// Pi's default agent dir, so a session that ignores piSessionsDir lands in the temp root, never in ~/.pi.
	savedPiAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "default-pi-agent");
	globalThis.fetch = realFetch;
	stub = startTraceHeaderStub((_index, body) => {
		bodies.push(body);
		onRequest();
		const routed = route(body);
		if (routed) return routed;
		const key = Object.keys(answers).find((k) => body.includes(k));
		return textStream(key ? answers[key]! : '{"echo":"default"}');
	});
	writePiAgentDir(join(root, "pi-agent"), "stub-model");
});

afterEach(async () => {
	const { kernel } = await archonKernel(root, assistantConfig());
	await kernel.traceWriter.flush();
	kernel.dispose();
	stub.stop();
	if (savedPiAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedPiAgentDirEnv;
	rmSync(root, { recursive: true, force: true });
});

function assistantConfig(): Record<string, unknown> {
	return {
		catalogRoots: [FIXTURES],
		aliases: { fast: STUB_MODEL, standard: STUB_MODEL, strong: STUB_MODEL },
		piAgentDir: join(root, "pi-agent"),
	};
}

/** The node environment Archon builds for one attempt (cp2 sets every variable). */
function nodeEnv(tags: { node: string; invocation: string; attempt?: string; loop?: string }): Record<string, string> {
	return {
		WORKFLOW_ID: "run-1",
		TRACE_ENGINE: "archon",
		TRACE_RUN: "run-1",
		TRACE_NODE_PATH: tags.node,
		TRACE_INVOCATION: tags.invocation,
		TRACE_ATTEMPT: tags.attempt ?? "att-1",
		TRACE_LOOP_PATH: tags.loop ?? "",
	};
}

/** One node attempt on a new provider, as Archon's registry makes one per attempt. */
async function attempt(
	prompt: string,
	env: Record<string, string>,
	extra: Partial<AgentKernelSendQueryOptions> = {},
	chunks: AgentKernelChunk[] = [],
	onChunk: (chunk: AgentKernelChunk) => void = () => {},
): Promise<AgentKernelChunk[]> {
	const provider = createAgentKernelProvider({ root });
	for await (const chunk of provider.sendQuery(prompt, root, undefined, {
		model: "echo-bundle",
		env,
		assistantConfig: assistantConfig(),
		...extra,
	})) {
		chunks.push(chunk);
		onChunk(chunk);
	}
	return chunks;
}

interface ContainerRow {
	id: string;
	kernel_id: string;
	kind: string;
	status: string;
	parent_container_id: string | null;
	working_dir: string | null;
	engine: string | null;
	run_id: string | null;
	node_path: string | null;
	invocation_id: string | null;
	attempt_id: string | null;
	loop_path: string | null;
}

function containers(kind: string): ContainerRow[] {
	const db = new Database(kernelDatabasePath(root), { readonly: true });
	try {
		return db
			.query("SELECT * FROM containers WHERE kind = ? ORDER BY node_path, invocation_id, attempt_id")
			.all(kind) as ContainerRow[];
	} finally {
		db.close();
	}
}

/**
 * Routes the background-dispatch bundle: its first turn calls start_child
 * with the label of "PARENT-TASK <label>", its second turn answers. The
 * child of each label answers only once `childGate(label)` resolves, and
 * `childAsked(label)` resolves when its request arrives.
 */
function routeBackgroundDispatch(childGate: (label: string) => Promise<void>, childAsked: (label: string) => void): void {
	route = (body) => {
		const child = /CHILD-TASK (\w+)/.exec(body)?.[1];
		if (child) {
			childAsked(child);
			return childGate(child).then(() => textStream(`{"echo":"child ${child}"}`));
		}
		const parent = /PARENT-TASK (\w+)/.exec(body)?.[1];
		if (!parent) return undefined;
		if (body.includes("function_call_output")) return textStream(`{"echo":"parent ${parent}"}`);
		return responsesStream([toolCallItem("start_child", { label: parent })]);
	};
}

/** The status of the background child that the node of `label` started. */
async function childStatus(label: string): Promise<string | undefined> {
	const { kernel } = await archonKernel(root, assistantConfig());
	return kernel.agentManager.listAgents().find((record) => record.description === `child of ${label}`)?.status;
}

function resultOf(chunks: AgentKernelChunk[]): Extract<AgentKernelChunk, { type: "result" }> {
	const result = chunks.find((chunk) => chunk.type === "result");
	if (result?.type !== "result") throw new Error("the stream has no result");
	return result;
}

describe("Archon provider", () => {
	test("2 parallel nodes on 2 provider instances give 2 archon-node rows, 2 state folders and 1 kernel", async () => {
		answers = { "first node": '{"echo":"first node"}', "second node": '{"echo":"second node"}' };
		await Promise.all([
			attempt("first node", nodeEnv({ node: "first", invocation: "inv-1" })),
			attempt("second node", nodeEnv({ node: "second", invocation: "inv-2" })),
		]);

		const [run, ...extraRuns] = containers("archon-run");
		expect(extraRuns).toEqual([]);
		expect(run).toMatchObject({ engine: "archon", run_id: "run-1", node_path: null, invocation_id: null, attempt_id: null });

		const nodes = containers("archon-node");
		expect(nodes.map(({ node_path, invocation_id, attempt_id, loop_path, parent_container_id, status, working_dir }) => ({
			node_path,
			invocation_id,
			attempt_id,
			loop_path,
			parent_container_id,
			status,
			working_dir,
		}))).toEqual([
			{ node_path: "first", invocation_id: "inv-1", attempt_id: "att-1", loop_path: null, parent_container_id: run!.id, status: "done", working_dir: root },
			{ node_path: "second", invocation_id: "inv-2", attempt_id: "att-1", loop_path: null, parent_container_id: run!.id, status: "done", working_dir: root },
		]);
		expect(new Set([run!, ...nodes].map((row) => row.kernel_id)).size).toBe(1);

		const stateDirs = readdirSync(join(root, ".agent-kernel", "state")).sort();
		expect(stateDirs).toEqual(nodes.map((row) => row.id).sort());
		for (const id of stateDirs) {
			expect(existsSync(join(root, ".agent-kernel", "state", id, "echo-bundle", "state.json"))).toBe(true);
		}

		// Each request carries the tags of its own node.
		expect(stub.received.map((headers) => headers["x-trace-node-path"]).sort()).toEqual(["first", "second"]);
		expect(stub.received.every((headers) => !("x-trace-loop-path" in headers))).toBe(true);
		const [a, b] = await Promise.all([archonKernel(root, assistantConfig()), archonKernel(root, assistantConfig())]);
		expect(a.kernel).toBe(b.kernel);
	});

	test("a retry gives a new row with the same invocation_id, and a loop round a new invocation_id and a loop_path", async () => {
		await attempt("node", nodeEnv({ node: "fix", invocation: "inv-1" }));
		await attempt("node", nodeEnv({ node: "fix", invocation: "inv-1", attempt: "att-2" }));
		await attempt("node", nodeEnv({ node: "fix", invocation: "inv-2", loop: "rounds:2" }));

		expect(containers("archon-node").map(({ invocation_id, attempt_id, loop_path }) => ({ invocation_id, attempt_id, loop_path }))).toEqual([
			{ invocation_id: "inv-1", attempt_id: "att-1", loop_path: null },
			{ invocation_id: "inv-1", attempt_id: "att-2", loop_path: null },
			{ invocation_id: "inv-2", attempt_id: "att-1", loop_path: "rounds:2" },
		]);
		expect(containers("archon-run")).toHaveLength(1);
		expect(stub.received[2]!["x-trace-loop-path"]).toBe("rounds:2");
	});

	test("the stream sends the reply as one block, then the structured result, then settled", async () => {
		answers = { hello: '{"echo":"hello"}' };
		const chunks = await attempt("hello", nodeEnv({ node: "n", invocation: "inv-1" }), { outputFormat: OUTPUT_FORMAT });

		expect(chunks.map((chunk) => chunk.type)).toEqual(["agent_message_chunk", "result", "settled"]);
		expect(chunks[0]).toEqual({ type: "agent_message_chunk", text: '{"echo":"hello"}' });
		const result = resultOf(chunks);
		expect(result.structuredOutput).toEqual({ echo: "hello" });
		expect(result.sessionId).toBeString();
		expect(result.isError).toBeUndefined();
	});

	test("a bundle that answers in prose gives no structured output after 1 model request, so the enforced node fails", async () => {
		answers = { prose: "Here is the echo you asked for: prose." };
		const chunks = await attempt("prose", nodeEnv({ node: "n", invocation: "inv-1" }), { outputFormat: OUTPUT_FORMAT });

		expect(chunks.at(-1)).toEqual({ type: "settled" });
		expect(resultOf(chunks).structuredOutput).toBeUndefined();
		expect(stub.received).toHaveLength(1);
		expect(AGENT_KERNEL_CAPABILITIES.structuredOutput).toBe("enforced");
	});

	test("an unknown bundle ends in a typed failure, then settled", async () => {
		const chunks = await attempt("hi", nodeEnv({ node: "n", invocation: "inv-1" }), { model: "no-such-bundle" });

		expect(chunks.map((chunk) => chunk.type)).toEqual(["result", "settled"]);
		expect(resultOf(chunks)).toMatchObject({ isError: true, failure: { class: "misconfigured" } });
		expect(stub.received).toHaveLength(0);
	});

	test("the Pi transcript lands under <root>/.agent-kernel/pi-sessions, not in Pi's default agent dir", async () => {
		const result = resultOf(await attempt("hello", nodeEnv({ node: "n", invocation: "inv-1" })));

		const [node] = containers("archon-node");
		const transcripts = readdirSync(join(root, ".agent-kernel", "pi-sessions", node!.id, "echo-bundle"));
		expect(transcripts).toEqual([expect.stringContaining(`${result.sessionId}.jsonl`)]);
		expect(existsSync(join(root, "default-pi-agent", "sessions"))).toBe(false);
	});

	test("a node cancelled before it starts throws, sends no model request and marks its node aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const chunks: AgentKernelChunk[] = [];
		const run = attempt("hello", nodeEnv({ node: "n", invocation: "inv-1" }), { abortSignal: controller.signal }, chunks);

		await expect(run).rejects.toThrow("Query aborted");
		expect(chunks.some((chunk) => chunk.type === "result" || chunk.type === "settled")).toBe(false);
		expect(stub.received).toHaveLength(0);
		expect(containers("archon-node").map((row) => row.status)).toEqual(["aborted"]);
	});

	test("a node cancelled while the model answers throws and marks its node aborted", async () => {
		const controller = new AbortController();
		onRequest = () => controller.abort();

		const chunks: AgentKernelChunk[] = [];
		const run = attempt("hello", nodeEnv({ node: "n", invocation: "inv-1" }), { abortSignal: controller.signal }, chunks);

		await expect(run).rejects.toThrow();
		expect(chunks.some((chunk) => chunk.type === "result" || chunk.type === "settled")).toBe(false);
		expect(containers("archon-node").map((row) => row.status)).toEqual(["aborted"]);
	});

	test("a node cancelled after the model answered, before the result is read, throws and marks its node aborted", async () => {
		const controller = new AbortController();
		const provider = createAgentKernelProvider({ root });
		const chunks: AgentKernelChunk[] = [];
		const run = (async () => {
			for await (const chunk of provider.sendQuery("hello", root, undefined, {
				model: "echo-bundle",
				env: nodeEnv({ node: "n", invocation: "inv-1" }),
				assistantConfig: assistantConfig(),
				abortSignal: controller.signal,
			})) {
				chunks.push(chunk);
				// The reader stops on the first text chunk, long enough for the spawn to finish, then cancels.
				if (chunks.length === 1) {
					await new Promise((resolve) => setTimeout(resolve, 200));
					controller.abort();
				}
			}
		})();

		await expect(run).rejects.toThrow("Query aborted");
		expect(chunks.map((chunk) => chunk.type)).toEqual(["agent_message_chunk"]);
		expect(containers("archon-node").map((row) => row.status)).toEqual(["aborted"]);
	});

	test("2 parallel nodes each end only after their own background child ends, not the other node's", async () => {
		const gates = { a: Promise.withResolvers<void>(), b: Promise.withResolvers<void>() };
		const asked = { a: Promise.withResolvers<void>(), b: Promise.withResolvers<void>() };
		routeBackgroundDispatch(
			(label) => gates[label as "a" | "b"].promise,
			(label) => asked[label as "a" | "b"].resolve(),
		);
		const statusAtResult: Record<string, Record<string, string | undefined>> = {};
		const run = (label: "a" | "b", onText: () => void) =>
			attempt(
				`PARENT-TASK ${label}`,
				nodeEnv({ node: label, invocation: `inv-${label}` }),
				{ model: "background-dispatch-bundle" },
				[],
				(chunk) => {
					if (chunk.type === "agent_message_chunk") onText();
					if (chunk.type === "result") {
						void Promise.all([childStatus("a"), childStatus("b")]).then(([a, b]) => (statusAtResult[label] = { a, b }));
					}
				},
			);

		// Node a's parent has answered; its child answers once node b's child runs too.
		const runA = run("a", () => void asked.b.promise.then(() => gates.a.resolve()));
		const runB = run("b", () => {});
		const chunksA = await runA;
		// Node b's child answers only after node a has settled.
		gates.b.resolve();
		const chunksB = await runB;

		expect(chunksA.map((chunk) => chunk.type)).toEqual(["agent_message_chunk", "result", "settled"]);
		expect(chunksB.map((chunk) => chunk.type)).toEqual(["agent_message_chunk", "result", "settled"]);
		expect(statusAtResult).toEqual({ a: { a: "completed", b: "running" }, b: { a: "completed", b: "completed" } });
		expect(containers("archon-node").map((row) => row.status)).toEqual(["done", "done"]);
	});

	test("a node cancelled while its background child runs stops the child, throws and marks its node aborted", async () => {
		const gate = Promise.withResolvers<void>();
		const asked = Promise.withResolvers<void>();
		routeBackgroundDispatch(() => gate.promise, () => asked.resolve());
		const controller = new AbortController();

		const chunks: AgentKernelChunk[] = [];
		const run = attempt(
			"PARENT-TASK a",
			nodeEnv({ node: "a", invocation: "inv-a" }),
			{ model: "background-dispatch-bundle", abortSignal: controller.signal },
			chunks,
			// The parent has answered and its child waits on the model: cancel now.
			(chunk) => {
				if (chunk.type === "agent_message_chunk") void asked.promise.then(() => controller.abort());
			},
		);

		await expect(run).rejects.toThrow("Query aborted");
		const status = await childStatus("a");
		gate.resolve();
		expect(status).toBe("stopped");
		expect(chunks.map((chunk) => chunk.type)).toEqual(["agent_message_chunk"]);
		expect(containers("archon-node").map((row) => row.status)).toEqual(["aborted"]);
	});

	test("runs with different settings get 2 kernels on 1 database handle, and each uses its own settings", async () => {
		writePiAgentDir(join(root, "other-pi-agent"), "other-model");
		const other = { ...assistantConfig(), aliases: { standard: "stub/other-model" }, piAgentDir: join(root, "other-pi-agent") };

		await attempt("hello", nodeEnv({ node: "a", invocation: "inv-1" }));
		await attempt("hello", nodeEnv({ node: "b", invocation: "inv-2" }), { assistantConfig: other });

		expect(bodies.map((body) => (JSON.parse(body) as { model: string }).model)).toEqual(["stub-model", "other-model"]);
		const first = await archonKernel(root, assistantConfig());
		const second = await archonKernel(root, other);
		expect(second.kernel).not.toBe(first.kernel);
		expect(second.db).toBe(first.db);
		expect(new Set(containers("archon-node").map((row) => row.kernel_id)).size).toBe(1);
		// Alias order is not part of the settings.
		const { fast, standard, strong } = assistantConfig().aliases as Record<string, string>;
		const reordered = await archonKernel(root, { ...assistantConfig(), aliases: { strong, standard, fast } });
		expect(reordered.kernel).toBe(first.kernel);
		second.kernel.dispose();
	});

	test("an output_format node sends the model the schema and a JSON-only instruction", async () => {
		answers = { hello: '{"echo":"hello"}' };
		await attempt("hello", nodeEnv({ node: "n", invocation: "inv-1" }), { outputFormat: OUTPUT_FORMAT });

		// The schema as it sits inside the request's JSON string.
		const schemaInBody = JSON.stringify(JSON.stringify(OUTPUT_FORMAT.schema, null, 2)).slice(1, -1);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toContain(schemaInBody);
		expect(bodies[0]).toContain("reply with just one JSON object that matches the schema");
	});

	test("a JSON answer that misses the output_format schema gives no structured output", async () => {
		answers = { hello: '{"wrong":"hello"}' };
		const chunks = await attempt("hello", nodeEnv({ node: "n", invocation: "inv-1" }), { outputFormat: OUTPUT_FORMAT });

		expect(resultOf(chunks).structuredOutput).toBeUndefined();
	});

	test("kernel.call with model fast resolves through the aliases of assistantConfig", async () => {
		const { db, settings } = await archonKernel(root, assistantConfig());
		const engine = createFakeCallEngine<{ Echo(text: string, options?: unknown): Promise<{ echo: string }> }>({
			functions: ["Echo"],
			respond: () => fakeOk({ echo: "hi" }),
		});
		const kernel = createArchonKernel({ root, db, settings, calls: { engine } });

		const node = await kernel.container({ kind: "archon-node", key: ["run-1", "inv-1", "att-1"] });

		const result = await kernel.call("Echo", ["hi"], { model: "fast", containerId: node.id });

		expect(result).toEqual({ echo: "hi" });
		const [start] = await getTraceEventsForRun(db, engine.invocations[0]!.tags.runId!, ["call_start"]);
		expect(start?.eventData).toMatchObject({ model: STUB_MODEL, model_alias: "fast" });
	});
});
