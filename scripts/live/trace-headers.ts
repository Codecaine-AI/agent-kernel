/**
 * Live proof that kernel requests carry the X-Trace-* headers.
 *
 * Sends 3 tagged requests under one minted engine run_id, each with its own
 * node_path and its own tagged container:
 *   1. one bundle turn (spawnAgent) through Token Gateway,
 *   2. one standalone kernel.call (Pi transport) through Token Gateway,
 *   3. one standalone kernel.decide on typesafe/jev-1.13.0, sent to TypeSafe.
 * The Pi agent dir's models.json routes the codex-lb models to Token Gateway.
 * Token Gateway handles LLM calls only, so the decide leaves no gateway row:
 * the script checks its agent_runs row in the kernel trace.db instead.
 *
 * Usage: bun scripts/live/trace-headers.ts
 * Prints run_id=<id>. Check the gateway rows of the 2 LLM node paths with
 * traces-sql against agents.llm_calls once trace-ingest loads them.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { createKernel, type CallEngine } from "@codecaine-ai/agent-kernel";
import { ensureKernelObservabilitySchema, openKernelDatabase } from "@codecaine-ai/agent-kernel-db";
import { TRACE_TAGS, type TraceTags } from "@codecaine-ai/agent-kernel-protocol";
import { sql } from "drizzle-orm";

const PI_AGENT_DIR = "/Users/Ford/workspace/codebases/codecaine/core/agent-kernel/.pi-agent";
const LLM_MODEL = "codex-lb/gpt-5.6-sol";
const DECIDE_MODEL = "typesafe/jev-1.13.0";

function fail(message: string): never {
	console.error(`FAIL: ${message}`);
	process.exit(1);
}

// Pi reads TYPESAFE_API_KEY from the environment. Take it from the workspace
// .env when the shell does not set it; never print it.
if (!process.env.TYPESAFE_API_KEY) {
	const envFile = join(homedir(), "workspace", ".env");
	const line = existsSync(envFile)
		? readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("TYPESAFE_API_KEY="))
		: undefined;
	const value = line?.slice("TYPESAFE_API_KEY=".length).trim().replace(/^(['"])(.*)\1$/, "$2");
	if (!value) fail("TYPESAFE_API_KEY is not set and not in ~/workspace/.env");
	process.env.TYPESAFE_API_KEY = value;
}

const runId = `cp5-live-${randomUUID()}`;
console.log(`run_id=${runId}`);
const tagsFor = (nodePath: string): TraceTags => ({
	engine: "agent-kernel-live",
	run_id: runId,
	node_path: nodePath,
	invocation_id: randomUUID(),
	attempt_id: randomUUID(),
});

// ── temp kernel root and 1-turn fixture bundle ────────────────────────────────
const root = mkdtempSync(join(tmpdir(), "trace-headers-live-"));
const catalogRoot = join(root, "catalog");
const bundleDir = join(catalogRoot, "live-turn");
mkdirSync(bundleDir, { recursive: true });
writeFileSync(
	join(bundleDir, "agent.json"),
	JSON.stringify({ name: "live-turn", description: "1-turn trace header fixture", model: LLM_MODEL, maxTurns: 1 }),
);
writeFileSync(
	join(bundleDir, "prompt.json"),
	JSON.stringify({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id: "liveTurnPrompt",
		nodes: [{ type: "section", tag: "task", children: [{ type: "paragraph", content: ["Reply with one word."] }] }],
	}),
);

interface LiveCalls {
	Reply(prompt: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

/** A one-function call engine that sends through the kernel's Pi transport. */
const callEngine: CallEngine<LiveCalls> = {
	engine: "pi-ai",
	transportFor: () => "pi",
	functionNames: () => ["Reply"],
	manifest: () => undefined,
	promptHash: () => "live-reply-v1",
	async invoke(req) {
		const out = await req.transport.complete({
			systemPrompt: "Reply with one word.",
			messages: [{ role: "user", text: String(req.args[0]) }],
		});
		if (out.text === null) {
			return { ok: false, failure: { kind: "other", message: out.errorMessage ?? "no text" }, attempts: [out.attempt], rawText: null };
		}
		// Reply is the only function, so its result type is string.
		return { ok: true, value: out.text as never, attempts: [out.attempt], rawText: out.text };
	},
};

