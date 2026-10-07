#!/usr/bin/env bun
/**
 * Model-nodes demo fixture generator (plan M6-B).
 *
 * Writes one deterministic trace for the GameCube worker job
 * `worker-job/fn_8003A1C4` (README.md has the story and the id table): a
 * worker session with two runs (R1 `system`, R5 `steer`), a codemode tool with
 * nested read/bash calls (three levels deep, one nested end promoted from
 * approximate to live), extraction calls, a `checkpoint-accepted` gate with
 * step and decision checks, a choice decision, an abstained decision, a failed
 * call, and three retry sessions: a failed → done decision inside the gate, a
 * stale → recovered call, and a failed → done call whose attempts have
 * different parent runs.
 *
 * Every row goes through the committed protocol factories and db actions:
 * worker rows through the async actions the spawn pipeline uses, node rows
 * through the acknowledged node-session transactions (`claimAndStartNode`,
 * `persistNodeCompletion`; the stale attempt is recovered by the real claim),
 * steps and gates through `insertTraceEventsBatch`, and the promoted nested
 * end through `upsertPromotableTraceEvent`. Ids come from fixed seeds and the
 * real derivations (`kernelNodeEventId`, `kernelRequestId`,
 * `nestedToolEventId`, `piEntryEventId`, `deriveContainerId`); every
 * timestamp is an offset from a fixed t0. The fixture JSON is read back
 * through the kernel's container read service, so it is exactly what the
 * viewer API serves for this DB, and the trace doctor must report ok before
 * anything is written.
 *
 * Usage (from the agent-kernel repo root):
 *   bun examples/simple-research-kernel/scripts/model-nodes-demo/generate-fixture.ts
 *     [--json <path>]               fixture JSON (default: viewer-core __fixtures__/model-nodes-demo.json)
 *     [--routes <path>]             DS route ids (default: routes.json beside this script)
 *     [--db <path>]                 also keep the trace DB (with blobs) at <path>; an existing file is replaced
 *     [--journal-mode delete|wal]   journal mode of the kept DB (default delete: no -wal/-shm files)
 *     [--check]                     write nothing (builds in a temp DB; --db is never touched);
 *                                   exit 1 when the committed JSON or routes differ
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sql } from "drizzle-orm";

import {
	claimAndStartNode,
	createAgentRun,
	ensureKernelObservabilitySchema,
	hashTraceBlobBytes,
	incrementContainerUsage,
	incrementSessionUsage,
	insertTraceEventsBatch,
	openKernelDatabase,
	persistNodeCompletion,
	updateAgentRunStatus,
	updateContainerStatus,
	updatePiAgentSessionStatus,
	updateRunUsage,
	upsertContainer,
	upsertPiAgentSession,
	upsertPromotableTraceEvent,
	upsertTraceBlobs,
	type KernelDatabase,
	type RunTrigger,
	type TraceBlobInput,
	type UsageDelta,
} from "@agent-kernel/db";
import {
	createContainerReadService,
	deriveContainerId,
	formatDoctorReport,
	runTraceDoctor,
} from "@agent-kernel/kernel";
import {
	createAgentRunEndEvent,
	createAgentRunStartEvent,
	createAgentSessionStartEvent,
	createAssistantMessageEvent,
	createCallEndEvent,
	createCallStartEvent,
	createDecisionMadeEvent,
	createGateEndEvent,
	createGateStartEvent,
	createPiAgentEndEvent,
	createPiAgentStartEvent,
	createPiRequestSnapshotEvent,
	createPiTurnEndEvent,
	createPiTurnStartEvent,
	createStepEndEvent,
	createStepStartEvent,
	createSystemPromptResolvedEvent,
	createToolCallEndEvent,
	createToolCallStartEvent,
	createUserMessageEvent,
	deterministicEventId,
	immediateParentId,
	kernelNodeEventId,
	kernelRequestId,
	nestedToolEventId,
	piEntryEventId,
	type CallEndData,
	type CallStartData,
	type Decision,
	type DecisionMadeData,
	type GateCheckRecord,
	type PiRequestSnapshotMessageRef,
	type RunTraceEventIds,
	type StepEndData,
	type ThresholdApplied,
	type TraceEvent,
	type TraceEventIds,
	type TurnUsage,
} from "@agent-kernel/protocol";

// ─── Fixed identity and clock ────────────────────────────────────────────────

export const KERNEL_ID = "model-nodes-demo";
const T0_MS = Date.parse("2026-10-07T09:00:00.000Z");
/** ISO timestamp `ms` milliseconds after t0. */
const at = (ms: number): string => new Date(T0_MS + ms).toISOString();

const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/** A fixed, UUID-shaped id for a row the real kernel would mint randomly. */
const fixedId = (name: string): string => deterministicEventId(`${KERNEL_ID}\nfixture\n${name}`);

const CONTAINER_ID = deriveContainerId(KERNEL_ID, "session", ["worker-job", "fn_8003A1C4"]);
const WORKER_SESSION_ID = fixedId("session:worker");

const WORKER_MODEL = "codex-lb/gpt-5.6-sol";
const WORKER_SERVED_MODEL = "gpt-5.6-sol";
const CALL_PROVIDER = "codex-lb";
const CALL_API = "openai-responses";
const CALL_URL = "http://127.0.0.1:2455/backend-api/codex/responses";
const JEV_MODEL = "typesafe/jev-1.13.0";
const JEV_PROVIDER = "typesafe";
const JEV_API = "typesafe-system-one";
/** Jev input price per token ($0.042 per million, output free). */
const JEV_INPUT_PRICE = 0.042 / 1e6;

const CALL_DEADLINE_MS = 120_000;
/** decide: timeoutMs × (maxRetries + 1) + maxRetries × maxRetryDelayMs (plan §4.6). */
const DECIDE_DEADLINE_MS = 5_000 * 2 + 2_000;
const NODE_STALE_AFTER_MS = 600_000;

/** Caller requestIds, the idempotency keys the GameCube harness would pass (plan §6.5, §6.8). */
const REQUEST = {
	R2: "checkpoint:ckpt-1:extract",
	S1: "checkpoint:ckpt-1:validate",
	GATE: "checkpoint:ckpt-1:gate",
	CHECK_OBJDIFF: "checkpoint:ckpt-1:gate:objdiff",
	CHECK_JUSTIFICATION_A1: "checkpoint:ckpt-1:gate:justification:A1",
	R3: "checkpoint:ckpt-1:gate:JudgeAdvisory:A1",
	CHECK_JUSTIFICATION_A2: "checkpoint:ckpt-1:gate:justification:A2",
	RETRY_DECISION: "checkpoint:ckpt-1:gate:JudgeAdvisory:A2",
	CHECK_JUSTIFICATION_A3: "checkpoint:ckpt-1:gate:justification:A3",
	ABSTAIN: "checkpoint:ckpt-1:gate:JudgeAdvisory:A3",
	FAILED_CALL: "checkpoint:ckpt-1:judge:A3",
	R4: "worker-job:fn_8003A1C4:attempt-1:continue",
	SUMMARY: "worker-job:fn_8003A1C4:summary",
	R6: "checkpoint:ckpt-2:extract",
	S2: "checkpoint:ckpt-2:validate",
	S3: "worker-job:fn_8003A1C4:stop",
	CONFIRMED: "checkpoint_confirmed:ckpt-2",
} as const;

const sessionFor = (requestId: string): string => kernelRequestId(KERNEL_ID, "session", requestId);
const spanFor = (requestId: string): string => kernelRequestId(KERNEL_ID, "span", requestId);
const spanEventId = (spanId: string, type: string): string => kernelNodeEventId(`span:${spanId}`, 0, type);

const TOOL_USE = {
	CODEMODE: "call_r1_codemode",
	NESTED_READ: "call_r1_codemode/1",
	NESTED_BASH: "call_r1_codemode/2",
	NESTED_DIFF: "call_r1_codemode/3",
	NESTED_DIFF_BASH: "call_r1_codemode/3/1",
	R1_EDIT: "call_r1_edit",
	R5_EDIT: "call_r5_edit",
	R5_BASH: "call_r5_bash",
} as const;

const GATE_SPAN_ID = spanFor(REQUEST.GATE);

/**
 * Every session, run and span the fixture writes, keyed by the names the plan
 * and README use. Node sessions with a requestId get the kernel's
 * deterministic session id; runs get fixed ids.
 */
export const FIXTURE_IDS = {
	kernelId: KERNEL_ID,
	containerId: CONTAINER_ID,
	workerSessionId: WORKER_SESSION_ID,
	runs: {
		R1: fixedId("run:R1"),
		R5: fixedId("run:R5"),
		R2: fixedId("run:R2"),
		R3: fixedId("run:R3"),
		RETRY_ATTEMPT_1: fixedId("run:RETRY_ATTEMPT_1"),
		RETRY_ATTEMPT_2: fixedId("run:RETRY_ATTEMPT_2"),
		ABSTAIN: fixedId("run:ABSTAIN"),
		FAILED_CALL: fixedId("run:FAILED_CALL"),
		R4: fixedId("run:R4"),
		SUMMARY_ATTEMPT_1: fixedId("run:SUMMARY_ATTEMPT_1"),
		R6: fixedId("run:R6"),
		SUMMARY_ATTEMPT_2: fixedId("run:SUMMARY_ATTEMPT_2"),
		CONFIRMED_ATTEMPT_1: fixedId("run:CONFIRMED_ATTEMPT_1"),
		CONFIRMED_ATTEMPT_2: fixedId("run:CONFIRMED_ATTEMPT_2"),
	},
	sessions: {
		R2: sessionFor(REQUEST.R2),
		R3: sessionFor(REQUEST.R3),
		RETRY_DECISION: sessionFor(REQUEST.RETRY_DECISION),
		ABSTAIN: sessionFor(REQUEST.ABSTAIN),
		FAILED_CALL: sessionFor(REQUEST.FAILED_CALL),
		R4: sessionFor(REQUEST.R4),
		SUMMARY: sessionFor(REQUEST.SUMMARY),
		R6: sessionFor(REQUEST.R6),
		CONFIRMED: sessionFor(REQUEST.CONFIRMED),
	},
	/** Protocol span ids of steps and gates (the envelope spanId). */
	spans: {
		S1: spanFor(REQUEST.S1),
		GATE: GATE_SPAN_ID,
		CHECK_OBJDIFF: spanFor(REQUEST.CHECK_OBJDIFF),
		CHECK_JUSTIFICATION_A1: spanFor(REQUEST.CHECK_JUSTIFICATION_A1),
		CHECK_JUSTIFICATION_A2: spanFor(REQUEST.CHECK_JUSTIFICATION_A2),
		CHECK_JUSTIFICATION_A3: spanFor(REQUEST.CHECK_JUSTIFICATION_A3),
		S2: spanFor(REQUEST.S2),
		S3: spanFor(REQUEST.S3),
	},
	toolUseIds: TOOL_USE,
	/** Start-event ids: an event span's tree id is its start event's id. */
	events: {
		GATE_START: spanEventId(GATE_SPAN_ID, "gate_start"),
		CODEMODE_START: piEntryEventId(WORKER_SESSION_ID, "r1-t0-assistant", 0, "tool_call_start"),
		NESTED_READ_START: nestedToolEventId(WORKER_SESSION_ID, TOOL_USE.NESTED_READ, "tool_call_start"),
		NESTED_BASH_START: nestedToolEventId(WORKER_SESSION_ID, TOOL_USE.NESTED_BASH, "tool_call_start"),
		NESTED_DIFF_START: nestedToolEventId(WORKER_SESSION_ID, TOOL_USE.NESTED_DIFF, "tool_call_start"),
		NESTED_DIFF_BASH_START: nestedToolEventId(WORKER_SESSION_ID, TOOL_USE.NESTED_DIFF_BASH, "tool_call_start"),
	},
} as const;

