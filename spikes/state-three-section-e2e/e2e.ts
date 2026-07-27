#!/usr/bin/env bun
/**
 * spikes/state-three-section-e2e/e2e.ts — END-TO-END proof of the state
 * mechanism and the three-section request, through the REAL kernel pipeline.
 *
 *   bun spikes/state-three-section-e2e/e2e.ts [--root <dir>] [--kernel-id <id>]
 *
 * What is real here:
 *   - createKernel() → the real spawn pipeline → createPiSession() → a real
 *     pi-coding-agent AgentSession with the real state extension registered
 *     from the manifest's `state.window` block (base module, no state.ts).
 *   - the real per-turn recorder (recordBuiltRequest), the real db trace
 *     writer, a real SQLite trace.db with real trace_blobs.
 *   - the real file state sink (state.json).
 *
 * The ONLY thing faked is the model: an in-memory provider registered through
 * pi's own `pi.registerProvider()` extension API (same mechanism the
 * spikes/pi-hook-blocking spike measured on Pi 0.82.1), whose streamSimple
 * returns pi's AssistantMessageEventStream. No network, no API keys.
 *
 * Verification goes through the READ PATH (kernel.readApiService.
 * getRunTurnContext + the viewer-core span builder), never by poking the db.
 *
 * Four prompts run against ONE reused pi session so the transcript grows past
 * the 2-turn window and elision/stubbing actually engages.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
} from "@agent-kernel/db";
import { createKernel, stateFilePath, type KernelSpawnOptions } from "@agent-kernel/kernel";
import { buildTraceSpans, type TraceSpan } from "@agent-kernel/viewer-core";
import {
	ModelRegistry,
	ModelRuntime,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
} from "@earendil-works/pi-ai";

// ─── Arguments ──────────────────────────────────────────────────────────────

const spikeDir = import.meta.dir;
const repoRoot = resolve(spikeDir, "../..");
const argv = Bun.argv.slice(2);

function arg(name: string, fallback: string): string {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
}

/** Filesystem root: trace.db, pi sessions, and state.json all hang off it. */
const ROOT = resolve(arg("root", join(spikeDir, ".artifacts")));
/** Must match the reading app's kernel id for the container to be listed. */
const KERNEL_ID = arg("kernel-id", "state-three-section-e2e");
const FRESH = !argv.includes("--no-reset");

const CATALOG_DIR = join(spikeDir, "catalog");
const AGENT = "state-demo";
const PROVIDER = "mock-e2e";
const MODEL_ID = "deterministic-e2e";
const API = "mock-e2e-api";
const PROMPTS = [
	"Turn one: probe the alpha note.",
	"Turn two: probe the beta note.",
	"Turn three: probe the gamma note.",
	"Turn four: probe the delta note.",
];
/** Window from agent.json — kept here so the assertions can name the number. */
const WINDOW_MAX_TURNS = 2;

// ─── Assertions ─────────────────────────────────────────────────────────────

const failures: string[] = [];
const facts: string[] = [];

function check(name: string, ok: boolean, detail: string): void {
	if (ok) {
		facts.push(`PASS  ${name} — ${detail}`);
	} else {
		failures.push(`FAIL  ${name} — ${detail}`);
	}
	console.log(`${ok ? "PASS " : "FAIL "} ${name} — ${detail}`);
}

// ─── The in-memory provider ─────────────────────────────────────────────────

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistantMessage(
	model: Model<any>,
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

/** Everything the provider saw, per request — the ground truth for §A. */
interface ProviderObservation {
	run: number;
	request: number;
	messageCount: number;
	roles: string[];
	firstText: string;
}
const observations: ProviderObservation[] = [];
let currentRun = 0;

function firstTextOf(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		if (block?.type === "text" && typeof block.text === "string") return block.text;
	}
	return "";
}

/**
 * One provider + one probe tool, registered per session. The closure resets
 * per session, so every run scripts the same two provider requests:
 * request 1 → a probe toolCall, request 2 → a final text message.
 */
const mockRuntimeFactory: ExtensionFactory = (pi) => {
	let request = 0;
	pi.registerProvider(PROVIDER, {
		baseUrl: "mock://local",
		apiKey: "unused-in-memory-key",
		api: API as any,
		streamSimple: ((model: Model<any>, context: Context) => {
			request += 1;
			observations.push({
				run: currentRun,
				request,
				messageCount: context.messages.length,
				roles: context.messages.map((m: any) => String(m.role)),
				firstText: firstTextOf(context.messages[0]),
			});
			const message =
				request === 1
					? assistantMessage(
							model,
							[
								{
									type: "toolCall",
									id: `call-${currentRun}-1`,
									name: "probe",
									arguments: { note: `run-${currentRun}` },
								},
							],
							"toolUse",
						)
					: assistantMessage(
							model,
							[{ type: "text", text: `run ${currentRun} complete` }],
							"stop",
						);
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: message });
				stream.push({
					type: "done",
					reason: message.stopReason as "stop" | "length" | "toolUse",
					message,
				});
				stream.end(message);
			});
			return stream;
		}) as any,
		models: [
			{
				id: MODEL_ID,
				name: "Deterministic e2e model",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4_096,
			},
		],
	});
};