const dbHandle = openKernelDatabase({ path: join(root, "trace.db") });
await ensureKernelObservabilitySchema(dbHandle.db);
const kernel = createKernel<unknown, LiveCalls>({
	id: "trace-headers-live",
	db: dbHandle.db,
	catalog: { roots: [catalogRoot] },
	piSessionsDir: join(root, "pi-sessions"),
	piAgentDir: PI_AGENT_DIR,
	calls: { engine: callEngine },
	models: { defaults: { call: LLM_MODEL, decide: DECIDE_MODEL } },
});

const containerFor = async (traceTags: TraceTags) =>
	(await kernel.container({ kind: "live-node", key: [runId, traceTags.node_path!], traceTags })).id;

try {
	// 1. One tagged bundle turn through Token Gateway.
	const turnTags = tagsFor("live/turn");
	const turn = await kernel.spawnAgent("live-turn", "Say ok.", null, {
		workingDir: root,
		containerId: await containerFor(turnTags),
		traceTags: turnTags,
	});
	if (!turn.responseText) fail("the bundle turn returned no text");
	console.log(`turn: node_path=live/turn kernel_run=${turn.runId} text=${JSON.stringify(turn.responseText.slice(0, 40))}`);

	// 2. One standalone kernel.call with an explicit containerId, outside the run.
	const callTags = tagsFor("live/call");
	let callRun = "";
	const reply = await kernel.call("Reply", ["Say ok."], {
		containerId: await containerFor(callTags),
		traceTags: callTags,
		onNodeStarted: (ids) => {
			callRun = ids.runId;
		},
	});
	console.log(`call: node_path=live/call kernel_run=${callRun} text=${JSON.stringify(String(reply).slice(0, 40))}`);

	// 3. One standalone kernel.decide on Jev, sent to TypeSafe.
	const decideTags = tagsFor("live/decide");
	const decision = await kernel.decide(
		"live-decide",
		{ claim: "The sky is blue on a clear day." },
		{
			model: DECIDE_MODEL,
			containerId: await containerFor(decideTags),
			traceTags: decideTags,
			questions: {
				true_claim: {
					type: "bool",
					instructions: "Is the claim true?",
					criteria: { true: "The claim is true.", false: "The claim is false." },
				},
			},
		},
	);
	if (decision.error) fail(`the decide got an engine error: ${decision.error.kind}`);
	console.log(`decide: node_path=live/decide kernel_run=${decision.ids.runId} model=${decision.model} chosen=${decision.chosen}`);

	// The decide's record: an agent_runs row under a container whose 6 tag columns hold its tags.
	await kernel.traceWriter.flush();
	const columns = TRACE_TAGS.map(({ tag }) => tag);
	const [row] = dbHandle.db.all<Record<string, string | null>>(
		sql.raw(
			`SELECT ${columns.map((c) => `c.${c}`).join(", ")} FROM agent_runs r JOIN containers c ON c.id = r.container_id WHERE r.id = '${decision.ids.runId.replaceAll("'", "''")}'`,
		),
	);
	if (!row) fail(`the decide has no agent_runs row under a container (kernel run ${decision.ids.runId})`);
	for (const tag of columns) {
		const want = decideTags[tag] ?? null;
		if (row[tag] !== want) fail(`decide container column ${tag} is ${JSON.stringify(row[tag])}, want ${JSON.stringify(want)}`);
	}
	console.log("decide record: agent_runs row found; its container holds the 6 tags of the decide");
	console.log(`kernel root: ${root}`);
	console.log(`PASS run_id=${runId}`);
} finally {
	await kernel.traceWriter.flush();
	kernel.dispose();
	dbHandle.close();
}