const RUNS = FIXTURE_IDS.runs;
const SESSIONS = FIXTURE_IDS.sessions;
const SPANS = FIXTURE_IDS.spans;

/**
 * The `<…>` placeholders of the DS `viewer-ui` route table (plan M6-E), as raw
 * ids. Node rows render as `pi:<sessionId>`, attempt rows as
 * `attempt:<runId>`, and event spans under their start event's id.
 */
export const ROUTE_PLACEHOLDERS = {
	R2: SESSIONS.R2,
	R3: SESSIONS.R3,
	R4: SESSIONS.R4,
	ABSTAIN: SESSIONS.ABSTAIN,
	FAILED_CALL: SESSIONS.FAILED_CALL,
	GATE_SPAN: FIXTURE_IDS.events.GATE_START,
	CODEMODE_SPAN: FIXTURE_IDS.events.CODEMODE_START,
	NESTED_READ_SPAN: FIXTURE_IDS.events.NESTED_READ_START,
	RETRY_DECISION: SESSIONS.RETRY_DECISION,
	RETRY_ATTEMPT_2: RUNS.RETRY_ATTEMPT_2,
} as const;

/** The full `data-span-id` each placeholder resolves to in the rendered tree. */
export const ROUTE_TARGETS: Record<keyof typeof ROUTE_PLACEHOLDERS, string> = {
	R2: `pi:${ROUTE_PLACEHOLDERS.R2}`,
	R3: `pi:${ROUTE_PLACEHOLDERS.R3}`,
	R4: `pi:${ROUTE_PLACEHOLDERS.R4}`,
	ABSTAIN: `pi:${ROUTE_PLACEHOLDERS.ABSTAIN}`,
	FAILED_CALL: `pi:${ROUTE_PLACEHOLDERS.FAILED_CALL}`,
	GATE_SPAN: ROUTE_PLACEHOLDERS.GATE_SPAN,
	CODEMODE_SPAN: ROUTE_PLACEHOLDERS.CODEMODE_SPAN,
	NESTED_READ_SPAN: ROUTE_PLACEHOLDERS.NESTED_READ_SPAN,
	RETRY_DECISION: `pi:${ROUTE_PLACEHOLDERS.RETRY_DECISION}`,
	RETRY_ATTEMPT_2: `attempt:${ROUTE_PLACEHOLDERS.RETRY_ATTEMPT_2}`,
};

const treeItem = (target: keyof typeof ROUTE_TARGETS): string =>
	`[role=treeitem][data-span-id="${ROUTE_TARGETS[target]}"]`;
const detailBlock = (id: string): string => `[data-detail-block="${id}"]`;

/** The DS `viewer-ui` routes (plan M6-E table) with every placeholder substituted. */
export const DS_ROUTES = [
	{ id: "mn-overview", click: null, waitFor: treeItem("R2") },
	{ id: "mn-decision", click: treeItem("R3"), waitFor: detailBlock("decision-bars") },
	{ id: "mn-choice", click: treeItem("R4"), waitFor: detailBlock("decision-bars") },
	{ id: "mn-abstain", click: treeItem("ABSTAIN"), waitFor: detailBlock("decision-abstain") },
	{ id: "mn-call", click: treeItem("R2"), waitFor: detailBlock("call-output") },
	{ id: "mn-call-error", click: treeItem("FAILED_CALL"), waitFor: detailBlock("call-error") },
	{ id: "mn-gate", click: treeItem("GATE_SPAN"), waitFor: detailBlock("gate-checks") },
	{ id: "mn-nested", click: treeItem("CODEMODE_SPAN"), waitFor: treeItem("NESTED_READ_SPAN") },
	{ id: "mn-retry", click: treeItem("RETRY_DECISION"), waitFor: treeItem("RETRY_ATTEMPT_2") },
].map((route) => ({ ...route, path: `/traces?traceId=${CONTAINER_ID}` }));

// ─── Blobs ───────────────────────────────────────────────────────────────────

/** JSON with object keys sorted at every level (the kernel's canonical form). */
function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
	return out;
}

function bytesBlob(kind: string, mimeType: string, text: string): TraceBlobInput {
	const bytes = new TextEncoder().encode(text);
	return {
		hash: hashTraceBlobBytes(bytes),
		kind,
		mimeType,
		byteLength: bytes.byteLength,
		data: Buffer.from(bytes),
		createdAt: at(0),
	};
}

const jsonBlob = (kind: string, value: unknown): TraceBlobInput =>
	bytesBlob(kind, "application/json", canonicalJson(value));
const textBlob = (kind: string, text: string): TraceBlobInput => bytesBlob(kind, "text/plain", text);

/** Overrides the envelope fields a factory does not take (the emitter re-stamps them the same way). */
function stamp(event: TraceEvent, eventId: string, ms: number, source?: string): TraceEvent {
	return { ...event, eventId, timestamp: at(ms), ...(source !== undefined && { source }) };
}

function usageDelta(usage: TurnUsage): UsageDelta {
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: usage.cacheReadTokens,
		cacheWriteTokens: usage.cacheWriteTokens,
		...(usage.costEstimate !== undefined && { costEstimate: usage.costEstimate }),
	};
}

function sumUsage(usages: TurnUsage[]): TurnUsage | undefined {
	if (usages.length === 0) return undefined;
	const total: TurnUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		model: usages[usages.length - 1]!.model,
	};
	let cost: number | undefined;
	for (const usage of usages) {
		total.inputTokens += usage.inputTokens;
		total.outputTokens += usage.outputTokens;
		total.cacheReadTokens += usage.cacheReadTokens;
		total.cacheWriteTokens += usage.cacheWriteTokens;
		if (usage.costEstimate !== undefined) cost = (cost ?? 0) + usage.costEstimate;
	}
	return cost === undefined ? total : { ...total, costEstimate: cost };
}

// ─── Worker session (kind "pi") ──────────────────────────────────────────────

/** Sanitized pi-ai message JSON, as the request snapshot stores it. */
type PiMessageJson = Record<string, unknown> & { role: string; content: Array<Record<string, unknown>> };

interface NestedCallSpec {
	id: string;
	name: string;
	args: Record<string, unknown>;
	output: string;
	startMs: number;
	endMs: number;
	/**
	 * Backfill (from the parent toolResult's nestedCalls) stored an approximate
	 * end at this time before the live end arrived; the live end promotes it.
	 */
	approximateEndMs?: number;
}

interface ToolCallSpec {
	id: string;
	name: string;
	args: Record<string, unknown>;
	output: string;
	startMs: number;
	endMs: number;
	nested?: NestedCallSpec[];
}

interface TurnSpec {
	startMs: number;
	endMs: number;
	tools: ToolCallSpec[];
	reply?: { ms: number; text: string };
	stopReason: "toolUse" | "stop";
	usage: { input: number; output: number; cacheRead: number; cost: number };
}

interface WorkerRunSpec {
	key: string;
	runId: string;
	trigger: RunTrigger;
	startMs: number;
	endMs: number;
	prompt: string;
	turns: TurnSpec[];
}

const WORKER_SYSTEM_PROMPT = [
	"<role>You are a GameCube decompilation worker. You turn one target function into C++ that",
	"mwcc compiles to the original instructions.</role>",
	"<rules>Use codemode to batch reads, builds and objdiff checks. Record every review-lint advisory",
	"you keep in the checkpoint note, with the reason the original assembly needs it.</rules>",
].join("\n");
const WORKER_PROMPT_HASH = `pk1-${sha256Hex(WORKER_SYSTEM_PROMPT)}`;

const WORKER_TOOLS = [
	{
		name: "codemode",
		description: "Run a TypeScript script that calls the other tools through `tools.*`.",
		parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
	},
	{
		name: "read",
		description: "Read a file from the decomp checkout.",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	},
	{
		name: "bash",
		description: "Run a shell command in the decomp checkout.",
		parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
	},
	{
		name: "edit",
		description: "Replace one exact span of a file.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" } },
			required: ["path", "old", "new"],
		},
	},
	{
		name: "diff_function",
		description: "Build the unit and print the objdiff of one function.",
		parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
	},
];

class WorkerSession {
	private readonly context: PiMessageJson[] = [];
	private readonly systemPromptBlob = textBlob("text", WORKER_SYSTEM_PROMPT);
	private readonly toolsBlob = jsonBlob("tools", WORKER_TOOLS);
	private sessionStarted = false;

	constructor(private readonly db: KernelDatabase) {}

	private entryId(spec: WorkerRunSpec, suffix: string): string {
		return `${spec.key}-${suffix}`;
	}

	private entryEvent(event: TraceEvent, entryId: string, ordinal: number, ms: number): TraceEvent {
		return stamp(event, piEntryEventId(WORKER_SESSION_ID, entryId, ordinal, String(event.type)), ms, "agent");
	}