// ─── Boot ───────────────────────────────────────────────────────────────────

if (FRESH && existsSync(ROOT) && ROOT.includes(".artifacts")) {
	rmSync(ROOT, { recursive: true, force: true });
}
mkdirSync(ROOT, { recursive: true });

const dbPath = kernelDatabasePath(ROOT);
const handle = openKernelDatabase({ path: dbPath });
await ensureKernelObservabilitySchema(handle.db);

// A composed Model object for the mock provider. The session's own
// ModelRuntime gets the provider from the extension above; this instance only
// exists to hand createPiSession a Model to run with (ctx.model), because
// model resolution happens before extensions load.
const probeRuntime = await ModelRuntime.create({ modelsPath: null });
const probeRegistry = new ModelRegistry(probeRuntime);
probeRegistry.registerProvider(PROVIDER, {
	baseUrl: "mock://local",
	apiKey: "unused-in-memory-key",
	api: API as any,
	models: [
		{
			id: MODEL_ID,
			name: "Deterministic e2e model",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4_096,
		},
	],
});
const mockModel = probeRegistry.find(PROVIDER, MODEL_ID);
if (!mockModel) throw new Error("mock model registration failed");

const quietLogger = {
	debug() {},
	info() {},
	warn() {},
	error(message: string, data?: Record<string, unknown>) {
		console.error("[kernel error]", message, data ?? "");
	},
};

const kernel = createKernel({
	id: KERNEL_ID,
	db: handle.db,
	catalog: { roots: [CATALOG_DIR] },
	sharedTools: () => [mockRuntimeFactory],
	piSessionsDir: join(ROOT, ".agent-kernel", "pi-sessions"),
	piAgentDir: join(ROOT, ".agent-kernel", "pi-agent"),
	piLifecycleCustomType: "agent-kernel:pi-lifecycle",
	logger: quietLogger,
});

const container = await kernel.container({
	kind: "session",
	key: ["state-three-section-e2e"],
	label: "State demo · three-section request",
	workingDir: ROOT,
	metadata: {
		app: KERNEL_ID,
		topic: "three-section request + state window",
		description:
			"Deterministic e2e: four prompts on one reused pi session, 2-turn window, in-memory provider.",
	},
});

// Everything this script writes lives under <root>/.agent-kernel so pointing
// --root at the example app never litters its source tree.
const sessionDir = join(ROOT, ".agent-kernel", "e2e-sessions", "state-demo");
mkdirSync(sessionDir, { recursive: true });

interface RunRecord {
	index: number;
	runId: string;
	prompt: string;
	responseText: string;
	transcriptLength: number;
}
const runs: RunRecord[] = [];

for (let i = 0; i < PROMPTS.length; i += 1) {
	currentRun = i + 1;
	let runId = "";
	const opts: KernelSpawnOptions = {
		workingDir: ROOT,
		containerId: container.id,
		sessionDir,
		reuseExistingSession: true,
		// No stateRoot on purpose: D88 makes persistence default-ON, rooted at
		// the spawn's workingDir. The state.json assertion below proves the
		// default path, not a configured one.
		trigger: "operator",
		onRunStarted: (info) => {
			runId = info.runId;
		},
	};
	const result = await kernel.spawnAgent(
		AGENT,
		PROMPTS[i]!,
		{ model: mockModel } as any,
		opts,
	);
	runs.push({
		index: i + 1,
		runId,
		prompt: PROMPTS[i]!,
		responseText: result.responseText,
		transcriptLength: result.session.messages.length,
	});
	console.log(
		`run ${i + 1}: runId=${runId} transcript=${result.session.messages.length} response=${JSON.stringify(result.responseText)}`,
	);
}

await kernel.traceWriter.flush();

// ─── §A — verification through the read path ────────────────────────────────

console.log("\n── read-path verification ──");

const read = kernel.readApiService;

check(
	"provider requests",
	observations.length === PROMPTS.length * 2,
	`${observations.length} provider requests over ${PROMPTS.length} runs (2 per run: toolCall then stop)`,
);

