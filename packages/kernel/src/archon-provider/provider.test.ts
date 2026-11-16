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
	startTraceHeaderStub,
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

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "archon-provider-"));
	answers = {};
	globalThis.fetch = realFetch;
	stub = startTraceHeaderStub((_index, body) => {
		const key = Object.keys(answers).find((k) => body.includes(k));
		return textStream(key ? answers[key]! : '{"echo":"default"}');
	});
	const piAgentDir = join(root, "pi-agent");
	mkdirSync(piAgentDir, { recursive: true });
	writeFileSync(
		join(piAgentDir, "models.json"),
		JSON.stringify({
			providers: {
				stub: {
					baseUrl: stub.url,
					api: "openai-responses",
					apiKey: "sk-stub-key-0123456789",
					models: [{ id: "stub-model", name: "Stub", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
				},
			},
		}),
	);
});

afterEach(async () => {
	const { kernel } = await archonKernel(root, assistantConfig());
	await kernel.traceWriter.flush();
	kernel.dispose();
	stub.stop();
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
): Promise<AgentKernelChunk[]> {
	const provider = createAgentKernelProvider({ root });
	const chunks: AgentKernelChunk[] = [];
	for await (const chunk of provider.sendQuery(prompt, root, undefined, {
		model: "echo-bundle",
		env,
		assistantConfig: assistantConfig(),
		...extra,
	})) {
		chunks.push(chunk);
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
		const [a, b] = await Promise.all([archonKernel(root, undefined), archonKernel(root, undefined)]);
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