	async writeRun(spec: WorkerRunSpec): Promise<void> {
		const ids: RunTraceEventIds = { containerId: CONTAINER_ID, runId: spec.runId, piSessionUuid: WORKER_SESSION_ID };
		const events: TraceEvent[] = [];
		const blobs: TraceBlobInput[] = [this.systemPromptBlob, this.toolsBlob];

		if (!this.sessionStarted) {
			this.sessionStarted = true;
			await upsertPiAgentSession(this.db, {
				id: WORKER_SESSION_ID,
				containerId: CONTAINER_ID,
				agentName: "worker",
				model: WORKER_MODEL,
				promptHash: WORKER_PROMPT_HASH,
				status: "active",
				kind: "pi",
				createdAt: at(spec.startMs),
			});
			events.push(
				this.entryEvent(createAgentSessionStartEvent(ids, "worker", WORKER_MODEL), WORKER_SESSION_ID, 0, spec.startMs),
			);
		}

		const userMessageId = piEntryEventId(WORKER_SESSION_ID, this.entryId(spec, "user"), 0, "user_message");
		await createAgentRun(this.db, {
			id: spec.runId,
			piSessionId: WORKER_SESSION_ID,
			containerId: CONTAINER_ID,
			agentName: "worker",
			trigger: spec.trigger,
			status: "running",
			startedAt: at(spec.startMs),
			inboundEventId: userMessageId,
		});

		events.push(
			stamp(
				createSystemPromptResolvedEvent(
					ids,
					{
						agent_name: "worker",
						prompt_hash: WORKER_PROMPT_HASH,
						rendered_prompt: WORKER_SYSTEM_PROMPT,
						tools_allowlist: WORKER_TOOLS.map((tool) => tool.name),
						tools_disallowlist: [],
						extensions: false,
						domain_rules_installed: false,
						variables_resolved: { target: "fn_8003A1C4", unit: "d_a_player.cpp" },
					},
					{ spanId: fixedId(`spawn:${spec.key}`) },
				),
				fixedId(`${spec.key}:system_prompt_resolved`),
				spec.startMs + 1,
			),
			stamp(
				createAgentRunStartEvent(ids, "worker"),
				fixedId(`${spec.key}:agent_run_start`),
				spec.startMs + 2,
			),
			this.entryEvent(createUserMessageEvent(ids, spec.prompt, "unknown"), this.entryId(spec, "user"), 0, spec.startMs + 4),
			this.entryEvent(createPiAgentStartEvent(ids), this.entryId(spec, "agent_start"), 0, spec.startMs + 5),
		);
		this.context.push({ role: "user", content: [{ type: "text", text: spec.prompt }], timestamp: T0_MS + spec.startMs + 4 });

		const promoted: TraceEvent[] = [];
		const approximate: TraceEvent[] = [];
		const turnUsages: TurnUsage[] = [];
		let outboundEventId: string | undefined;

		for (const [index, turn] of spec.turns.entries()) {
			events.push(
				this.entryEvent(
					createPiTurnStartEvent(ids, { turnNumber: index }),
					this.entryId(spec, `t${index}-turn_start`),
					0,
					turn.startMs,
				),
			);

			const refs: PiRequestSnapshotMessageRef[] = this.context.map((message, refIndex) => {
				const blob = jsonBlob("message", message);
				blobs.push(blob);
				return {
					blob_hash: blob.hash,
					role: message.role,
					index: refIndex,
					text_chars: textChars(message),
					image_count: 0,
					tool_call_count: message.content.filter((block) => block.type === "toolCall").length,
				};
			});
			events.push(
				createPiRequestSnapshotEvent(
					ids,
					{
						turn_number: index,
						system_prompt_blob_hash: this.systemPromptBlob.hash,
						prompt_hash: WORKER_PROMPT_HASH,
						message_count: refs.length,
						message_refs: refs,
						total_text_chars: refs.reduce((sum, ref) => sum + ref.text_chars, 0),
						total_image_count: 0,
						tools_blob_hash: this.toolsBlob.hash,
						tool_count: WORKER_TOOLS.length,
					},
					{
						eventId: piEntryEventId(WORKER_SESSION_ID, this.entryId(spec, `t${index}-request`), 0, "pi_request_snapshot"),
						timestamp: at(turn.startMs + 1),
					},
				),
			);

			const assistantEntry = this.entryId(spec, `t${index}-assistant`);
			const assistant: PiMessageJson = {
				role: "assistant",
				content: [],
				api: CALL_API,
				provider: CALL_PROVIDER,
				model: WORKER_SERVED_MODEL,
				stopReason: turn.stopReason,
				timestamp: T0_MS + turn.endMs,
			};
			const results: PiMessageJson[] = [];

			for (const [ordinal, tool] of turn.tools.entries()) {
				assistant.content.push({ type: "toolCall", id: tool.id, name: tool.name, arguments: tool.args });
				events.push(
					this.entryEvent(
						createToolCallStartEvent(ids, tool.name, tool.id, { toolInput: { raw: tool.args }, spanId: tool.id }),
						assistantEntry,
						ordinal,
						tool.startMs,
					),
				);
				for (const nested of tool.nested ?? []) {
					const nestedEvents = nestedCallEvents(ids, nested);
					events.push(nestedEvents.start);
					if (nested.approximateEndMs === undefined) {
						events.push(nestedEvents.liveEnd);
					} else {
						approximate.push(nestedEvents.approximateStart, nestedEvents.approximateEnd);
						promoted.push(nestedEvents.liveEnd);
					}
				}
				events.push(
					this.entryEvent(
						createToolCallEndEvent(ids, tool.name, tool.id, { toolOutput: tool.output, spanId: tool.id }),
						this.entryId(spec, `t${index}-result-${ordinal}`),
						0,
						tool.endMs,
					),
				);
				results.push({
					role: "toolResult",
					toolCallId: tool.id,
					toolName: tool.name,
					content: [{ type: "text", text: tool.output }],
					isError: false,
					timestamp: T0_MS + tool.endMs,
				});
			}

			if (turn.reply) {
				assistant.content.push({ type: "text", text: turn.reply.text });
				const reply = this.entryEvent(
					createAssistantMessageEvent(ids, turn.reply.text, "text"),
					assistantEntry,
					turn.tools.length,
					turn.reply.ms,
				);
				outboundEventId = reply.eventId;
				events.push(reply);
			}

			const usage: TurnUsage = {
				inputTokens: turn.usage.input,
				outputTokens: turn.usage.output,
				cacheReadTokens: turn.usage.cacheRead,
				cacheWriteTokens: 0,
				model: WORKER_SERVED_MODEL,
				costEstimate: turn.usage.cost,
			};
			turnUsages.push(usage);
			events.push(
				this.entryEvent(
					createPiTurnEndEvent(ids, { turnNumber: index, stopReason: turn.stopReason, usage }),
					this.entryId(spec, `t${index}-turn_end`),
					0,
					turn.endMs,
				),
			);
			this.context.push(assistant, ...results);
		}

		const totals = sumUsage(turnUsages);
		events.push(
			stamp(
				createAgentRunEndEvent(ids, "worker", "ok", totals ? { usage: totals } : undefined),
				fixedId(`${spec.key}:agent_run_end`),
				spec.endMs - 2,
			),
			this.entryEvent(
				createPiAgentEndEvent(ids, "ok", {
					inputTokens: totals?.inputTokens,
					outputTokens: totals?.outputTokens,
				}),
				this.entryId(spec, "agent_end"),
				0,
				spec.endMs - 1,
			),
		);

		await upsertTraceBlobs(this.db, dedupeBlobs(blobs));
		await insertTraceEventsBatch(this.db, events);
		// Backfill ran before the live writer flushed these nested ends: its
		// approximate rows land first (the approximate start is ignored, the live
		// start already exists), then the live end promotes the approximate one.
		await insertTraceEventsBatch(this.db, approximate);
		for (const event of promoted) {
			const outcome = await upsertPromotableTraceEvent(this.db, event);
			if (outcome !== "promoted") throw new Error(`nested end ${event.eventId}: expected promoted, got ${outcome}`);
		}

		for (const usage of turnUsages) await updateRunUsage(this.db, spec.runId, usageDelta(usage));
		await updateAgentRunStatus(this.db, spec.runId, "done", {
			endedAt: at(spec.endMs),
			...(outboundEventId !== undefined && { outboundEventId }),
		});
		if (totals) {
			await incrementSessionUsage(this.db, WORKER_SESSION_ID, totals);
			await incrementContainerUsage(this.db, CONTAINER_ID, usageDelta(totals));
		}
	}

	async end(ms: number): Promise<void> {
		await updatePiAgentSessionStatus(this.db, WORKER_SESSION_ID, "ended", at(ms));
	}
}

function textChars(message: PiMessageJson): number {
	return message.content.reduce((sum, block) => sum + (typeof block.text === "string" ? block.text.length : 0), 0);
}

function dedupeBlobs(blobs: TraceBlobInput[]): TraceBlobInput[] {
	return [...new Map(blobs.map((blob) => [blob.hash, blob])).values()];
}

/**
 * Live and approximate events for one nested call (plan §4.4): span id = the
 * full nested id, parent = that id minus its final `/<n>`, event ids from
 * nestedToolEventId so live and backfill rows share them.
 */
function nestedCallEvents(
	ids: TraceEventIds,
	nested: NestedCallSpec,
): { start: TraceEvent; liveEnd: TraceEvent; approximateStart: TraceEvent; approximateEnd: TraceEvent } {
	const parentToolUseId = immediateParentId(nested.id);
	if (parentToolUseId === undefined) throw new Error(`${nested.id} is not a nested call id`);
	const startId = nestedToolEventId(WORKER_SESSION_ID, nested.id, "tool_call_start");
	const endId = nestedToolEventId(WORKER_SESSION_ID, nested.id, "tool_call_end");
	const base = { spanId: nested.id, parentToolUseId, nested: true } as const;
	const durationMs = nested.endMs - nested.startMs;
	const approximateEndMs = nested.approximateEndMs ?? nested.endMs;
	const agent = (event: TraceEvent): TraceEvent => ({ ...event, source: "agent" });
	return {
		start: agent(createToolCallStartEvent(ids, nested.name, nested.id, {
			...base,
			toolInput: { raw: nested.args },
			timing: "live",
			eventId: startId,
			timestamp: at(nested.startMs),
		})),
		liveEnd: agent(createToolCallEndEvent(ids, nested.name, nested.id, {
			...base,
			toolOutput: nested.output,
			durationMs,
			nestedStatus: "ok",
			timing: "live",
			eventId: endId,
			timestamp: at(nested.endMs),
		})),
		approximateStart: agent(createToolCallStartEvent(ids, nested.name, nested.id, {
			...base,
			toolInput: { raw: nested.args },
			timing: "approximate",
			eventId: startId,
			timestamp: at(approximateEndMs - durationMs),
		})),
		approximateEnd: agent(createToolCallEndEvent(ids, nested.name, nested.id, {
			...base,
			toolOutput: nested.output,
			durationMs,
			nestedStatus: "ok",
			timing: "approximate",
			eventId: endId,
			timestamp: at(approximateEndMs),
		})),
	};
}

// ─── Model nodes (kind "call" / "decision") ──────────────────────────────────

interface NodeScope {
	kind: "call" | "decision";
	/** BAML function or decision name: session agent_name and call_start function_name. */
	name: string;
	displayLabel: string;
	requestId: string;
	runId: string;
	parentRunId: string;
	trigger: RunTrigger;
	gateSpanId?: string;
	startMs: number;
	deadlineMs: number;
	/** Claim clock; later than startMs only for the claim that recovers a stale attempt. */
	claimNowMs?: number;
	/** 1-based attempt the claim must return. */
	attempt: number;
	/** Runs the claim must abandon (stale recovery). */
	abandons?: string[];
}

interface ClaimedNode {
	scope: NodeScope;
	sessionId: string;
	traceIds: RunTraceEventIds;
	startEventId: string;
}

type NodeStartFields = Pick<
	CallStartData,
	"engine" | "transport" | "model" | "provider" | "api" | "prompt_hash" | "input_blob_hash"
>;