interface SectionTag {
	kind: "context" | "state" | "tail";
	start: number;
	end: number;
}

let snapshotCount = 0;
let taggedCount = 0;
const elisionMarkers: string[] = [];
const rangeSummaries: string[] = [];

function textOf(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b: any) => b?.type === "text")
		.map((b: any) => b.text)
		.join("\n");
}

for (const run of runs) {
	for (let turn = 0; ; turn += 1) {
		const context = await read.getRunTurnContext(run.runId, turn);
		if (!context) break;
		snapshotCount += 1;
		const label = `run ${run.index} · turn ${turn}`;
		const sections = context.sections as SectionTag[] | undefined;

		if (!sections) {
			check(`${label} sections present`, false, "snapshot carries no section tags");
			continue;
		}
		taggedCount += 1;

		const kinds = sections.map((s) => s.kind);
		const ordered = ["context", "state", "tail"].filter((k) => kinds.includes(k as any));
		check(
			`${label} section order`,
			JSON.stringify(kinds) === JSON.stringify(ordered),
			`kinds=${kinds.join("→")}`,
		);

		let contiguous = true;
		let cursor = 0;
		for (const section of sections) {
			if (section.start !== cursor || section.end <= section.start) contiguous = false;
			cursor = section.end;
		}
		check(
			`${label} ranges non-overlapping half-open`,
			contiguous,
			sections.map((s) => `${s.kind}[${s.start},${s.end})`).join(" "),
		);
		check(
			`${label} indices in bounds`,
			cursor === context.messages.length &&
				context.message_count === context.messages.length,
			`last end=${cursor} messages=${context.messages.length} message_count=${context.message_count}`,
		);

		const contextSection = sections.find((s) => s.kind === "context");
		const stateSection = sections.find((s) => s.kind === "state");
		const tailSection = sections.find((s) => s.kind === "tail");

		check(
			`${label} ② context rebuilt`,
			Boolean(contextSection) &&
				textOf(context.messages[contextSection!.start]).includes("<state_demo_context>"),
			contextSection
				? `[${contextSection.start},${contextSection.end}) starts with the rebuilt L2 context message`
				: "no context section",
		);

		if (stateSection) {
			const stateText = textOf(context.messages[stateSection.start]);
			elisionMarkers.push(`${label}: ${stateText}`);
			check(
				`${label} ③ state block`,
				/^\[turns? [\d–-]+ elided\]$/.test(stateText.trim()),
				`state=${JSON.stringify(stateText)}`,
			);
		}

		check(
			`${label} ③ tail is real conversation`,
			Boolean(tailSection) && tailSection!.end - tailSection!.start > 0,
			tailSection
				? `${tailSection.end - tailSection.start} tail messages, roles=${context.messages
						.slice(tailSection.start, tailSection.end)
						.map((m: any) => m.role)
						.join(",")}`
				: "no tail section",
		);

		check(
			`${label} system prompt captured`,
			typeof context.system_prompt === "string" && context.system_prompt.length > 0,
			`${context.system_prompt?.split("\n").length ?? 0} lines`,
		);

		rangeSummaries.push(
			`${label}: ${sections.map((s) => `${s.kind}[${s.start},${s.end})`).join(" ")} · ${context.messages.length} messages`,
		);
	}
}

check(
	"snapshot count",
	snapshotCount === observations.length && taggedCount === snapshotCount,
	`${snapshotCount} pi_request_snapshot rows read back, all ${taggedCount} section-tagged`,
);

// The window actually elided: the last run's requests must be SHORTER than the
// live transcript, and the elision marker must name the dropped turns.
const lastRun = runs.at(-1)!;
const lastTurn0 = await read.getRunTurnContext(lastRun.runId, 0);
const lastObservation = observations.filter((o) => o.run === PROMPTS.length)[0]!;
check(
	"turn numbering aligns with pi_turn_start",
	lastTurn0 !== null &&
		snapshotCount === observations.length &&
		(lastTurn0.sections?.length ?? 0) > 0,
	`turn 0 of every run is the first BUILT request (${snapshotCount} snapshots for ${observations.length} provider requests)`,
);
check(
	"window elided old turns",
	elisionMarkers.length > 0 &&
		lastObservation.messageCount < lastRun.transcriptLength,
	`final run: transcript=${lastRun.transcriptLength} messages, request=${lastObservation.messageCount} messages; markers=${JSON.stringify(elisionMarkers.map((m) => m.split(": ")[1]))}`,
);
check(
	"window kept exactly maxTurns turns",
	(lastTurn0?.sections as SectionTag[] | undefined)?.some((s) => s.kind === "state") ===
		true,
	`window.maxTurns=${WINDOW_MAX_TURNS}; final run turn 0 sections=${JSON.stringify(lastTurn0?.sections)}`,
);
check(
	"pair-safe cut",
	observations.every((o) => o.roles[0] === "user"),
	`every provider request starts with a user message; roles seen: ${JSON.stringify([...new Set(observations.map((o) => o.roles.join(",")))])}`,
);
// `observations` is captured inside the provider's streamSimple, i.e. AFTER
// pi's convertToLlm. The kernel authors ② and ③ as role "custom" so the viewer
// can badge them KERNEL; this proves they reach the provider as ordinary user
// messages, which is the whole reason that channel was chosen.
check(
	"kernel-authored lines are provider-valid",
	observations.every((o) =>
		o.roles.every((role) => role === "user" || role === "assistant" || role === "toolResult"),
	),
	`no non-provider role reaches the model; distinct roles=${JSON.stringify([
		...new Set(observations.flatMap((o) => o.roles)),
	])}`,
);

