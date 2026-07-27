import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
	ModelRuntime,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type ExtensionFactory,
} from "../../node_modules/.bun/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import {
	createAssistantMessageEventStream,
	Type,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "../../node_modules/.bun/node_modules/@earendil-works/pi-ai/dist/index.js";

const HOOK_DELAY_MS = 300;
const SLOW_TURN_END_DELAY_MS = 1_000;
const TOOL_NAME = "spike_probe";
const ALLOW_CALL_ID = "call-allow";
const VETO_CALL_ID = "call-veto";
const VETO_REASON = "veto requested by spike";
const MOCK_PROVIDER = "pi-hook-spike";
const MOCK_API = "pi-hook-spike-api";
const MOCK_MODEL_ID = "deterministic-model";

const spikeDir = import.meta.dir;
const repoRoot = resolve(spikeDir, "../..");
const resultsPath = join(spikeDir, "RESULTS.md");

interface TimelineEvent {
	sequence: number;
	atMs: number;
	event: string;
	detail: string;
}

const timeline: TimelineEvent[] = [];
let timelineOrigin = performance.now();

function mark(event: string, detail = ""): void {
	timeline.push({
		sequence: timeline.length + 1,
		atMs: performance.now() - timelineOrigin,
		event,
		detail,
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function logDelay(event: string, ms: number, detail = ""): Promise<void> {
	mark(`${event}.start`, detail);
	await sleep(ms);
	mark(`${event}.end`, detail);
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
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

let providerRequestCount = 0;

function mockProviderStream(
	model: Model<any>,
	context: Context,
	_options?: SimpleStreamOptions,
) {
	const request = ++providerRequestCount;
	const toolResultCount = context.messages.filter((message) => message.role === "toolResult").length;
	mark(
		`provider[${request}].enter`,
		`messages=${context.messages.length}, toolResults=${toolResultCount}`,
	);

	let message: AssistantMessage;
	if (request === 1) {
		message = assistantMessage(
			model,
			[
				{
					type: "toolCall",
					id: ALLOW_CALL_ID,
					name: TOOL_NAME,
					arguments: { mode: "allow" },
				},
				{
					type: "toolCall",
					id: VETO_CALL_ID,
					name: TOOL_NAME,
					arguments: { mode: "veto" },
				},
			],
			"toolUse",
		);
	} else if (request === 2) {
		message = assistantMessage(
			model,
			[{ type: "text", text: "scripted run complete" }],
			"stop",
		);
	} else {
		throw new Error(`Unexpected provider request ${request}; the script has exactly two responses`);
	}

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
}

let contextInvocation = 0;
const executedToolCallIds: string[] = [];
const toolResultHookCallIds: string[] = [];

const instrumentedExtension: ExtensionFactory = (pi) => {
	pi.on("context", async (event) => {
		const invocation = ++contextInvocation;
		await logDelay(
			`context[${invocation}]`,
			HOOK_DELAY_MS,
			`messages=${event.messages.length}`,
		);
		return { messages: event.messages };
	});

	pi.on("turn_start", async (event) => {
		await logDelay(`turn_start[${event.turnIndex}]`, HOOK_DELAY_MS);
	});

	pi.on("turn_end", async (event) => {
		const delay = event.turnIndex === 0 ? SLOW_TURN_END_DELAY_MS : HOOK_DELAY_MS;
		await logDelay(`turn_end[${event.turnIndex}]`, delay, `sleep=${delay}ms`);
	});

	pi.on("agent_end", async () => {
		await logDelay("agent_end", HOOK_DELAY_MS);
	});

	pi.on("tool_call", async (event) => {
		const mode = String((event.input as { mode?: unknown }).mode);
		await logDelay(`tool_call[${event.toolCallId}]`, HOOK_DELAY_MS, `mode=${mode}`);
		if (mode === "veto") {
			return { block: true, reason: VETO_REASON };
		}
	});

	pi.on("tool_result", async (event) => {
		toolResultHookCallIds.push(event.toolCallId);
		await logDelay(
			`tool_result[${event.toolCallId}]`,
			HOOK_DELAY_MS,
			`isError=${event.isError}`,
		);
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Spike probe",
		description: "A deterministic no-op tool used to measure Pi extension hook timing.",
		parameters: Type.Object({
			mode: Type.Union([Type.Literal("allow"), Type.Literal("veto")]),
		}),
		executionMode: "sequential",
		async execute(toolCallId, params) {
			executedToolCallIds.push(toolCallId);
			mark(`tool.execute[${toolCallId}].start`, `mode=${params.mode}`);
			await Promise.resolve();
			mark(`tool.execute[${toolCallId}].end`, `mode=${params.mode}`);
			return {
				content: [{ type: "text", text: `executed ${params.mode}` }],
				details: { mode: params.mode },
			};
		},
	});
};

function packageVersion(packageName: string): string {
	const packageJsonPath = join(
		repoRoot,
		"node_modules/.bun/node_modules/@earendil-works",
		packageName,
		"package.json",
	);
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
	return packageJson.version;
}

function eventAt(name: string): number {
	const found = timeline.find((entry) => entry.event === name);
	if (!found) {
		throw new Error(`Timeline event not found: ${name}`);
	}
	return found.atMs;
}

function duration(name: string): number {
	return eventAt(`${name}.end`) - eventAt(`${name}.start`);
}

function formatMs(value: number): string {
	return value.toFixed(1);
}

function markdownEscape(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderTimelineTable(): string {
	const ordered = [...timeline].sort(
		(left, right) => left.atMs - right.atMs || left.sequence - right.sequence,
	);
	const rows = ordered.map(
		(entry) =>
			`| ${entry.sequence} | ${formatMs(entry.atMs)} | ${markdownEscape(entry.event)} | ${markdownEscape(entry.detail)} |`,
	);
	return [
		"| # | t (ms) | Event | Detail |",
		"|---:|---:|---|---|",
		...rows,
	].join("\n");
}

function assertMeasured(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(`Measurement assertion failed: ${message}`);
	}
}

const versions = {
	"pi-coding-agent": packageVersion("pi-coding-agent"),
	"pi-agent-core": packageVersion("pi-agent-core"),
	"pi-ai": packageVersion("pi-ai"),
};

assertMeasured(
	Object.values(versions).every((version) => version === "0.82.1"),
	`expected Pi 0.82.1 packages, found ${JSON.stringify(versions)}`,
);

const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: false },
	enableInstallTelemetry: false,
});
const resourceLoader = new DefaultResourceLoader({
	cwd: repoRoot,
	agentDir: spikeDir,
	settingsManager,
	extensionFactories: [instrumentedExtension],
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
	systemPrompt: "Deterministic Pi extension-hook timing spike.",
});
await resourceLoader.reload();

// Pi 0.82: AuthStorage/ModelRegistry.inMemory() were replaced by ModelRuntime.
// modelsPath: null keeps the catalog purely in-memory (no models.json read).
const modelRuntime = await ModelRuntime.create({ modelsPath: null });
const modelRegistry = new ModelRegistry(modelRuntime);
modelRegistry.registerProvider(MOCK_PROVIDER, {
	baseUrl: "mock://local",
	apiKey: "unused-in-memory-key",
	api: MOCK_API as any,
	streamSimple: mockProviderStream as any,
	models: [
		{
			id: MOCK_MODEL_ID,
			name: "Deterministic spike model",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4_096,
		},
	],
});
const model = modelRegistry.find(MOCK_PROVIDER, MOCK_MODEL_ID);
if (!model) {
	throw new Error("Mock model registration failed");
}

const { session, extensionsResult } = await createAgentSession({
	cwd: repoRoot,
	agentDir: spikeDir,
	modelRuntime,
	model,
	thinkingLevel: "off",
	tools: [TOOL_NAME],
	resourceLoader,
	sessionManager: SessionManager.inMemory(repoRoot),
	settingsManager,
});
assertMeasured(extensionsResult.errors.length === 0, "inline extension failed to load");
assertMeasured(
	session.constructor.name === "AgentSession",
	`expected a real AgentSession, got ${session.constructor.name}`,
);

timelineOrigin = performance.now();
mark("prompt.start");
await session.prompt("Run the deterministic hook timing spike.", {
	expandPromptTemplates: false,
});
mark("prompt.resolve");

// AgentSession deliberately does not expose an event-queue drain API. Read the queue
// only after measuring prompt resolution so the process stays alive long enough to
// capture the decoupled turn_end and agent_end handler completions.
const queuedExtensionWork = (
	session as unknown as { _agentEventQueue: Promise<void> }
)._agentEventQueue;
await queuedExtensionWork;
mark("extension_queue.drained");

const vetoResult = session.messages.find(
	(message) => message.role === "toolResult" && message.toolCallId === VETO_CALL_ID,
);
const vetoResultText =
	vetoResult?.role === "toolResult"
		? vetoResult.content
				.filter((content) => content.type === "text")
				.map((content) => content.text)
				.join("")
		: "";

const contextToProvider1 = eventAt("provider[1].enter") - eventAt("context[1].start");
const contextToProvider2 = eventAt("provider[2].enter") - eventAt("context[2].start");
const contextEndToProvider1 = eventAt("provider[1].enter") - eventAt("context[1].end");
const contextEndToProvider2 = eventAt("provider[2].enter") - eventAt("context[2].end");
const slowTurnEndStart = eventAt("turn_end[0].start");
const slowTurnEndEnd = eventAt("turn_end[0].end");
const provider2At = eventAt("provider[2].enter");
const promptResolvedAt = eventAt("prompt.resolve");
const agentEndStart = eventAt("agent_end.start");
const agentEndEnd = eventAt("agent_end.end");
const allowedToolCallStart = eventAt(`tool_call[${ALLOW_CALL_ID}].start`);
const allowedToolCallEnd = eventAt(`tool_call[${ALLOW_CALL_ID}].end`);
const allowedToolExecuteStart = eventAt(`tool.execute[${ALLOW_CALL_ID}].start`);

assertMeasured(providerRequestCount === 2, `expected two provider requests, got ${providerRequestCount}`);
assertMeasured(
	contextToProvider1 >= HOOK_DELAY_MS - 30 && contextToProvider2 >= HOOK_DELAY_MS - 30,
	"context handlers did not impose their configured delay before provider entry",
);
assertMeasured(
	contextEndToProvider1 >= 0 &&
		contextEndToProvider1 < 75 &&
		contextEndToProvider2 >= 0 &&
		contextEndToProvider2 < 75,
	"provider entry did not closely follow context handler completion",
);
assertMeasured(
	provider2At < slowTurnEndEnd,
	"provider request 2 did not race ahead of the slow turn_end handler",
);
assertMeasured(
	eventAt("context[2].start") < slowTurnEndEnd,
	"context handler 2 did not race ahead of the slow turn_end handler",
);
assertMeasured(
	promptResolvedAt < slowTurnEndEnd && promptResolvedAt < agentEndEnd,
	"session.prompt did not resolve before lifecycle extension work settled",
);
assertMeasured(
	allowedToolExecuteStart >= allowedToolCallEnd &&
		allowedToolExecuteStart - allowedToolCallStart >= HOOK_DELAY_MS - 30,
	"tool execution did not await the tool_call hook",
);
assertMeasured(
	executedToolCallIds.includes(ALLOW_CALL_ID),
	"allowed tool call did not execute",
);
assertMeasured(
	!executedToolCallIds.includes(VETO_CALL_ID),
	"vetoed tool call unexpectedly executed",
);
assertMeasured(
	vetoResult?.role === "toolResult" && vetoResult.isError && vetoResultText.includes(VETO_REASON),
	"veto did not produce Pi's synthesized error tool result with the supplied reason",
);
assertMeasured(
	toolResultHookCallIds.includes(ALLOW_CALL_ID) &&
		!toolResultHookCallIds.includes(VETO_CALL_ID),
	"tool_result hook invocation did not match allowed/vetoed call semantics",
);

const raceEvents = [
	"turn_end[0].start",
	"context[2].start",
	"provider[2].enter",
	"prompt.resolve",
	"turn_end[0].end",
]
	.map((event) => ({ event, atMs: eventAt(event) }))
	.sort((left, right) => left.atMs - right.atMs);
const raceOrdering = raceEvents
	.map(({ event, atMs }) => `${event} (${formatMs(atMs)} ms)`)
	.join(" → ");

const providerAfterSlowStart = provider2At - slowTurnEndStart;
const providerBeforeSlowEnd = slowTurnEndEnd - provider2At;
const promptBeforeSlowEnd = slowTurnEndEnd - promptResolvedAt;
const promptBeforeAgentEndStart = agentEndStart - promptResolvedAt;
const promptBeforeAgentEndEnd = agentEndEnd - promptResolvedAt;
const toolCallToExecute = allowedToolExecuteStart - allowedToolCallStart;
const toolHookEndToExecute = allowedToolExecuteStart - allowedToolCallEnd;

const q1Verdict =
	`**Q1 — CONFIRMED-BLOCKING.** The 300 ms \`context\` hook delayed provider entry by ` +
	`${formatMs(contextToProvider1)} ms on request 1 and ${formatMs(contextToProvider2)} ms on request 2. ` +
	`Once each handler ended, the provider began only ${formatMs(contextEndToProvider1)} ms and ` +
	`${formatMs(contextEndToProvider2)} ms later, respectively.`;

const q2Verdict =
	`**Q2 — CONFIRMED-NONBLOCKING.** The second provider request entered ` +
	`${formatMs(Math.abs(providerAfterSlowStart))} ms ${providerAfterSlowStart >= 0 ? "after" : "before"} ` +
	`the slow \`turn_end[0]\` handler started, while that handler still had ` +
	`${formatMs(providerBeforeSlowEnd)} ms left. Its measured handler duration was ` +
	`${formatMs(duration("turn_end[0]"))} ms, so the loop did not wait for it to finish.`;

const q3Verdict =
	`**Q3 — RACE-EXISTS.** The measured ordering was ${raceOrdering}. Both the next turn's ` +
	`\`context\` handler and provider request began before the prior turn's slow \`turn_end\` handler ended.`;

const q4Verdict =
	`**Q4 — FOLD-BACK-UNSAFE / CONFIRMED-NONBLOCKING.** \`await session.prompt(...)\` resolved ` +
	`${formatMs(promptBeforeSlowEnd)} ms before the slow \`turn_end\` handler settled, ` +
	`${formatMs(promptBeforeAgentEndStart)} ms before the queued \`agent_end\` handler even started, and ` +
	`${formatMs(promptBeforeAgentEndEnd)} ms before \`agent_end\` settled. Completion of ` +
	`\`session.prompt\` therefore does not make slow lifecycle-handler fold-back safe.`;

const q5Verdict =
	`**Q5 — CONFIRMED-BLOCKING / VETO-CONFIRMED.** For the allowed call, actual tool execution ` +
	`began ${formatMs(toolCallToExecute)} ms after \`tool_call\` started and ` +
	`${formatMs(toolHookEndToExecute)} ms after it ended, confirming that the hook is on the tool's ` +
	`critical path. The second call returned \`{ block: true, reason: "${VETO_REASON}" }\`; its executor ` +
	`never ran, and Pi synthesized an error tool result containing that reason. As expected for a ` +
	`pre-execution veto, the \`tool_result\` extension hook ran for the allowed call only.`;

const timelineTable = renderTimelineTable();
const resultsMarkdown = `# Pi extension-hook blocking spike

## Setup

- Command: \`bun spikes/pi-hook-blocking/spike.ts\`
- Runtime path: public \`createAgentSession()\` returning a real \`AgentSession\`; the spike does not call \`pi-agent-core\`'s loop directly.
- Packages: \`@earendil-works/pi-coding-agent@${versions["pi-coding-agent"]}\`, \`@earendil-works/pi-agent-core@${versions["pi-agent-core"]}\`, and \`@earendil-works/pi-ai@${versions["pi-ai"]}\`.
- Provider: a deterministic, in-memory provider registered through \`ModelRegistry.registerProvider()\`. Its \`streamSimple\` returns Pi's \`AssistantMessageEventStream\`; no network calls occur.
- Script: provider request 1 returns two sequential calls to one trivial extension tool (one allowed and one vetoed), then provider request 2 returns a plain assistant message and stops.
- Hooks: \`context\`, \`turn_start\`, \`turn_end\`, \`agent_end\`, \`tool_call\`, and \`tool_result\` are registered by one inline \`ExtensionFactory\`. Each invoked handler sleeps about ${HOOK_DELAY_MS} ms, except \`turn_end[0]\`, which sleeps about ${SLOW_TURN_END_DELAY_MS} ms.
- State: auth, settings, and session persistence are all in memory. Compaction and retries are disabled.
- Time base: every table entry uses monotonic \`performance.now()\`, relative to \`prompt.start\`.
- Drain note: prompt resolution is timestamped first; only then does the spike await AgentSession's internal extension-event queue so the report can include decoupled handler completions.

## Chronological timeline

${timelineTable}

## Verdicts

${q1Verdict}

${q2Verdict}

${q3Verdict}

${q4Verdict}

${q5Verdict}
`;

writeFileSync(resultsPath, resultsMarkdown, "utf8");

console.log("Pi extension-hook blocking spike");
console.log(
	`Packages: coding-agent=${versions["pi-coding-agent"]}, agent-core=${versions["pi-agent-core"]}, pi-ai=${versions["pi-ai"]}`,
);
console.log("\nChronological timeline\n");
console.log(timelineTable);
console.log("\nMeasured verdicts\n");
console.log(q1Verdict.replaceAll("**", ""));
console.log(q2Verdict.replaceAll("**", ""));
console.log(q3Verdict.replaceAll("**", ""));
console.log(q4Verdict.replaceAll("**", ""));
console.log(q5Verdict.replaceAll("**", ""));
console.log(`\nWrote ${resultsPath}`);

session.dispose();
modelRegistry.unregisterProvider(MOCK_PROVIDER);