async function claimNode(
	db: KernelDatabase,
	scope: NodeScope,
	start: NodeStartFields,
	startBlobs: TraceBlobInput[],
): Promise<ClaimedNode> {
	const sessionId = sessionFor(scope.requestId);
	const traceIds: RunTraceEventIds = { containerId: CONTAINER_ID, runId: scope.runId, piSessionUuid: sessionId };
	const startEventId = kernelNodeEventId(scope.runId, 0, "call_start");
	const deadlineAt = at(scope.startMs + scope.deadlineMs);
	// kernel.gate's decide checks pass no displayLabel: the row is titled by the decision name.
	const displayLabel = scope.gateSpanId === undefined ? scope.displayLabel : undefined;
	const startData: CallStartData = {
		run_id: scope.runId,
		node_kind: scope.kind,
		function_name: scope.name,
		...start,
		...(scope.gateSpanId !== undefined && { gate_span_id: scope.gateSpanId }),
		trigger: scope.trigger,
		parent_run_id: scope.parentRunId,
		request_id: scope.requestId,
		deadline_at: deadlineAt,
		...(displayLabel !== undefined && { display_label: displayLabel }),
	};
	const claim = await claimAndStartNode(db, {
		kind: scope.kind,
		sessionId,
		runId: scope.runId,
		requestId: scope.requestId,
		containerId: CONTAINER_ID,
		agentName: scope.name,
		displayLabel: displayLabel ?? null,
		model: start.model,
		promptHash: start.prompt_hash,
		parentRunId: scope.parentRunId,
		parentToolUseId: null,
		trigger: scope.trigger,
		startedAt: at(scope.startMs),
		startEvent: createCallStartEvent(traceIds, startData, { eventId: startEventId, timestamp: at(scope.startMs) }),
		startBlobs,
		staleAfterMs: NODE_STALE_AFTER_MS,
		nowMs: T0_MS + (scope.claimNowMs ?? scope.startMs),
		deadlineAt,
	});
	const abandoned = claim.kind === "claimed" ? claim.abandonedRunIds : [];
	if (
		claim.kind !== "claimed" ||
		claim.attempt !== scope.attempt ||
		abandoned.join(",") !== (scope.abandons ?? []).join(",")
	) {
		throw new Error(`${scope.displayLabel}: unexpected claim ${JSON.stringify(claim)}`);
	}
	return { scope, sessionId, traceIds, startEventId };
}

async function completeNode(
	db: KernelDatabase,
	node: ClaimedNode,
	args: {
		endMs: number;
		runStatus: "done" | "error" | "aborted";
		end: Omit<CallEndData, "run_id" | "node_kind" | "function_name" | "duration_ms" | "gate_span_id">;
		events: TraceEvent[];
		blobs: TraceBlobInput[];
	},
): Promise<void> {
	const { scope } = node;
	const callEnd = createCallEndEvent(
		node.traceIds,
		{
			run_id: scope.runId,
			node_kind: scope.kind,
			function_name: scope.name,
			...args.end,
			duration_ms: args.endMs - scope.startMs,
			...(scope.gateSpanId !== undefined && { gate_span_id: scope.gateSpanId }),
		},
		{ eventId: kernelNodeEventId(scope.runId, 0, "call_end"), parentEventId: node.startEventId, timestamp: at(args.endMs) },
	);
	await persistNodeCompletion(db, {
		runId: scope.runId,
		sessionId: node.sessionId,
		containerId: CONTAINER_ID,
		runStatus: args.runStatus,
		sessionStatus: args.runStatus === "done" ? "ended" : "error",
		endedAt: at(args.endMs),
		events: [...args.events, callEnd],
		blobs: dedupeBlobs(args.blobs),
		usage: args.end.usage ? usageDelta(args.end.usage) : null,
	});
}

/**
 * One engine attempt: a request snapshot, a turn start and a turn end
 * (ordinal = attempt index), shaped like call/attempts-to-events.ts and the
 * decide lifecycle write them.
 */
interface EngineAttemptSpec {
	/** Snapshot time; a call's turn starts here, a decision's turn 1 ms later. */
	startMs: number;
	endMs: number;
	/** Recorded on pi_turn_end (a decision records it only for a failed request). */
	httpStatus?: number;
	stopReason: "stop" | "error";
	usage?: TurnUsage;
	/** Redacted response or SSE frames (call-response blob); calls only. */
	response?: unknown;
}

function attemptEvents(
	node: ClaimedNode,
	index: number,
	attempt: EngineAttemptSpec,
	snapshot: {
		systemPromptBlob: TraceBlobInput | null;
		promptHash: string;
		messages: Array<{ role: string; blob: TraceBlobInput; textChars: number }>;
		requestBlob: TraceBlobInput;
		requestKind: "baml-http" | "classifier";
	},
	responseBlob: TraceBlobInput | undefined,
): TraceEvent[] {
	const parentEventId = node.startEventId;
	const turnStartMs = snapshot.requestKind === "classifier" ? attempt.startMs + 1 : attempt.startMs;
	const eventId = (type: string) => kernelNodeEventId(node.scope.runId, index, type);
	const refs: PiRequestSnapshotMessageRef[] = snapshot.messages.map((message, refIndex) => ({
		blob_hash: message.blob.hash,
		role: message.role,
		index: refIndex,
		text_chars: message.textChars,
		image_count: 0,
		tool_call_count: 0,
	}));
	return [
		createPiRequestSnapshotEvent(
			node.traceIds,
			{
				turn_number: index,
				system_prompt_blob_hash: snapshot.systemPromptBlob?.hash ?? null,
				prompt_hash: snapshot.promptHash,
				message_count: refs.length,
				message_refs: refs,
				total_text_chars: refs.reduce((sum, ref) => sum + ref.text_chars, 0),
				total_image_count: 0,
				raw_request_blob_hash: snapshot.requestBlob.hash,
				request_kind: snapshot.requestKind,
			},
			{ parentEventId, eventId: eventId("pi_request_snapshot"), timestamp: at(attempt.startMs) },
		),
		createPiTurnStartEvent(node.traceIds, {
			turnNumber: index,
			parentEventId,
			eventId: eventId("pi_turn_start"),
			timestamp: at(turnStartMs),
		}),
		createPiTurnEndEvent(node.traceIds, {
			turnNumber: index,
			stopReason: attempt.stopReason,
			...(attempt.usage && { usage: attempt.usage }),
			...(responseBlob && { responseBlobHash: responseBlob.hash }),
			...(attempt.httpStatus !== undefined && { httpStatus: attempt.httpStatus }),
			durationMs: attempt.endMs - turnStartMs,
			parentEventId,
			eventId: eventId("pi_turn_end"),
			timestamp: at(attempt.endMs),
		}),
	];
}

// ── kernel.call ──

interface CallNodeSpec extends Omit<NodeScope, "kind" | "deadlineMs"> {
	args: unknown[];
	/** The BAML-rendered prompt: system text and the user message. */
	system: string;
	user: string;
	attempts: EngineAttemptSpec[];
	endMs: number;
	result:
		| { status: "ok"; output: unknown }
		| { status: "error"; error: { kind: string; message: string; http_status?: number }; rawOutput?: string };
}

/** BAML prompt hash stand-in: "baml1-" + sha256 over the function's (fixture) source. */
const bamlPromptHash = (name: string): string =>
	`baml1-${sha256Hex(`function ${name}(…) -> ${name}Result { client KernelCall prompt #"…"# }`)}`;

function callUsage(input: number, output: number, cost: number): TurnUsage {
	return {
		inputTokens: input,
		outputTokens: output,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		model: WORKER_MODEL,
		costEstimate: cost,
	};
}

function bamlRequest(system: string, user: string): unknown {
	return {
		method: "POST",
		url: CALL_URL,
		headers: { authorization: "<redacted>", "content-type": "application/json" },
		body: {
			model: WORKER_SERVED_MODEL,
			input: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			store: false,
			stream: true,
			reasoning: { effort: "low" },
		},
	};
}

function sseResponse(text: string, usage: TurnUsage): unknown {
	return {
		sse: [
			{ type: "response.output_text.done", text },
			{
				type: "response.completed",
				response: {
					model: WORKER_SERVED_MODEL,
					usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
				},
			},
		],
	};
}

async function writeCall(db: KernelDatabase, spec: CallNodeSpec): Promise<void> {
	const inputBlob = jsonBlob("call-input", spec.args);
	const promptHash = bamlPromptHash(spec.name);
	const node = await claimNode(
		db,
		{ ...spec, kind: "call", deadlineMs: CALL_DEADLINE_MS },
		{
			engine: "baml",
			transport: "baml-http",
			model: WORKER_MODEL,
			provider: CALL_PROVIDER,
			api: CALL_API,
			prompt_hash: promptHash,
			input_blob_hash: inputBlob.hash,
		},
		[inputBlob],
	);

	const systemPromptBlob = textBlob("text", spec.system);
	const userMessage = { role: "user", content: [{ type: "text", text: spec.user }] };
	const userBlob = jsonBlob("message", userMessage);
	const requestBlob = jsonBlob("call-request", bamlRequest(spec.system, spec.user));
	const blobs: TraceBlobInput[] = [systemPromptBlob, userBlob, requestBlob];
	const events: TraceEvent[] = [];
	for (const [index, attempt] of spec.attempts.entries()) {
		const responseBlob = attempt.response === undefined ? undefined : jsonBlob("call-response", attempt.response);
		if (responseBlob) blobs.push(responseBlob);
		events.push(
			...attemptEvents(
				node,
				index,
				attempt,
				{
					systemPromptBlob,
					promptHash,
					messages: [{ role: "user", blob: userBlob, textChars: spec.user.length }],
					requestBlob,
					requestKind: "baml-http",
				},
				responseBlob,
			),
		);
	}

	const usage = sumUsage(spec.attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : [])));
	if (spec.result.status === "ok") {
		const outputBlob = jsonBlob("call-output", spec.result.output);
		await completeNode(db, node, {
			endMs: spec.endMs,
			runStatus: "done",
			end: {
				status: "ok",
				output_blob_hash: outputBlob.hash,
				...(usage && { usage }),
				attempts: spec.attempts.length,
				resolved_model: WORKER_MODEL,
			},
			events,
			blobs: [...blobs, outputBlob],
		});
		return;
	}
	const rawBlob = spec.result.rawOutput === undefined ? undefined : textBlob("call-raw-output", spec.result.rawOutput);
	await completeNode(db, node, {
		endMs: spec.endMs,
		runStatus: "error",
		end: {
			status: "error",
			...(rawBlob && { output_blob_hash: rawBlob.hash }),
			error: spec.result.error,
			...(usage && { usage }),
			attempts: spec.attempts.length,
			...(usage && { resolved_model: WORKER_MODEL }),
		},
		events,
		blobs: rawBlob ? [...blobs, rawBlob] : blobs,
	});
}

// ── kernel.decide ──

interface BoolQuestionSpec {
	type: "bool";
	instructions: string;
	criteria: { true: string; false: string };
}
interface ChoiceQuestionSpec {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
}
type QuestionSpec = BoolQuestionSpec | ChoiceQuestionSpec;

interface DecisionNodeSpec extends Omit<NodeScope, "kind" | "deadlineMs"> {
	state: Record<string, unknown>;
	/** Pi questions (thresholds stripped); the effective thresholds live in each answer. */
	questions: Record<string, QuestionSpec>;
	/** The node's one engine attempt (one snapshot and one turn). */
	engineAttempt: EngineAttemptSpec;
	/** Jev's answers as the System One response carries them (absent when the request failed). */
	wireAnswers?: Record<string, Record<string, unknown>>;
	/** Engine retries inside the one attempt (call_end.attempts). */
	engineAttempts: number;
	endMs: number;
	answers: Record<string, Decision>;
	chosen: string;
	error?: { kind: string; message: string; http_status?: number };
}