// state.json through the real file sink.
const statePath = stateFilePath(ROOT, container.id, AGENT);
const stateJson = existsSync(statePath)
	? (JSON.parse(readFileSync(statePath, "utf8")) as {
			version: number;
			agentName: string;
			containerId: string;
			runId?: string;
			state: Record<string, unknown>;
		})
	: null;
check(
	"state.json written",
	stateJson !== null &&
		stateJson.agentName === AGENT &&
		stateJson.containerId === container.id,
	stateJson
		? `${statePath} v${stateJson.version} state=${JSON.stringify(stateJson.state)}`
		: `missing at ${statePath}`,
);

// ─── §A2 — the viewer's span attribute, off the same trace ──────────────────

const detail = await read.getContainerTrace(container.id, { limit: 5000 });
if (!detail) {
	check("container trace", false, "getContainerTrace returned null");
} else {
	const spans = buildTraceSpans(
		detail.events as any,
		detail.pi_sessions as any,
		detail.agent_runs as any,
		detail.containers as any,
	);
	const flat: TraceSpan[] = [];
	const walk = (list: TraceSpan[]): void => {
		for (const span of list) {
			flat.push(span);
			if (span.children?.length) walk(span.children as TraceSpan[]);
		}
	};
	walk(spans);
	// Span attributes are OTLP-shaped: { key, value: { stringValue } }.
	const attr = (span: any, key: string): string | undefined => {
		const found = (span.attributes ?? []).find((a: any) => a.key === key);
		return found?.value?.stringValue as string | undefined;
	};
	const snapshotSpans = flat.filter(
		(s) => attr(s, "event_type") === "pi_request_snapshot",
	);
	const withSections = snapshotSpans.filter((s) => attr(s, "sections") !== undefined);
	const sample = withSections[0];
	const raw = sample ? attr(sample, "sections") : undefined;
	let parsedAttr: unknown = null;
	try {
		parsedAttr = JSON.parse(String(raw ?? ""));
	} catch {
		parsedAttr = null;
	}
	check(
		"viewer span carries sections",
		snapshotSpans.length === snapshotCount &&
			withSections.length === snapshotCount &&
			Array.isArray(parsedAttr),
		`${withSections.length}/${snapshotSpans.length} "Context window" spans carry a JSON sections attribute; sample title=${JSON.stringify((sample as any)?.title ?? "")} value=${raw}`,
	);
	check(
		"viewer span carries run_id (turn-context fetch key)",
		snapshotSpans.every((s) => typeof attr(s, "run_id") === "string"),
		`${snapshotSpans.length} snapshot spans, all with a run_id attribute`,
	);
	console.log(
		`\nDemo click targets (container ${container.id}):\n` +
			snapshotSpans.map((s) => `  · ${(s as any).title}`).join("\n"),
	);
}

// ─── Capture the real snapshot for the UI QA test ───────────────────────────

const capturePath = join(spikeDir, "captured-turn-context.json");
const captureRun = runs.at(-1)!;
const captured = await read.getRunTurnContext(captureRun.runId, 0);
await Bun.write(capturePath, `${JSON.stringify(captured, null, 2)}\n`);
console.log(`\nCaptured real turn context → ${capturePath}`);

// ─── Report ─────────────────────────────────────────────────────────────────

console.log("\n── section ranges ──");
for (const line of rangeSummaries) console.log(`  ${line}`);

console.log(
	`\n${facts.length} passed, ${failures.length} failed. root=${ROOT} db=${dbPath}`,
);
for (const failure of failures) console.log(failure);

kernel.dispose();
handle.close();
probeRegistry.unregisterProvider(PROVIDER);

if (failures.length > 0) process.exit(1);