const JEV_THRESHOLDS: ThresholdApplied = { passAt: 0.85, failAt: 0.15 };

function jevUsage(input: number, output: number): TurnUsage {
	return {
		inputTokens: input,
		outputTokens: output,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		model: JEV_MODEL,
		costEstimate: input * JEV_INPUT_PRICE,
	};
}

/** Pi's System One wire body: a `bool` question goes out as `noul` (plan §2 row 13). */
function jevWireRequest(state: Record<string, unknown>, questions: Record<string, QuestionSpec>): unknown {
	const wireQuestions = Object.fromEntries(
		Object.entries(questions).map(([id, question]) => [
			id,
			question.type === "bool" ? { ...question, type: "noul" } : question,
		]),
	);
	return { model: "jev-1.13.0", state, questions: wireQuestions };
}

async function writeDecision(db: KernelDatabase, spec: DecisionNodeSpec): Promise<void> {
	const context = { state: spec.state, questions: spec.questions };
	const contextBlob = jsonBlob("classifier-context", context);
	const promptHash = `dq1-${sha256Hex(canonicalJson({ questions: spec.questions }))}`;
	const node = await claimNode(
		db,
		{ ...spec, kind: "decision", deadlineMs: DECIDE_DEADLINE_MS },
		{
			engine: "jev",
			model: JEV_MODEL,
			provider: JEV_PROVIDER,
			api: JEV_API,
			prompt_hash: promptHash,
			input_blob_hash: contextBlob.hash,
		},
		[contextBlob],
	);

	const contextText = JSON.stringify(context, null, 2);
	const messageBlob = jsonBlob("message", {
		role: "classifier_context",
		content: [{ type: "text", text: contextText }],
	});
	const requestBlob = jsonBlob("classifier-request", jevWireRequest(spec.state, spec.questions));
	const usage = spec.engineAttempt.usage;
	const responseBlob =
		spec.wireAnswers && usage
			? jsonBlob("call-response", {
					model: "jev-1.13.0",
					answers: spec.wireAnswers,
					usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
				})
			: spec.engineAttempt.httpStatus !== undefined
				? jsonBlob("call-response", { detail: "upstream: Service Unavailable" })
				: undefined;
	const events = attemptEvents(
		node,
		0,
		spec.engineAttempt,
		{
			systemPromptBlob: null,
			promptHash,
			messages: [{ role: "classifier_context", blob: messageBlob, textChars: contextText.length }],
			requestBlob,
			requestKind: "classifier",
		},
		responseBlob,
	);

	const answers = Object.values(spec.answers);
	const abstained = answers.some((answer) => answer.abstained);
	const reasons = answers.flatMap((answer) => (answer.abstainReason ? [answer.abstainReason] : []));
	const abstainReason = (["engine-error", "refusal", "low-confidence"] as const).find((reason) =>
		reasons.includes(reason),
	);
	const decisionMade: DecisionMadeData = {
		run_id: spec.runId,
		decision_name: spec.name,
		answers: spec.answers,
		chosen: spec.chosen,
		confidence_source: answers[0]?.confidenceSource ?? "none",
		abstained,
		...(abstainReason !== undefined && { abstain_reason: abstainReason }),
		threshold_applied: Object.fromEntries(
			Object.entries(spec.answers).map(([id, answer]) => [id, answer.thresholdApplied]),
		),
		engine: "jev",
		provider: JEV_PROVIDER,
		api: JEV_API,
		model: JEV_MODEL,
		requested_model: JEV_MODEL,
		...(spec.error && { error_kind: spec.error.kind }),
		...(spec.gateSpanId !== undefined && { gate_span_id: spec.gateSpanId }),
	};
	events.push(
		createDecisionMadeEvent(node.traceIds, decisionMade, {
			eventId: kernelNodeEventId(spec.runId, 0, "decision_made"),
			parentEventId: node.startEventId,
			timestamp: at(spec.engineAttempt.endMs + 1),
		}),
	);

	// The answers blob is written for every outcome, abstained ones included.
	const outputBlob = jsonBlob("call-output", spec.answers);
	await completeNode(db, node, {
		endMs: spec.endMs,
		runStatus: spec.error ? "error" : "done",
		end: {
			status: spec.error ? "error" : "ok",
			output_blob_hash: outputBlob.hash,
			...(spec.error && { error: spec.error }),
			...(usage && { usage }),
			attempts: spec.engineAttempts,
			resolved_model: JEV_MODEL,
		},
		events,
		blobs: [messageBlob, requestBlob, ...(responseBlob ? [responseBlob] : []), outputBlob],
	});
}

function boolAnswer(probability: number): Decision {
	const verdict = probability >= JEV_THRESHOLDS.passAt! ? "pass" : probability <= JEV_THRESHOLDS.failAt! ? "fail" : null;
	return {
		kind: "bool",
		choice: probability >= 0.5 ? "true" : "false",
		probability,
		confidence: Math.max(probability, 1 - probability),
		confidenceSource: "native",
		...(verdict !== null && { verdict }),
		abstained: verdict === null,
		...(verdict === null && { abstainReason: "low-confidence" as const }),
		thresholdApplied: JEV_THRESHOLDS,
	};
}

const ENGINE_ERROR_ANSWER: Decision = {
	kind: "bool",
	confidenceSource: "none",
	abstained: true,
	abstainReason: "engine-error",
	thresholdApplied: {},
};

// ── kernel.step / kernel.gate ──

interface StepSpec {
	spanId: string;
	name: string;
	runId: string;
	startMs: number;
	endMs: number;
	startAttributes?: Record<string, string | number | boolean | null>;
	end: Omit<StepEndData, "step_name" | "run_id" | "status" | "duration_ms" | "gate_span_id">;
	gate?: { spanId: string; startEventId: string };
}

function stepEvents(spec: StepSpec): TraceEvent[] {
	const ids: TraceEventIds = { containerId: CONTAINER_ID, runId: spec.runId };
	const linkage = {
		spanId: spec.spanId,
		...(spec.gate && { parentEventId: spec.gate.startEventId }),
	};
	const gateSpan = spec.gate ? { gate_span_id: spec.gate.spanId } : {};
	return [
		createStepStartEvent(
			ids,
			{ step_name: spec.name, ...(spec.startAttributes && { attributes: spec.startAttributes }), ...gateSpan },
			{ ...linkage, eventId: spanEventId(spec.spanId, "step_start"), timestamp: at(spec.startMs) },
		),
		createStepEndEvent(
			ids,
			{ step_name: spec.name, status: "ok", duration_ms: spec.endMs - spec.startMs, ...spec.end, ...gateSpan },
			{ ...linkage, eventId: spanEventId(spec.spanId, "step_end"), timestamp: at(spec.endMs) },
		),
	];
}

// ─── The story ───────────────────────────────────────────────────────────────

const ADVISORIES = {
	A1: {
		rule_id: "type_erasing_cast",
		severity: "warning",
		file: "src/d/actor/d_a_player.cpp",
		line: 1184,
		excerpt: "(u32)this->mpActor",
		justification:
			"The original compares mpActor as an unsigned word (cmplwi r3, 0); without the cast mwcc emits cmpwi and the branch after it moves by two instructions.",
		hunk: "@@ -1182,5 +1182,5 @@\n-    if (this->mpActor != NULL) {\n+    if ((u32)this->mpActor != 0) {\n         this->mpActor->execute();",
	},
	A2: {
		rule_id: "stack_offset_local",
		severity: "warning",
		file: "src/d/actor/d_a_player.cpp",
		line: 1192,
		excerpt: "u8 sp08[8];",
		justification:
			"The frame reserves an 8-byte scratch buffer at sp+0x8 that only PSVECNormalize reads; no symbol names it, so the offset name is the honest one.",
		hunk: "@@ -1190,4 +1190,5 @@\n+    u8 sp08[8];\n     PSVECNormalize(&this->mVelocity, (Vec*)sp08);",
	},
	A3: {
		rule_id: "type_erasing_cast",
		severity: "warning",
		file: "src/d/actor/d_a_player.cpp",
		line: 1210,
		excerpt: "(s16)mAngle.y",
		justification: "The cast seems to match two more instructions; unsure whether mAngle.y is already an s16.",
		hunk: "@@ -1208,3 +1208,3 @@\n-    angle = mAngle.y;\n+    angle = (s16)mAngle.y;",
	},
} as const;
type AdvisoryId = keyof typeof ADVISORIES;

const JUSTIFIED_QUESTION: BoolQuestionSpec = {
	type: "bool",
	instructions: "Decide whether the original assembly needs this hunk exactly as written.",
	criteria: {
		true: "The hunk is required to reproduce the original instructions; removing it changes the compiled code.",
		false: "The hunk is not required; the original compiles the same without it, or it only hides a type error.",
	},
};

function advisoryState(id: AdvisoryId): Record<string, unknown> {
	const advisory = ADVISORIES[id];
	return {
		finding: advisory.rule_id,
		rule_message: "Review-lint advisory (llm_review): justify or remove.",
		detail: { llm_review: true, severity: advisory.severity, finding_id: id },
		file: advisory.file,
		hunk: advisory.hunk,
		justification: advisory.justification,
		code_facts: { line: advisory.line, excerpt: advisory.excerpt, objdiff_percent: 97.4 },
	};
}

const R1_PROMPT =
	"Decompile fn_8003A1C4 in src/d/actor/d_a_player.cpp until objdiff reports an exact match. Write a checkpoint note that lists every review-lint advisory you keep and why.";
const R1_NOTE = [
	"Checkpoint ckpt-1: fn_8003A1C4 at 97.4% (micro-gates 5/5).",
	"Kept advisories:",
	"- A1 type_erasing_cast `(u32)this->mpActor`: the original compares unsigned (cmplwi).",
	"- A2 stack_offset_local `u8 sp08[8]`: unnamed scratch buffer at sp+0x8.",
	"- A3 type_erasing_cast `(s16)mAngle.y`: matches two more instructions; not sure it is needed.",
	"Remaining diff: the tail call through mpActor is two instructions short.",
].join("\n");
const R5_PROMPT =
	"Retry fn_8003A1C4 with a new strategy: keep the (u32) cast on mpActor and move the actor-state switch above the tail call so mwcc emits the jump table first.";
const R5_NOTE =
	"Checkpoint ckpt-2: fn_8003A1C4 is an exact match (objdiff 100%, micro-gates 5/5, review_lint clean).";

const FINDING_REFS = (Object.keys(ADVISORIES) as AdvisoryId[]).map((id) => ({
	id,
	rule_id: ADVISORIES[id].rule_id,
	severity: ADVISORIES[id].severity,
	file: ADVISORIES[id].file,
	line: ADVISORIES[id].line,
	excerpt: ADVISORIES[id].excerpt,
}));

const EXTRACT_SYSTEM =
	"Extract the checkpoint status and, for each review-lint finding, whether the note keeps it and the justification it gives. Answer in the output format.";
const R2_OUTPUT = {
	status: "partial",
	objdiff_percent: 97.4,
	kept_advisories: (Object.keys(ADVISORIES) as AdvisoryId[]).map((id) => ({
		finding_id: id,
		rule_id: ADVISORIES[id].rule_id,
		kept: true,
		justification: ADVISORIES[id].justification,
		evidence: [`${ADVISORIES[id].file}:${ADVISORIES[id].line}`],
	})),
	remaining_diff: "Tail call through mpActor is two instructions short.",
};
const R6_OUTPUT = { status: "exact", objdiff_percent: 100, kept_advisories: [], remaining_diff: null };
const JUDGE_RAW_OUTPUT =
	'{"verdict": "needs_info", "rationale": "The (s16) cast changes the load from lwz to lha, but the hunk alone does not show whether mAngle.y is declared';
const SUMMARY_OUTPUT = {
	outcome: "exact_match",
	attempts: 2,
	narrative:
		"Attempt 1 reached 97.4% with three kept advisories (A1 and A2 accepted, A3 unsure). Attempt 2 kept the unsigned compare on mpActor, moved the actor-state switch above the tail call, and matched exactly.",
};
const CONFIRMED_OUTPUT = {
	tactics: [
		{
			name: "switch-before-tail-call",
			description: "Place the state switch above the tail call through the actor pointer.",
			applies_when: "mwcc emits the jump table after a virtual tail call",
			evidence: ["src/d/actor/d_a_player.cpp:1186"],
		},
	],
	codegen_quirks: [
		{
			compiler_behavior: "A pointer compared against 0 without a cast compiles to cmpwi",
			source_shape: "(u32)ptr != 0 produces cmplwi",
			evidence: ["objdiff fn_8003A1C4 0x8003A2F0"],
		},
	],
	type_facts: [
		{ subject: "daPy_c::mpActor", fact: "Compared unsigned in fn_8003A1C4", evidence: ["d_a_player.cpp:1184"] },
	],
	idioms: [],
	kept_advisories: [
		{
			finding_id: "A1",
			rule_id: "type_erasing_cast",
			kept: true,
			justification: ADVISORIES.A1.justification,
			evidence: ["d_a_player.cpp:1184"],
		},
	],
};

async function generate(db: KernelDatabase): Promise<void> {
	await upsertContainer(db, {
		id: CONTAINER_ID,
		kernelId: KERNEL_ID,
		kind: "session",
		appKey: ["worker-job", "fn_8003A1C4"],
		label: "worker-job/fn_8003A1C4",
		status: "active",
		workingDir: "/workspace/harnesses/gamecube-decomp-harness",
		metadata: {
			app: "gamecube-decomp-harness",
			job: "worker-job/fn_8003A1C4",
			topic: "fn_8003A1C4 in d_a_player.cpp",
			target: "fn_8003A1C4",
			unit: "d_a_player.cpp",
		},
		createdAt: at(0),
		startedAt: at(0),
	});

	const worker = new WorkerSession(db);

	// ── Attempt 1: R1 (system), 4m12s ──
	await worker.writeRun({
		key: "r1",
		runId: RUNS.R1,
		trigger: "system",
		startMs: 0,
		endMs: 252_000,
		prompt: R1_PROMPT,
		turns: [
			{
				startMs: 20,
				endMs: 47_150,
				stopReason: "toolUse",
				usage: { input: 41_200, output: 1_850, cacheRead: 0, cost: 0.112 },
				tools: [
					{
						id: TOOL_USE.CODEMODE,
						name: "codemode",
						args: {
							code: [
								'const src = await tools.read({ path: "src/d/actor/d_a_player.cpp" });',
								'await tools.bash({ command: "ninja build/GZLE01/d_a_player.o" });',
								'return tools.diff_function({ symbol: "fn_8003A1C4" });',
							].join("\n"),
						},
						output: "fn_8003A1C4: 95.1% (2 instructions differ in the mpActor compare)",
						startMs: 18_400,
						endMs: 47_100,
						nested: [
							{
								id: TOOL_USE.NESTED_READ,
								name: "read",
								args: { path: "src/d/actor/d_a_player.cpp" },
								output: "src/d/actor/d_a_player.cpp: 2,418 lines",
								startMs: 18_420,
								endMs: 18_460,
							},
							{
								id: TOOL_USE.NESTED_BASH,
								name: "bash",
								args: { command: "ninja build/GZLE01/d_a_player.o" },
								output: "[1/1] mwcc d_a_player.cpp",
								startMs: 18_480,
								endMs: 41_200,
								approximateEndMs: 47_100,
							},
							{
								id: TOOL_USE.NESTED_DIFF,
								name: "diff_function",
								args: { symbol: "fn_8003A1C4" },
								output: "fn_8003A1C4: 95.1%",
								startMs: 41_300,
								endMs: 47_000,
							},
							{
								id: TOOL_USE.NESTED_DIFF_BASH,
								name: "bash",
								args: { command: "objdiff-cli diff -u d_a_player fn_8003A1C4 --format json" },
								output: '{"fuzzy_match_percent": 95.1}',
								startMs: 41_320,
								endMs: 46_900,
							},
						],
					},
				],
			},
			{
				startMs: 47_300,
				endMs: 118_300,
				stopReason: "toolUse",
				usage: { input: 48_900, output: 2_400, cacheRead: 38_000, cost: 0.131 },
				tools: [
					{
						id: TOOL_USE.R1_EDIT,
						name: "edit",
						args: {
							path: "src/d/actor/d_a_player.cpp",
							old: "if (this->mpActor != NULL) {",
							new: "if ((u32)this->mpActor != 0) {",
						},
						output: "1 replacement in src/d/actor/d_a_player.cpp",
						startMs: 118_000,
						endMs: 118_200,
					},
				],
			},
			{
				startMs: 118_400,
				endMs: 251_950,
				stopReason: "stop",
				usage: { input: 52_300, output: 1_600, cacheRead: 46_000, cost: 0.137 },
				tools: [],
				reply: { ms: 251_900, text: R1_NOTE },
			},
		],
	});

	// R2: extraction from the R1 note (post-run), 1.8 s, $0.004.
	const r2Usage = callUsage(3_812, 412, 0.004);
	await writeCall(db, {
		name: "ExtractCheckpointKnowledge",
		displayLabel: "ExtractCheckpointKnowledge (R1)",
		requestId: REQUEST.R2,
		runId: RUNS.R2,
		parentRunId: RUNS.R1,
		trigger: "post-run",
		startMs: 252_100,
		attempt: 1,
		args: [R1_NOTE, FINDING_REFS],
		system: EXTRACT_SYSTEM,
		user: `${R1_NOTE}\n\nFindings:\n${JSON.stringify(FINDING_REFS)}`,
		attempts: [
			{
				startMs: 252_101,
				endMs: 253_880,
				httpStatus: 200,
				stopReason: "stop",
				usage: r2Usage,
				response: sseResponse(JSON.stringify(R2_OUTPUT), r2Usage),
			},
		],
		endMs: 253_900,
		result: { status: "ok", output: R2_OUTPUT },
	});

	// S1: validate (objdiff, micro-gates, review_lint), 6.3 s.
	const steps: TraceEvent[] = stepEvents({
		spanId: SPANS.S1,
		name: "validate",
		runId: RUNS.R1,
		startMs: 254_000,
		endMs: 260_300,
		startAttributes: { target: "fn_8003A1C4", unit: "d_a_player.cpp", checkpoint: "ckpt-1" },
		end: {
			attributes: {
				objdiff_percent: 97.4,
				exact: false,
				micro_gates_passed: 5,
				micro_gates_total: 5,
				llm_review_warnings: 3,
			},
			events: [
				{ name: "objdiff", at_ms: 5_210, attributes: { percent: 97.4 } },
				{ name: "micro-gates", at_ms: 5_900, attributes: { passed: 5, total: 5 } },
				{ name: "review_lint", at_ms: 6_240, attributes: { warnings: 3, llm_review: 3 } },
			],
			output_summary: {
				objdiff_percent: 97.4,
				exact: false,
				micro_gates: "5/5",
				llm_review: ["A1 type_erasing_cast", "A2 stack_offset_local", "A3 type_erasing_cast"],
			},
		},
	});

	// Gate checkpoint-accepted. The first pass ended after A2's engine error
	// (the job was killed before gate_end landed); the queue retried the job
	// with the same requestIds: the step checks re-emitted the same span ids
	// (deduped), A1 replayed, A2 claimed attempt 2 and A3 ran.
	const gateStartId = FIXTURE_IDS.events.GATE_START;
	const gate = { spanId: GATE_SPAN_ID, startEventId: gateStartId };
	const gateChecks: Array<{ name: string; kind: "step" | "decide" }> = [
		{ name: "objdiff", kind: "step" },
		{ name: "justification:A1", kind: "step" },
		{ name: "JudgeAdvisory:A1", kind: "decide" },
		{ name: "justification:A2", kind: "step" },
		{ name: "JudgeAdvisory:A2", kind: "decide" },
		{ name: "justification:A3", kind: "step" },
		{ name: "JudgeAdvisory:A3", kind: "decide" },
	];
	steps.push(
		createGateStartEvent(
			{ containerId: CONTAINER_ID, runId: RUNS.R1 },
			{ gate_name: "checkpoint-accepted", checks: gateChecks },
			{ spanId: GATE_SPAN_ID, eventId: gateStartId, timestamp: at(260_400) },
		),
		...stepEvents({
			spanId: SPANS.CHECK_OBJDIFF,
			name: "objdiff",
			runId: RUNS.R1,
			startMs: 260_401,
			endMs: 260_402,
			startAttributes: { floor_percent: 95 },
			end: { check_result: "pass", check_value: 97.4, attributes: { previous_best_percent: 91.2 } },
			gate,
		}),
		...stepEvents({
			spanId: SPANS.CHECK_JUSTIFICATION_A1,
			name: "justification:A1",
			runId: RUNS.R1,
			startMs: 260_403,
			endMs: 260_404,
			end: { check_result: "pass", check_value: true },
			gate,
		}),
		...stepEvents({
			spanId: SPANS.CHECK_JUSTIFICATION_A2,
			name: "justification:A2",
			runId: RUNS.R1,
			startMs: 260_520,
			endMs: 260_521,
			end: { check_result: "pass", check_value: true },
			gate,
		}),
		...stepEvents({
			spanId: SPANS.CHECK_JUSTIFICATION_A3,
			name: "justification:A3",
			runId: RUNS.R1,
			startMs: 290_130,
			endMs: 290_131,
			end: { check_result: "pass", check_value: true },
			gate,
		}),
	);

	// R3: JudgeAdvisory:A1, p = 0.91 ≥ 0.85 → pass, 110 ms, 1,412 input tokens.
	await writeDecision(db, {
		name: "JudgeAdvisory:A1",
		displayLabel: "JudgeAdvisory:A1",
		requestId: REQUEST.R3,
		runId: RUNS.R3,
		parentRunId: RUNS.R1,
		trigger: "judge",
		gateSpanId: GATE_SPAN_ID,
		startMs: 260_405,
		attempt: 1,
		state: advisoryState("A1"),
		questions: { justified: JUSTIFIED_QUESTION },
		engineAttempt: { startMs: 260_406, endMs: 260_513, stopReason: "stop", usage: jevUsage(1_412, 4) },
		wireAnswers: { justified: { type: "noul", noul: 0.91 } },
		engineAttempts: 1,
		endMs: 260_515,
		answers: { justified: boolAnswer(0.91) },
		chosen: "true",
	});

	// JudgeAdvisory:A2 attempt 1: Jev answered 503 twice → engine-error abstain, run error.
	await writeDecision(db, {
		name: "JudgeAdvisory:A2",
		displayLabel: "JudgeAdvisory:A2",
		requestId: REQUEST.RETRY_DECISION,
		runId: RUNS.RETRY_ATTEMPT_1,
		parentRunId: RUNS.R1,
		trigger: "judge",
		gateSpanId: GATE_SPAN_ID,
		startMs: 260_522,
		attempt: 1,
		state: advisoryState("A2"),
		questions: { justified: JUSTIFIED_QUESTION },
		engineAttempt: { startMs: 260_523, endMs: 261_760, httpStatus: 503, stopReason: "error" },
		engineAttempts: 2,
		endMs: 261_762,
		answers: { justified: ENGINE_ERROR_ANSWER },
		chosen: "abstain",
		error: { kind: "provider", message: "typesafe-system-one answered HTTP 503", http_status: 503 },
	});

	// JudgeAdvisory:A2 attempt 2 (same requestId, after the job retry): p = 0.88 → pass.
	await writeDecision(db, {
		name: "JudgeAdvisory:A2",
		displayLabel: "JudgeAdvisory:A2",
		requestId: REQUEST.RETRY_DECISION,
		runId: RUNS.RETRY_ATTEMPT_2,
		parentRunId: RUNS.R1,
		trigger: "judge",
		gateSpanId: GATE_SPAN_ID,
		startMs: 290_000,
		attempt: 2,
		state: advisoryState("A2"),
		questions: { justified: JUSTIFIED_QUESTION },
		engineAttempt: { startMs: 290_001, endMs: 290_118, stopReason: "stop", usage: jevUsage(1_388, 4) },
		wireAnswers: { justified: { type: "noul", noul: 0.88 } },
		engineAttempts: 1,
		endMs: 290_120,
		answers: { justified: boolAnswer(0.88) },
		chosen: "true",
	});

	// JudgeAdvisory:A3: p = 0.52 → abstain (low-confidence), run done.
	await writeDecision(db, {
		name: "JudgeAdvisory:A3",
		displayLabel: "JudgeAdvisory:A3",
		requestId: REQUEST.ABSTAIN,
		runId: RUNS.ABSTAIN,
		parentRunId: RUNS.R1,
		trigger: "judge",
		gateSpanId: GATE_SPAN_ID,
		startMs: 290_132,
		attempt: 1,
		state: advisoryState("A3"),
		questions: { justified: JUSTIFIED_QUESTION },
		engineAttempt: { startMs: 290_133, endMs: 290_230, stopReason: "stop", usage: jevUsage(1_436, 4) },
		wireAnswers: { justified: { type: "noul", noul: 0.52 } },
		engineAttempts: 1,
		endMs: 290_232,
		answers: { justified: boolAnswer(0.52) },
		chosen: "abstain",
	});

	const gateCheckRecords: GateCheckRecord[] = [
		{ name: "objdiff", kind: "step", result: "pass", value: 97.4, reason: "improved from 91.2%", step_span_id: SPANS.CHECK_OBJDIFF },
		{ name: "justification:A1", kind: "step", result: "pass", value: true, step_span_id: SPANS.CHECK_JUSTIFICATION_A1 },
		gateDecideRecord("JudgeAdvisory:A1", RUNS.R3, 0.91),
		{ name: "justification:A2", kind: "step", result: "pass", value: true, step_span_id: SPANS.CHECK_JUSTIFICATION_A2 },
		gateDecideRecord("JudgeAdvisory:A2", RUNS.RETRY_ATTEMPT_2, 0.88),
		{ name: "justification:A3", kind: "step", result: "pass", value: true, step_span_id: SPANS.CHECK_JUSTIFICATION_A3 },
		gateDecideRecord("JudgeAdvisory:A3", RUNS.ABSTAIN, 0.52),
	];
	steps.push(
		createGateEndEvent(
			{ containerId: CONTAINER_ID, runId: RUNS.R1 },
			{ gate_name: "checkpoint-accepted", verdict: "abstain", checks: gateCheckRecords, duration_ms: 290_240 - 260_400 },
			{ spanId: GATE_SPAN_ID, eventId: spanEventId(GATE_SPAN_ID, "gate_end"), timestamp: at(290_240) },
		),
	);
	await insertTraceEventsBatch(db, steps);

	// Escalation of the abstained A3: the BAML judge's output is truncated → parse error.
	const judgeUsage = callUsage(2_204, 380, 0.0026);
	await writeCall(db, {
		name: "JudgeAdvisoryWithRationale",
		displayLabel: "JudgeAdvisoryWithRationale:A3",
		requestId: REQUEST.FAILED_CALL,
		runId: RUNS.FAILED_CALL,
		parentRunId: RUNS.R1,
		trigger: "judge",
		startMs: 290_400,
		attempt: 1,
		args: [advisoryState("A3")],
		system: "Judge whether the original assembly needs this hunk. Answer accepted, rejected or needs_info with a rationale.",
		user: JSON.stringify(advisoryState("A3"), null, 2),
		attempts: [
			{
				startMs: 290_401,
				endMs: 292_480,
				httpStatus: 200,
				stopReason: "error",
				usage: judgeUsage,
				response: sseResponse(JUDGE_RAW_OUTPUT, judgeUsage),
			},
		],
		endMs: 292_500,
		result: {
			status: "error",
			error: { kind: "parse", message: "model output did not parse" },
			rawOutput: JUDGE_RAW_OUTPUT,
		},
	});

	// R4: ContinueOrStop, retry_new_strategy 0.71 (confidence 0.64, floor 0.5), 95 ms.
	await writeDecision(db, {
		name: "ContinueOrStop",
		displayLabel: "ContinueOrStop",
		requestId: REQUEST.R4,
		runId: RUNS.R4,
		parentRunId: RUNS.R1,
		trigger: "judge",
		startMs: 292_700,
		attempt: 1,
		state: {
			note: { status: "partial", kept_advisories: 3, remaining_diff: R2_OUTPUT.remaining_diff },
			validation: { objdiff_percent: 97.4, exact: false, micro_gates: "5/5" },
			gate: { name: "checkpoint-accepted", verdict: "abstain" },
			attempt: 1,
			attempt_budget: 3,
		},
		questions: {
			next: {
				type: "choice",
				instructions: "Pick the next step for this worker job.",
				criteria: {
					retry_same_approach: "Another attempt with the same approach is likely to close the remaining diff.",
					retry_new_strategy: "The remaining diff needs a different approach; retry with a strategy hint.",
					stop_blocked: "The target is blocked; further attempts will not close the diff.",
				},
			},
		},
		engineAttempt: { startMs: 292_701, endMs: 292_792, stopReason: "stop", usage: jevUsage(968, 9) },
		wireAnswers: {
			next: {
				type: "choice",
				choice: "retry_new_strategy",
				distribution: { retry_same_approach: 0.21, retry_new_strategy: 0.71, stop_blocked: 0.08 },
				confidence: 0.64,
			},
		},
		engineAttempts: 1,
		endMs: 292_795,
		answers: {
			next: {
				kind: "choice",
				choice: "retry_new_strategy",
				distribution: { retry_same_approach: 0.21, retry_new_strategy: 0.71, stop_blocked: 0.08 },
				confidence: 0.64,
				confidenceSource: "native",
				abstained: false,
				thresholdApplied: { minTop: 0.5, minMargin: 0.2 },
			},
		},
		chosen: "retry_new_strategy",
	});

	// SummarizeWorkerRun attempt 1 (parent R1): codex-lb answered 502 twice → error.
	await writeCall(db, {
		name: "SummarizeWorkerRun",
		displayLabel: "SummarizeWorkerRun (R1)",
		requestId: REQUEST.SUMMARY,
		runId: RUNS.SUMMARY_ATTEMPT_1,
		parentRunId: RUNS.R1,
		trigger: "post-run",
		startMs: 292_900,
		attempt: 1,
		args: [{ session: WORKER_SESSION_ID, through_run: RUNS.R1 }],
		system: "Write the worker-run narrative for the knowledge DB.",
		user: R1_NOTE,
		attempts: [
			{ startMs: 292_901, endMs: 293_150, httpStatus: 502, stopReason: "error", response: { status: 502, headers: {}, body: "Bad Gateway" } },
			{ startMs: 293_650, endMs: 293_880, httpStatus: 502, stopReason: "error", response: { status: 502, headers: {}, body: "Bad Gateway" } },
		],
		endMs: 293_900,
		result: { status: "error", error: { kind: "http", message: "HTTP 502", http_status: 502 } },
	});

	// ── Attempt 2: R5 (steer, same session), 2m40s ──
	await worker.writeRun({
		key: "r5",
		runId: RUNS.R5,
		trigger: "steer",
		startMs: 300_000,
		endMs: 460_000,
		prompt: R5_PROMPT,
		turns: [
			{
				startMs: 300_020,
				endMs: 350_200,
				stopReason: "toolUse",
				usage: { input: 54_800, output: 2_100, cacheRead: 48_000, cost: 0.071 },
				tools: [
					{
						id: TOOL_USE.R5_EDIT,
						name: "edit",
						args: {
							path: "src/d/actor/d_a_player.cpp",
							old: "this->mpActor->execute();\n    switch (mState) {",
							new: "switch (mState) {",
						},
						output: "1 replacement in src/d/actor/d_a_player.cpp",
						startMs: 349_800,
						endMs: 350_100,
					},
				],
			},
			{
				startMs: 350_300,
				endMs: 412_000,
				stopReason: "toolUse",
				usage: { input: 57_400, output: 1_200, cacheRead: 52_000, cost: 0.083 },
				tools: [
					{
						id: TOOL_USE.R5_BASH,
						name: "bash",
						args: { command: "ninja && objdiff-cli diff -u d_a_player fn_8003A1C4" },
						output: "fn_8003A1C4: 100.0% (exact)",
						startMs: 380_000,
						endMs: 411_800,
					},
				],
			},
			{
				startMs: 412_100,
				endMs: 459_950,
				stopReason: "stop",
				usage: { input: 58_900, output: 900, cacheRead: 55_000, cost: 0.086 },
				tools: [],
				reply: { ms: 459_900, text: R5_NOTE },
			},
		],
	});

	// R6: extraction from the R5 note, 1.8 s.
	const r6Usage = callUsage(3_120, 188, 0.0038);
	await writeCall(db, {
		name: "ExtractCheckpointKnowledge",
		displayLabel: "ExtractCheckpointKnowledge (R5)",
		requestId: REQUEST.R6,
		runId: RUNS.R6,
		parentRunId: RUNS.R5,
		trigger: "post-run",
		startMs: 460_100,
		attempt: 1,
		args: [R5_NOTE, []],
		system: EXTRACT_SYSTEM,
		user: `${R5_NOTE}\n\nFindings:\n[]`,
		attempts: [
			{
				startMs: 460_101,
				endMs: 461_880,
				httpStatus: 200,
				stopReason: "stop",
				usage: r6Usage,
				response: sseResponse(JSON.stringify(R6_OUTPUT), r6Usage),
			},
		],
		endMs: 461_900,
		result: { status: "ok", output: R6_OUTPUT },
	});

	// S2: validate, 5.4 s, exact. S3: stop, 20 ms (code decides; no model).
	await insertTraceEventsBatch(db, [
		...stepEvents({
			spanId: SPANS.S2,
			name: "validate",
			runId: RUNS.R5,
			startMs: 462_000,
			endMs: 467_400,
			startAttributes: { target: "fn_8003A1C4", unit: "d_a_player.cpp", checkpoint: "ckpt-2" },
			end: {
				attributes: {
					objdiff_percent: 100,
					exact: true,
					micro_gates_passed: 5,
					micro_gates_total: 5,
					llm_review_warnings: 0,
				},
				events: [
					{ name: "objdiff", at_ms: 4_400, attributes: { percent: 100 } },
					{ name: "micro-gates", at_ms: 5_000, attributes: { passed: 5, total: 5 } },
					{ name: "review_lint", at_ms: 5_350, attributes: { warnings: 0, llm_review: 0 } },
				],
				output_summary: { objdiff_percent: 100, exact: true, micro_gates: "5/5", llm_review: [] },
			},
		}),
		...stepEvents({
			spanId: SPANS.S3,
			name: "stop",
			runId: RUNS.R5,
			startMs: 467_500,
			endMs: 467_520,
			end: { output_summary: { reason: "exact_match" } },
		}),
	]);

	// SummarizeWorkerRun attempt 2 (same requestId, parent R5): done, 1.4 s.
	const summaryUsage = callUsage(5_960, 640, 0.0042);
	await writeCall(db, {
		name: "SummarizeWorkerRun",
		displayLabel: "SummarizeWorkerRun (R5)",
		requestId: REQUEST.SUMMARY,
		runId: RUNS.SUMMARY_ATTEMPT_2,
		parentRunId: RUNS.R5,
		trigger: "post-run",
		startMs: 467_600,
		attempt: 2,
		args: [{ session: WORKER_SESSION_ID, through_run: RUNS.R5 }],
		system: "Write the worker-run narrative for the knowledge DB.",
		user: `${R1_NOTE}\n\n${R5_NOTE}`,
		attempts: [
			{
				startMs: 467_601,
				endMs: 468_980,
				httpStatus: 200,
				stopReason: "stop",
				usage: summaryUsage,
				response: sseResponse(JSON.stringify(SUMMARY_OUTPUT), summaryUsage),
			},
		],
		endMs: 469_000,
		result: { status: "ok", output: SUMMARY_OUTPUT },
	});

	await worker.end(469_000);

	// ── Settlement: ExtractConfirmedCheckpointKnowledge for ckpt-2 (post-run, parent R5) ──
	// Attempt 1 is claimed and never completes (the process died mid-call).
	const confirmedArgs = [
		{
			unit: "d_a_player.cpp",
			function: "fn_8003A1C4",
			target_key: "main/d/actor/d_a_player::fn_8003A1C4",
			old_score: 97.4,
			new_score: 100,
			exact: true,
			note: R5_NOTE,
			hunks: [ADVISORIES.A1.hunk],
			advisories: FINDING_REFS.slice(0, 1),
		},
	];
	const confirmedInput = jsonBlob("call-input", confirmedArgs);
	const confirmedStart: NodeStartFields = {
		engine: "baml",
		transport: "baml-http",
		model: WORKER_MODEL,
		provider: CALL_PROVIDER,
		api: CALL_API,
		prompt_hash: bamlPromptHash("ExtractConfirmedCheckpointKnowledge"),
		input_blob_hash: confirmedInput.hash,
	};
	await claimNode(
		db,
		{
			kind: "call",
			name: "ExtractConfirmedCheckpointKnowledge",
			displayLabel: "ExtractConfirmedCheckpointKnowledge",
			requestId: REQUEST.CONFIRMED,
			runId: RUNS.CONFIRMED_ATTEMPT_1,
			parentRunId: RUNS.R5,
			trigger: "post-run",
			startMs: 600_000,
			deadlineMs: CALL_DEADLINE_MS,
			attempt: 1,
		},
		confirmedStart,
		[confirmedInput],
	);
	// Attempt 2 claims past deadline_at + 60 s grace: the claim abandons attempt 1
	// (synthesized aborted call_end, error kind "abandoned") and runs; done, 1.6 s.
	const confirmedUsage = callUsage(6_410, 1_120, 0.0094);
	await writeCall(db, {
		name: "ExtractConfirmedCheckpointKnowledge",
		displayLabel: "ExtractConfirmedCheckpointKnowledge",
		requestId: REQUEST.CONFIRMED,
		runId: RUNS.CONFIRMED_ATTEMPT_2,
		parentRunId: RUNS.R5,
		trigger: "post-run",
		startMs: 790_001,
		claimNowMs: 790_000,
		attempt: 2,
		abandons: [RUNS.CONFIRMED_ATTEMPT_1],
		args: confirmedArgs,
		system: "Mine reusable matching knowledge from this confirmed-good checkpoint. Answer in the output format.",
		user: JSON.stringify(confirmedArgs[0], null, 2),
		attempts: [
			{
				startMs: 790_002,
				endMs: 791_580,
				httpStatus: 200,
				stopReason: "stop",
				usage: confirmedUsage,
				response: sseResponse(JSON.stringify(CONFIRMED_OUTPUT), confirmedUsage),
			},
		],
		endMs: 791_600,
		result: { status: "ok", output: CONFIRMED_OUTPUT },
	});

	await updateContainerStatus(db, CONTAINER_ID, "done", { endedAt: at(791_600) });
}

function gateDecideRecord(name: string, runId: string, probability: number): GateCheckRecord {
	const answer = boolAnswer(probability);
	const result = answer.abstained ? "abstain" : (answer.verdict ?? "abstain");
	return {
		name,
		kind: "decide",
		result,
		questions: [
			{
				question_id: "justified",
				result,
				run_id: runId,
				probability,
				pass_at: JEV_THRESHOLDS.passAt,
				fail_at: JEV_THRESHOLDS.failAt,
				...(answer.abstainReason !== undefined && { abstain_reason: answer.abstainReason }),
			},
		],
	};
}

// ─── Output ──────────────────────────────────────────────────────────────────

const SCRIPT_DIR = import.meta.dir;
const DEFAULT_JSON_PATH = resolve(
	SCRIPT_DIR,
	"../../../../packages/viewer-core/src/trace-builder/__fixtures__/model-nodes-demo.json",
);
const DEFAULT_ROUTES_PATH = resolve(SCRIPT_DIR, "routes.json");

interface CliOptions {
	jsonPath: string;
	routesPath: string;
	dbPath?: string;
	journalMode: "delete" | "wal";
	check: boolean;
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = { jsonPath: DEFAULT_JSON_PATH, routesPath: DEFAULT_ROUTES_PATH, journalMode: "delete", check: false };
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = () => {
			const next = argv[++i];
			if (next === undefined) throw new Error(`${flag} needs a value`);
			return next;
		};
		if (flag === "--json") options.jsonPath = resolve(value());
		else if (flag === "--routes") options.routesPath = resolve(value());
		else if (flag === "--db") options.dbPath = resolve(value());
		else if (flag === "--journal-mode") {
			const mode = value();
			if (mode !== "delete" && mode !== "wal") throw new Error(`--journal-mode must be delete or wal, got ${mode}`);
			options.journalMode = mode;
		} else if (flag === "--check") options.check = true;
		else throw new Error(`unknown flag ${flag}`);
	}
	return options;
}

function removeDatabaseFiles(path: string): void {
	for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${path}${suffix}`, { force: true });
}

export interface GeneratedFixture {
	/** The fixture JSON text (rows as the container read service returns them). */
	json: string;
	/** The DS route ids text (routes.json). */
	routes: string;
}

/**
 * Builds the trace into a fresh database at `dbPath` and returns the fixture
 * and route texts. Throws when the trace doctor reports any violation.
 */
export async function buildFixture(dbPath: string, journalMode: "delete" | "wal" = "delete"): Promise<GeneratedFixture> {
	removeDatabaseFiles(dbPath);
	const handle = openKernelDatabase({ path: dbPath });
	try {
		await ensureKernelObservabilitySchema(handle.db);
		await generate(handle.db);

		const report = await runTraceDoctor(handle.db);
		if (!report.ok) throw new Error(`trace doctor found violations:\n${formatDoctorReport(report, dbPath)}`);

		const detail = await createContainerReadService({ db: handle.db, kernelId: KERNEL_ID }).getContainerTrace(CONTAINER_ID);
		if (!detail) throw new Error(`container ${CONTAINER_ID} was not written`);

		const fixtureInfo = {
			kernelId: KERNEL_ID,
			containerId: CONTAINER_ID,
			routePlaceholders: ROUTE_PLACEHOLDERS,
			routeTargets: ROUTE_TARGETS,
		};
		const json = `${JSON.stringify(
			{
				fixture: fixtureInfo,
				containers: detail.containers,
				pi_sessions: detail.pi_sessions,
				agent_runs: detail.agent_runs,
				events: detail.events,
			},
			null,
			2,
		)}\n`;
		const routes = `${JSON.stringify({ ...fixtureInfo, routes: DS_ROUTES, ids: FIXTURE_IDS }, null, 2)}\n`;

		if (journalMode === "delete") handle.db.run(sql`PRAGMA journal_mode = DELETE`);
		return { json, routes };
	} finally {
		handle.close();
		// A rollback-journal database never reads these; SQLite can leave the
		// WAL index behind after the switch.
		if (journalMode === "delete") for (const suffix of ["-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	// Check mode writes nothing: it always builds in a temp DB, so a supplied
	// --db path is never replaced.
	const keepDb = options.dbPath !== undefined && !options.check;
	const tempDir = keepDb ? undefined : mkdtempSync(join(tmpdir(), "mn-fixture-"));
	const dbPath = keepDb ? options.dbPath! : join(tempDir!, "model-nodes-demo.db");
	try {
		const { json, routes } = await buildFixture(dbPath, options.journalMode);
		if (options.check) {
			const stale = [
				[options.jsonPath, json],
				[options.routesPath, routes],
			].filter(([path, text]) => !existsSync(path!) || readFileSync(path!, "utf8") !== text);
			for (const [path] of stale) console.error(`stale: ${path}`);
			if (stale.length > 0) process.exit(1);
			console.log("model-nodes demo fixture is up to date");
			return;
		}
		writeFileSync(options.jsonPath, json);
		writeFileSync(options.routesPath, routes);
		console.log(`wrote ${options.jsonPath}`);
		console.log(`wrote ${options.routesPath}`);
		if (options.dbPath) console.log(`wrote ${options.dbPath} (journal mode ${options.journalMode})`);
		console.log(`container ${CONTAINER_ID}`);
	} finally {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	}
}

if (import.meta.main) await main();
