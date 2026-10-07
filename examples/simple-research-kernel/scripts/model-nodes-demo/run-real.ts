#!/usr/bin/env bun
/**
 * Model-nodes real-API demo (plan M6-D, §7.3).
 *
 * Drives the REAL kernel APIs through the story of the synthetic fixture
 * (`generate-fixture.ts`, README.md): `createKernel` → `spawnAgent` (a faux Pi
 * chat model, two runs on one session: R1 `system`, R5 `steer`, with a
 * `codemode` tool that runs nested tools three levels deep), `call` (BAML
 * functions), `decide` (Pi `classify()`), `step` and `gate`, then the trace
 * doctor. Nothing is written by hand: every row is the kernel's own.
 *
 * Two modes, one story:
 * - offline (default): the fake call engine and `fakePiModels` from
 *   `@agent-kernel/kernel/model-nodes/testing`; decisions go through Pi's real
 *   `typesafe` provider with an in-memory key and a scripted System One wire
 *   (no network, no file outside the temp dir). `shape.test.ts` runs this mode.
 * - live (`MODEL_NODES_LIVE=1`): calls through `bamlEngine` with the GameCube
 *   worktree's generated BAML client and that tree's own `@boundaryml/baml`
 *   (loaded by absolute path here only; the kernel never imports BAML), routed
 *   to codex-lb through the Pi `models.json`; decisions through the kernel's
 *   default Pi engine against Jev (`typesafe/jev-1.13.0`) with
 *   `TYPESAFE_API_KEY` read in-process from `~/.config/codecaine/env`. The
 *   worker spawn stays faux in both modes (the story needs scripted tool calls).
 *
 * Failures, retries and recovery are produced the real way:
 * - JudgeAdvisory:A2 attempt 1 fails: offline the System One wire answers
 *   HTTP 503 (Pi retries once), live the check runs with `timeoutMs: 1`. The
 *   gate's first pass is then "killed" in the justification:A3 step (its
 *   promise is abandoned), and the retried job re-runs the gate with the same
 *   requestIds: the step spans dedupe, A1 replays, A2 claims attempt 2, A3 runs.
 * - The escalation call fails (offline: a truncated output that does not
 *   parse; live: a budget too short to answer). ContractProbe stands in for the
 *   fixture's SummarizeWorkerRun (the GameCube client has no summarizer): one
 *   requestId, attempt 1 under R1 fails, attempt 2 under R5 succeeds.
 * - ExtractConfirmedCheckpointKnowledge attempt 1 is claimed by a kernel whose
 *   engine never answers (the process "dies" mid-call). A second node set over
 *   the same database, with a clock 190 s later ("the restarted process"),
 *   claims the same requestId past `deadline_at` + 60 s grace: the claim
 *   abandons attempt 1 and runs attempt 2.
 *
 * Usage (from the agent-kernel repo root):
 *   bun examples/simple-research-kernel/scripts/model-nodes-demo/run-real.ts [--db <path>]
 *   MODEL_NODES_LIVE=1 bun examples/simple-research-kernel/scripts/model-nodes-demo/run-real.ts --db /tmp/model-nodes-real/<ts>.db
 *
 * `--db` defaults to /tmp/model-nodes-real/<timestamp>.db and is refused inside
 * a git checkout. After the run the script prints the doctor result, one line
 * per node run (status, served model, latency, tokens, cost) and, in live
 * mode, a secret scan of the database (credential values and bearer or
 * authorization values: counts and row ids only, never the values).
 * Environment: MODEL_NODES_GC_ROOT (default the gamecube-model-nodes worktree),
 * CODECAINE_ENV_FILE (default ~/.config/codecaine/env), PI_CODING_AGENT_DIR
 * (default ~/.pi/agent).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { sql } from "drizzle-orm";

import {
	ensureKernelObservabilitySchema,
	openKernelDatabase,
	updateContainerStatus,
	type KernelDatabase,
} from "@agent-kernel/db";
import {
	createKernel,
	formatDoctorReport,
	KernelCallError,
	type CallEngine,
	type CallManifest,
	type DoctorReport,
	type GateCheckSpec,
	type GateResult,
	type KernelModelsConfig,
	type ModelPriceTable,
	type ModelNodes,
} from "@agent-kernel/kernel";
import { bamlEngine, type BamlRuntimeLike } from "@agent-kernel/kernel/baml-engine";
import {
	createModelNodeContext,
	createModelNodes,
	createPiDecisionEngine,
	type BoolQuestion,
	type ChoiceQuestion,
	type DecisionEngine,
	type FnName,
	type KernelCallsConfig,
	type PiModelsSource,
} from "@agent-kernel/kernel/model-nodes";
import {
	createFakeCallEngine,
	fakeAttempt,
	fakeFailure,
	fakeOk,
	fakePiModels,
	FAKE_CALL_MODEL_REF,
	type FakeCallRequest,
	type FakeCallResponse,
} from "@agent-kernel/kernel/model-nodes/testing";
import { ModelRegistry, ModelRuntime, type ExtensionContext, type ExtensionFactory } from "@agent-kernel/kernel/pi-sdk";
import type { CallEndData, CallStartData, DecisionMadeData } from "@agent-kernel/protocol";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	InMemoryCredentialStore,
	Type,
	type FauxProviderHandle,
} from "@earendil-works/pi-ai";

// ─── Identity ────────────────────────────────────────────────────────────────

export const KERNEL_ID = "model-nodes-real";
export const CONTAINER_KIND = "session";
export const CONTAINER_KEY = ["worker-job", "fn_8003A1C4"];

const CALL_MODEL_LIVE = "codex-lb/gpt-5.6-sol";
const DECIDE_MODEL = "typesafe/jev-1.13.0";
const JEV_SERVED_MODEL = "jev-1.13.0";
const WORKER_PROVIDER = "faux-worker";
const WORKER_MODEL_ID = "gpt-5.6-sol";
/** Jev list price (GameCube NODE_MODEL_PRICES); codex-lb runs on a subscription and stays unpriced. */
const MODEL_PRICES: ModelPriceTable = {
	"typesafe/jev-1.13.0": { inputPerMTok: 0.042, outputPerMTok: 0 },
	"typesafe/jev-latest": { inputPerMTok: 0.042, outputPerMTok: 0 },
};
/** How much later "the restarted process" runs: past the dead attempt's deadline_at + 60 s grace. */
const RESTART_CLOCK_SHIFT_MS = 190_000;
/** Operation budget of the attempt that dies (its abandoned deadline timer fires once, then nothing is pending). */
const DYING_CALL_TIMEOUT_MS = 2_000;
/** Live: a budget too short for codex-lb to answer, so the call fails for real. */
const LIVE_SHORT_CALL_TIMEOUT_MS = 400;

/** Caller requestIds, the idempotency keys the GameCube harness would pass (plan §6.5, §6.8). */
const REQUEST = {
	R2: "checkpoint:ckpt-1:extract",
	S1: "checkpoint:ckpt-1:validate",
	GATE: "checkpoint:ckpt-1:gate",
	FAILED_CALL: "checkpoint:ckpt-1:judge:A3",
	R4: "worker-job:fn_8003A1C4:attempt-1:continue",
	SUMMARY: "worker-job:fn_8003A1C4:summary",
	R6: "checkpoint:ckpt-2:extract",
	S2: "checkpoint:ckpt-2:validate",
	S3: "worker-job:fn_8003A1C4:stop",
	CONFIRMED: "checkpoint_confirmed:ckpt-2",
} as const;

// ─── The BAML functions the story calls (GameCube generated client) ──────────

interface AdvisoryFindingRef {
	id: string;
	rule_id: string;
	severity: "warning" | "info";
	file: string;
	line: number;
	excerpt: string;
	message: string;
}
interface AdvisoryJustification {
	finding_id: string;
	kept: boolean;
	justification?: string | null;
	evidence: string[];
}
interface CheckpointKnowledge {
	advisories: AdvisoryJustification[];
	structured_field_used: boolean;
}
interface AdvisoryCase {
	finding: AdvisoryFindingRef;
	detail?: string | null;
	hunk?: string | null;
	justification?: string | null;
	code_facts: { exact: boolean; old_score?: number | null; new_score?: number | null };
}
interface AdvisoryJudgement {
	verdict: "ACCEPTED" | "REJECTED" | "NEEDS_INFO";
	rationale: string;
	confidence: number;
}
interface ConfirmedCheckpointInput {
	unit: string;
	function_name: string;
	target_key: string;
	old_score?: number | null;
	new_score?: number | null;
	exact: boolean;
	note: string;
	hunks: string[];
	advisories: AdvisoryFindingRef[];
	prior_adjudication?: string | null;
}
interface ConfirmedCheckpointKnowledge {
	tactics: Array<{ name: string; description: string; applies_when: string; evidence: string[] }>;
	codegen_quirks: Array<{ compiler_behavior: string; source_shape: string; evidence: string[] }>;
	type_facts: Array<{ subject: string; fact: string; evidence: string[] }>;
	idioms: Array<{ pattern: string; produced_match: boolean; evidence: string[] }>;
	kept_advisories: AdvisoryJustification[];
}

/**
 * Structural twin of the generated client's methods this demo calls
 * (`apps/server/baml_src/functions/*.baml` in the GameCube worktree). Typed
 * here so the example typechecks without that tree; the live client is
 * checked against it at runtime by `bamlEngine` (unknown functions throw).
 */
export interface DemoCalls {
	ContractProbe(text: string, options?: object): Promise<{ ok: boolean }>;
	ExtractCheckpointKnowledge(note: string, findings: AdvisoryFindingRef[], options?: object): Promise<CheckpointKnowledge>;
	ExtractConfirmedCheckpointKnowledge(input: ConfirmedCheckpointInput, options?: object): Promise<ConfirmedCheckpointKnowledge>;
	JudgeAdvisoryWithRationale(advisory: AdvisoryCase, options?: object): Promise<AdvisoryJudgement>;
}
type DemoFn = FnName<DemoCalls>;
const DEMO_FUNCTIONS: readonly DemoFn[] = [
	"ContractProbe",
	"ExtractCheckpointKnowledge",
	"ExtractConfirmedCheckpointKnowledge",
	"JudgeAdvisoryWithRationale",
];

// ─── The story ───────────────────────────────────────────────────────────────

const ADVISORIES = {
	A1: {
		rule_id: "type_erasing_cast",
		file: "src/d/actor/d_a_player.cpp",
		line: 1184,
		excerpt: "(u32)this->mpActor",
		justification:
			"The original compares mpActor as an unsigned word (cmplwi r3, 0); without the cast mwcc emits cmpwi and the branch after it moves by two instructions.",
		hunk: "@@ -1182,5 +1182,5 @@\n-    if (this->mpActor != NULL) {\n+    if ((u32)this->mpActor != 0) {\n         this->mpActor->execute();",
	},
	A2: {
		rule_id: "stack_offset_local",
		file: "src/d/actor/d_a_player.cpp",
		line: 1192,
		excerpt: "u8 sp08[8];",
		justification:
			"The frame reserves an 8-byte scratch buffer at sp+0x8 that only PSVECNormalize reads; no symbol names it, so the offset name is the honest one.",
		hunk: "@@ -1190,4 +1190,5 @@\n+    u8 sp08[8];\n     PSVECNormalize(&this->mVelocity, (Vec*)sp08);",
	},
	A3: {
		rule_id: "type_erasing_cast",
		file: "src/d/actor/d_a_player.cpp",
		line: 1210,
		excerpt: "(s16)mAngle.y",
		justification: "The cast seems to match two more instructions; unsure whether mAngle.y is already an s16.",
		hunk: "@@ -1208,3 +1208,3 @@\n-    angle = mAngle.y;\n+    angle = (s16)mAngle.y;",
	},
} as const;
type AdvisoryId = keyof typeof ADVISORIES;
const ADVISORY_IDS = Object.keys(ADVISORIES) as AdvisoryId[];

const RULE_MESSAGE = "Review-lint advisory (llm_review): justify the flagged code or remove it.";

function findingRef(id: AdvisoryId): AdvisoryFindingRef {
	const a = ADVISORIES[id];
	return { id, rule_id: a.rule_id, severity: "warning", file: a.file, line: a.line, excerpt: a.excerpt, message: RULE_MESSAGE };
}
const FINDING_REFS = ADVISORY_IDS.map(findingRef);

/** Decision state for one advisory (the question's subject); never the prompt of a call. */
function advisoryState(id: AdvisoryId): Record<string, string | number | boolean | null | Record<string, string | number | boolean>> {
	const a = ADVISORIES[id];
	return {
		finding: a.rule_id,
		rule_message: RULE_MESSAGE,
		detail: { llm_review: true, severity: "warning", finding_id: id },
		file: a.file,
		hunk: a.hunk,
		justification: a.justification,
		code_facts: { line: a.line, excerpt: a.excerpt, objdiff_percent: 97.4 },
	};
}

const JUSTIFIED_QUESTION: BoolQuestion = {
	type: "bool",
	instructions: "Decide whether the original assembly needs this hunk exactly as written.",
	criteria: {
		true: "The hunk is required to reproduce the original instructions; removing it changes the compiled code.",
		false: "The hunk is not required; the original compiles the same without it, or it only hides a type error.",
	},
};
/** A3's justification hedges; the harness holds it to a stricter bar, so an unsure model abstains. */
const STRICT_JUSTIFIED_QUESTION: BoolQuestion = { ...JUSTIFIED_QUESTION, passAt: 0.97, failAt: 0.03 };

const CONTINUE_QUESTION: ChoiceQuestion = {
	type: "choice",
	instructions: "Pick the next step for this worker job.",
	criteria: {
		retry_same_approach: "Another attempt with the same approach is likely to close the remaining diff.",
		retry_new_strategy: "The remaining diff needs a different approach; retry with a strategy hint.",
		stop_blocked: "The target is blocked; further attempts will not close the diff.",
	},
	minTop: 0.5,
};

const R1_PROMPT =
	"Decompile fn_8003A1C4 in src/d/actor/d_a_player.cpp until objdiff reports an exact match. Write a checkpoint note that lists every review-lint advisory you keep and why.";
const R1_NOTE = [
	"Checkpoint ckpt-1: fn_8003A1C4 at 97.4% (micro-gates 5/5).",
	"kept_advisories:",
	`- A1 type_erasing_cast \`(u32)this->mpActor\` (${ADVISORIES.A1.file}:${ADVISORIES.A1.line}): ${ADVISORIES.A1.justification}`,
	`- A2 stack_offset_local \`u8 sp08[8]\` (${ADVISORIES.A2.file}:${ADVISORIES.A2.line}): ${ADVISORIES.A2.justification}`,
	`- A3 type_erasing_cast \`(s16)mAngle.y\` (${ADVISORIES.A3.file}:${ADVISORIES.A3.line}): ${ADVISORIES.A3.justification}`,
	"Remaining diff: the tail call through mpActor is two instructions short.",
].join("\n");
const R5_PROMPT =
	"Retry fn_8003A1C4 with a new strategy: keep the (u32) cast on mpActor and move the actor-state switch above the tail call so mwcc emits the jump table first.";
const R5_NOTE = [
	"Checkpoint ckpt-2: fn_8003A1C4 is an exact match (objdiff 100%, micro-gates 5/5, review_lint clean).",
	"Moving the actor-state switch above the tail call made mwcc emit the jump table first; the (u32) compare on mpActor stays (cmplwi).",
].join("\n");

const CONFIRMED_INPUT: ConfirmedCheckpointInput = {
	unit: "main/d/actor/d_a_player",
	function_name: "fn_8003A1C4",
	target_key: "main/d/actor/d_a_player::fn_8003A1C4",
	old_score: 97.4,
	new_score: 100,
	exact: true,
	note: R5_NOTE,
	hunks: [ADVISORIES.A1.hunk],
	advisories: [findingRef("A1")],
	prior_adjudication: null,
};

function judgeCase(id: AdvisoryId): AdvisoryCase {
	const a = ADVISORIES[id];
	return {
		finding: findingRef(id),
		detail: JSON.stringify({ rule: a.rule_id, excerpt: a.excerpt }),
		hunk: a.hunk,
		justification: a.justification,
		code_facts: { exact: false, old_score: 91.2, new_score: 97.4 },
	};
}

// ─── Offline engines ─────────────────────────────────────────────────────────

/** Canned outputs (offline). Live mode gets whatever codex-lb answers. */
const OFFLINE_OUTPUT = {
	R2: {
		advisories: ADVISORY_IDS.map((id) => ({
			finding_id: id,
			kept: true,
			justification: ADVISORIES[id].justification,
			evidence: [`${ADVISORIES[id].file}:${ADVISORIES[id].line}`],
		})),
		structured_field_used: true,
	} satisfies CheckpointKnowledge,
	R6: { advisories: [], structured_field_used: false } satisfies CheckpointKnowledge,
	JUDGE_RAW:
		'{"verdict": "NEEDS_INFO", "rationale": "The (s16) cast changes the load from lwz to lha, but the hunk alone does not show whether mAngle.y is declared',
	CONFIRMED: {
		tactics: [
			{
				name: "move the state switch above the tail call",
				description: "Place the actor-state switch above the tail call through the actor pointer.",
				applies_when: "mwcc emits the jump table after a virtual tail call",
				evidence: ["Moving the actor-state switch above the tail call made mwcc emit the jump table first"],
			},
		],
		codegen_quirks: [
			{
				compiler_behavior: "A pointer compared against 0 without a cast compiles to cmpwi",
				source_shape: "(u32)ptr != 0 produces cmplwi",
				evidence: ["the (u32) compare on mpActor stays (cmplwi)"],
			},
		],
		type_facts: [],
		idioms: [],
		kept_advisories: [
			{ finding_id: "A1", kept: true, justification: ADVISORIES.A1.justification, evidence: ["cmplwi r3, 0"] },
		],
	} satisfies ConfirmedCheckpointKnowledge,
} as const;

/**
 * Offline call outcomes per function, in story order, with OpenAI
 * Responses-shaped attempts like the BAML engine's. Each invocation takes as
 * long as its attempts say, so node timestamps stay in wall-clock order.
 */
function offlineCallResponder(): (req: FakeCallRequest<DemoCalls>) => Promise<FakeCallResponse> {
	const seen = new Map<string, number>();
	return async (req) => {
		const n = seen.get(req.name) ?? 0;
		seen.set(req.name, n + 1);
		const user = JSON.stringify(req.args);
		let at = Date.now();
		const attempt = (durationMs: number, opts: Parameters<typeof fakeAttempt>[0] = {}) => {
			const built = fakeAttempt({ user, startedAtMs: at, durationMs, ...opts });
			at += durationMs + 20;
			return built;
		};
		const ok = (value: unknown, durationMs: number, usage: { inputTokens: number; outputTokens: number }) =>
			fakeOk(value, [attempt(durationMs, { output: JSON.stringify(value), usage })]);
		const response = ((): FakeCallResponse => {
			switch (req.name) {
				case "ExtractCheckpointKnowledge":
					return n === 0
						? ok(OFFLINE_OUTPUT.R2, 180, { inputTokens: 3_812, outputTokens: 412 })
						: ok(OFFLINE_OUTPUT.R6, 150, { inputTokens: 3_120, outputTokens: 188 });
				case "JudgeAdvisoryWithRationale":
					// The output is cut off mid-string: BAML cannot coerce it.
					return fakeFailure({ kind: "parse", message: "Failed to coerce", rawOutput: OFFLINE_OUTPUT.JUDGE_RAW }, [
						attempt(210, { output: OFFLINE_OUTPUT.JUDGE_RAW, usage: { inputTokens: 2_204, outputTokens: 380 } }),
					]);
				case "ContractProbe":
					// Attempt 1 (under R1): codex-lb answers 502 twice (BAML retry policy). Attempt 2 (under R5): ok.
					return n === 0
						? fakeFailure({ kind: "http", status: 502, rawResponse: "Bad Gateway" }, [
								attempt(60, { status: 502, usage: null }),
								attempt(55, { status: 502, usage: null }),
							])
						: ok({ ok: true }, 90, { inputTokens: 96, outputTokens: 12 });
				case "ExtractConfirmedCheckpointKnowledge":
					return ok(OFFLINE_OUTPUT.CONFIRMED, 160, { inputTokens: 6_410, outputTokens: 1_120 });
			}
		})();
		await Bun.sleep(Math.max(0, at - Date.now()));
		return response;
	};
}

/** The planned Jev answer for one decision, keyed by its subject. */
type JevPlan = Record<string, { answers: Record<string, unknown>; inputTokens: number }>;
const OFFLINE_JEV_PLAN: JevPlan = {
	A1: { answers: { justified: { type: "noul", noul: 0.91 } }, inputTokens: 1_412 },
	A2: { answers: { justified: { type: "noul", noul: 0.88 } }, inputTokens: 1_388 },
	A3: { answers: { justified: { type: "noul", noul: 0.52 } }, inputTokens: 1_436 },
	continue: {
		answers: {
			next: {
				type: "choice",
				choice: "retry_new_strategy",
				confidence: 0.64,
				probabilities: { retry_same_approach: 0.21, retry_new_strategy: 0.71, stop_blocked: 0.08 },
			},
		},
		inputTokens: 968,
	},
};

interface OfflineJevWire {
	fetch: typeof globalThis.fetch;
	/** Until restored, requests about `subject` get HTTP 503 (Pi retries once, then the decision abstains). */
	fail(subject: string): void;
	restore(): void;
}

/**
 * A scripted TypeSafe System One endpoint for Pi's real `typesafe` provider:
 * answers from the plan by the decision's subject (the advisory id in
 * `state.detail.finding_id`, or `continue` for the choice question).
 */
function offlineJevWire(plan: JevPlan): OfflineJevWire {
	const failing = new Set<string>();
	const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? "{}")) as {
			state?: { detail?: { finding_id?: string } };
			questions?: Record<string, unknown>;
		};
		const subject = body.state?.detail?.finding_id ?? (body.questions && "next" in body.questions ? "continue" : "");
		if (failing.has(subject)) return json({ detail: "upstream: Service Unavailable" }, 503);
		const entry = plan[subject];
		if (!entry) return json({ detail: `no planned answer for ${subject || "this request"}` }, 400);
		return json({
			model: JEV_SERVED_MODEL,
			answers: entry.answers,
			usage: { input_tokens: entry.inputTokens, output_tokens: Object.keys(entry.answers).length * 4 },
		});
	}) as unknown as typeof globalThis.fetch;
	return {
		fetch,
		fail: (subject) => void failing.add(subject),
		restore: () => failing.clear(),
	};
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ─── Mode setup ──────────────────────────────────────────────────────────────

interface ModeSetup {
	calls: KernelCallsConfig<DemoCalls>;
	/** Undefined: the kernel's default Pi decision engine over `piModels`. */
	decideEngine?: DecisionEngine;
	piModels: PiModelsSource;
	models: KernelModelsConfig;
	/** Offline: the wire answers HTTP 503 for a decision subject until restored. Live: no-op. */
	failDecision(subject: string): void;
	restoreDecisions(): void;
	/** Extra options that make a decision fail (offline: none, the wire fails it; live: a 1 ms budget). */
	failingDecision: { timeoutMs?: number };
	/** Extra options that make a call fail (offline: none, the fake engine fails it; live: a short budget). */
	failingCall: { timeoutMs?: number };
	/** Credential values to scan the database for (live only; never printed). */
	secrets: string[];
}

async function offlineSetup(): Promise<ModeSetup> {
	const piModels = fakePiModels();
	const engine = createFakeCallEngine<DemoCalls>({ functions: DEMO_FUNCTIONS, respond: offlineCallResponder() });
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		refreshOnCreate: false,
	});
	// Pi's real typesafe provider; the key stands in for TYPESAFE_API_KEY and is never sent anywhere.
	await runtime.setRuntimeApiKey("typesafe", "offline-demo-typesafe-key");
	const wire = offlineJevWire(OFFLINE_JEV_PLAN);
	return {
		calls: { engine },
		decideEngine: createPiDecisionEngine({ models: new ModelRegistry(runtime), fetch: wire.fetch }),
		piModels,
		models: { defaults: { call: FAKE_CALL_MODEL_REF, decide: DECIDE_MODEL }, prices: MODEL_PRICES },
		failDecision: wire.fail,
		restoreDecisions: wire.restore,
		failingDecision: {},
		failingCall: {},
		secrets: [],
	};
}

const DEFAULT_GC_ROOT = "/Users/Ford/workspace/harnesses/gamecube-model-nodes";

async function liveSetup(): Promise<ModeSetup> {
	const typesafeKey = loadTypesafeKey();
	const gcRoot = resolve(process.env.MODEL_NODES_GC_ROOT ?? DEFAULT_GC_ROOT);
	const clientDir = join(gcRoot, "apps/server/src/generated/baml_client");
	if (!existsSync(join(clientDir, "index.ts"))) {
		throw new Error(`no generated BAML client at ${clientDir} (set MODEL_NODES_GC_ROOT)`);
	}
	// One BAML copy: the module the generated client itself resolves, by absolute path.
	const bamlPath = Bun.resolveSync("@boundaryml/baml", clientDir);
	const baml = (await import(bamlPath)) as unknown as BamlRuntimeLike;
	const { b } = (await import(join(clientDir, "index.ts"))) as { b: unknown };
	const { getBamlFiles } = (await import(join(clientDir, "inlinedbaml.ts"))) as { getBamlFiles(): Record<string, string> };
	const manifest = (name: DemoFn, description: string): CallManifest => ({
		$schema: "agent-kernel/call-v1",
		name,
		description,
		model: CALL_MODEL_LIVE,
	});
	const engine: CallEngine<DemoCalls> = bamlEngine<DemoCalls>({
		client: b as DemoCalls,
		baml,
		sources: getBamlFiles(),
		manifests: {
			ContractProbe: manifest("ContractProbe", "Live-smoke target for the BAML adapter."),
			ExtractCheckpointKnowledge: manifest("ExtractCheckpointKnowledge", "Maps each llm_review finding to the note's justification."),
			ExtractConfirmedCheckpointKnowledge: manifest(
				"ExtractConfirmedCheckpointKnowledge",
				"Extracts reusable matching knowledge from a confirmed-good checkpoint.",
			),
			JudgeAdvisoryWithRationale: manifest("JudgeAdvisoryWithRationale", "Escalation judge for one advisory justification."),
		},
		retryPolicy: "KernelCallRetry",
	});
	const agentDir = resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"));
	let built: Promise<{ runtime: ModelRuntime; registry: ModelRegistry }> | undefined;
	const load = () =>
		(built ??= ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") }).then(
			(runtime) => ({ runtime, registry: new ModelRegistry(runtime) }),
		));
	return {
		calls: { engine, defaultTimeoutMs: 60_000 },
		piModels: { runtime: async () => (await load()).runtime, registry: async () => (await load()).registry },
		models: { defaults: { call: CALL_MODEL_LIVE, decide: DECIDE_MODEL }, prices: MODEL_PRICES },
		failDecision: () => {},
		restoreDecisions: () => {},
		failingDecision: { timeoutMs: 1 },
		failingCall: { timeoutMs: LIVE_SHORT_CALL_TIMEOUT_MS },
		secrets: [typesafeKey, ...modelsJsonKeys(join(agentDir, "models.json"))],
	};
}

/**
 * TYPESAFE_API_KEY for Pi's typesafe provider: the environment, else the
 * codecaine env file (read in-process; the value is never printed).
 */
function loadTypesafeKey(): string {
	const existing = process.env.TYPESAFE_API_KEY;
	if (existing) return existing;
	const file = process.env.CODECAINE_ENV_FILE ?? join(homedir(), ".config/codecaine/env");
	if (!existsSync(file)) throw new Error(`TYPESAFE_API_KEY is not set and ${file} does not exist`);
	for (const raw of readFileSync(file, "utf8").split("\n")) {
		const match = /^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*(.*)\s*$/.exec(raw);
		if (!match) continue;
		const value = match[1]!.replace(/^(['"])(.*)\1$/, "$2");
		if (value) {
			process.env.TYPESAFE_API_KEY = value;
			return value;
		}
	}
	throw new Error(`TYPESAFE_API_KEY is not set and ${file} does not define it`);
}

/** Literal provider api keys in a Pi models.json (scan targets only). */
function modelsJsonKeys(path: string): string[] {
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { providers?: Record<string, { apiKey?: unknown }> };
		return Object.values(parsed.providers ?? {})
			.map((provider) => provider.apiKey)
			.filter((key): key is string => typeof key === "string" && key.length >= 8 && !key.startsWith("!"));
	} catch {
		return [];
	}
}

// ─── The faux worker (Pi chat model + tools) ────────────────────────────────

const toolText = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

interface FauxWorker {
	faux: FauxProviderHandle;
	factory: ExtensionFactory;
	ctx: ExtensionContext;
}

/**
 * A scripted worker: Pi's faux provider plus harmless faux tools named like
 * the harness's (`read`, `bash`, `edit` replace Pi's built-ins). `codemode`
 * runs nested tools through `ctx.executeTool`: read, bash, and diff_function,
 * which itself runs bash (ids `<codemode>/1`, `/2`, `/3`, `/3/1`).
 */
function createFauxWorker(): FauxWorker {
	const faux = fauxProvider({
		provider: WORKER_PROVIDER,
		models: [{ id: WORKER_MODEL_ID, reasoning: true, contextWindow: 272_000, maxTokens: 32_000 }],
		// Streams like a (very fast) model, so each reply lands milliseconds after its request.
		tokensPerSecond: 4_000,
	});
	const factory: ExtensionFactory = (pi) => {
		pi.registerProvider(faux.provider);
		pi.registerTool({
			name: "read",
			label: "read",
			description: "Read a file.",
			parameters: Type.Object({ path: Type.String() }),
			async execute(_id, params) {
				return toolText(`${params.path}: 2,418 lines`);
			},
		});
		pi.registerTool({
			name: "bash",
			label: "bash",
			description: "Run a shell command.",
			parameters: Type.Object({ command: Type.String() }),
			async execute(_id, params) {
				if (params.command.startsWith("objdiff-cli")) return toolText('{"fuzzy_match_percent": 95.1}');
				if (params.command.includes("objdiff")) return toolText("fn_8003A1C4: 100.0% (exact)");
				return toolText("[1/1] mwcc d_a_player.cpp");
			},
		});
		pi.registerTool({
			name: "edit",
			label: "edit",
			description: "Replace text in a file.",
			parameters: Type.Object({ path: Type.String(), old: Type.String(), new: Type.String() }),
			async execute(_id, params) {
				return toolText(`1 replacement in ${params.path}`);
			},
		});
		pi.registerTool({
			name: "diff_function",
			label: "diff_function",
			description: "Diff one function against the original with objdiff.",
			parameters: Type.Object({ symbol: Type.String() }),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				await ctx.executeTool("bash", { command: `objdiff-cli diff -u d_a_player ${params.symbol} --format json` });
				return toolText(`${params.symbol}: 95.1%`);
			},
		});
		pi.registerTool({
			name: "codemode",
			label: "codemode",
			description: "Run a TypeScript script that calls the other tools through `tools.*`.",
			parameters: Type.Object({ code: Type.String() }),
			async execute(_id, _params, _signal, _onUpdate, ctx) {
				await ctx.executeTool("read", { path: "src/d/actor/d_a_player.cpp" });
				await ctx.executeTool("bash", { command: "ninja build/GZLE01/d_a_player.o" });
				await ctx.executeTool("diff_function", { symbol: "fn_8003A1C4" });
				return toolText("fn_8003A1C4: 95.1% (2 instructions differ in the mpActor compare)");
			},
		});
	};
	// Model resolution runs before extensions load, so the session is handed the faux model directly.
	const ctx = { model: faux.getModel() } as Partial<ExtensionContext> as ExtensionContext;
	return { faux, factory, ctx };
}

const toolUse = { stopReason: "toolUse" as const };

function scriptR1(faux: FauxProviderHandle): void {
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall(
				"codemode",
				{
					code: [
						'const src = await tools.read({ path: "src/d/actor/d_a_player.cpp" });',
						'await tools.bash({ command: "ninja build/GZLE01/d_a_player.o" });',
						'return tools.diff_function({ symbol: "fn_8003A1C4" });',
					].join("\n"),
				},
				{ id: "call_r1_codemode" },
			),
			toolUse,
		),
		fauxAssistantMessage(
			fauxToolCall(
				"edit",
				{ path: "src/d/actor/d_a_player.cpp", old: "if (this->mpActor != NULL) {", new: "if ((u32)this->mpActor != 0) {" },
				{ id: "call_r1_edit" },
			),
			toolUse,
		),
		fauxAssistantMessage([fauxText(R1_NOTE)]),
	]);
}

function scriptR5(faux: FauxProviderHandle): void {
	faux.setResponses([
		fauxAssistantMessage(
			fauxToolCall(
				"edit",
				{ path: "src/d/actor/d_a_player.cpp", old: "this->mpActor->execute();\n    switch (mState) {", new: "switch (mState) {" },
				{ id: "call_r5_edit" },
			),
			toolUse,
		),
		fauxAssistantMessage(
			fauxToolCall("bash", { command: "ninja && objdiff-cli diff -u d_a_player fn_8003A1C4" }, { id: "call_r5_bash" }),
			toolUse,
		),
		fauxAssistantMessage([fauxText(R5_NOTE)]),
	]);
}

function writeWorkerBundle(catalogRoot: string): void {
	const agentDir = join(catalogRoot, "worker");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		JSON.stringify({
			name: "worker",
			description: "GameCube decompilation worker (faux model, demo tools).",
			model: `${WORKER_PROVIDER}/${WORKER_MODEL_ID}`,
			coreTools: ["codemode", "read", "bash", "edit", "diff_function"],
			maxTurns: 8,
		}),
	);
	writeFileSync(
		join(agentDir, "prompt.json"),
		JSON.stringify({
			kind: "prompt",
			schemaVersion: "prompt-kit/v1",
			id: "modelNodesDemoWorker",
			nodes: [
				{
					type: "section",
					tag: "role",
					children: [
						{
							type: "paragraph",
							content: [
								"You are a GameCube decompilation worker. You turn one target function into C++ that mwcc compiles to the original instructions.",
							],
						},
					],
				},
				{
					type: "section",
					tag: "rules",
					children: [
						{
							type: "paragraph",
							content: [
								"Use codemode to batch reads, builds and objdiff checks. Record every review-lint advisory you keep in the checkpoint note, with the reason the original assembly needs it.",
							],
						},
					],
				},
			],
		}),
	);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export interface RunRealOptions {
	/** Output database; created fresh (an existing file is replaced). */
	dbPath: string;
	/** Real BAML/codex-lb calls and Jev decisions. Default false. */
	live?: boolean;
	/** Progress lines (ids, names, statuses; never prompts or secrets). Default: silent. */
	log?: (line: string) => void;
}

export interface NodeRunReport {
	kind: "call" | "decision";
	name: string;
	label: string | null;
	runId: string;
	parentRunId: string | null;
	status: string;
	attempt: number | null;
	requestedModel: string;
	servedModel: string | null;
	durationMs: number;
	attempts: number;
	inputTokens: number | null;
	outputTokens: number | null;
	costEstimate: number | null;
	error: string | null;
	chosen: string | null;
}

export interface RunRealResult {
	kernelId: string;
	containerId: string;
	live: boolean;
	doctor: DoctorReport;
	gate: GateResult;
	nodes: NodeRunReport[];
	/** Live only: rows holding a credential value or an unredacted bearer/authorization value. */
	secretHits: string[] | null;
}

/**
 * Runs the story into a fresh database at `dbPath` and returns the doctor
 * report, the gate result and one report line per node run. Throws when the
 * story cannot run (a node rejects unexpectedly, a spawn fails).
 */
export async function runRealDemo(opts: RunRealOptions): Promise<RunRealResult> {
	const live = opts.live ?? false;
	const log = opts.log ?? (() => {});
	const root = mkdtempSync(join(tmpdir(), "mn-real-"));
	removeDatabaseFiles(opts.dbPath);
	mkdirSync(dirname(opts.dbPath), { recursive: true });
	const handle = openKernelDatabase({ path: opts.dbPath });
	const kernels: Array<{ dispose(): void }> = [];
	try {
		await ensureKernelObservabilitySchema(handle.db);
		const setup = live ? await liveSetup() : await offlineSetup();
		const worker = createFauxWorker();
		const catalogRoot = join(root, "catalog");
		const workDir = join(root, "work");
		mkdirSync(workDir, { recursive: true });
		writeWorkerBundle(catalogRoot);

		const kernelConfig = {
			id: KERNEL_ID,
			db: handle.db,
			models: setup.models,
			calls: setup.calls,
			...(setup.decideEngine !== undefined && { decide: { engine: setup.decideEngine } }),
			nodes: { piModels: setup.piModels },
		};
		const kernel = createKernel<unknown, DemoCalls>({
			...kernelConfig,
			catalog: { roots: [catalogRoot] },
			sharedTools: () => [worker.factory],
			piSessionsDir: join(root, "pi-sessions"),
			piAgentDir: join(root, "pi-agent"),
			logger: quietLogger,
		});
		kernels.push(kernel);

		const container = await kernel.container({
			kind: CONTAINER_KIND,
			key: CONTAINER_KEY,
			label: "worker-job/fn_8003A1C4",
			workingDir: workDir,
			metadata: {
				app: "gamecube-decomp-harness",
				job: "worker-job/fn_8003A1C4",
				target: "fn_8003A1C4",
				unit: "d_a_player.cpp",
				demo: live ? "model-nodes-real (live)" : "model-nodes-real (offline)",
			},
		});
		await updateContainerStatus(handle.db, container.id, "active", { startedAt: new Date().toISOString() });
		const spawnOpts = { workingDir: workDir, containerId: container.id, sessionDir: workDir, reuseExistingSession: true };

		// ── Attempt 1: R1 (system) ──
		scriptR1(worker.faux);
		const r1 = await kernel.spawnAgent("worker", R1_PROMPT, worker.ctx, { ...spawnOpts, trigger: "system" });
		log(`spawn R1 ${r1.runId} (session ${r1.piSessionId})`);

		// R2: extraction from the R1 note (post-run).
		const r2 = await kernel.call("ExtractCheckpointKnowledge", [R1_NOTE, FINDING_REFS], {
			parentRunId: r1.runId,
			requestId: REQUEST.R2,
			displayLabel: "ExtractCheckpointKnowledge (R1)",
		});
		log(`call ExtractCheckpointKnowledge (R1): ${r2.advisories.length} advisories`);

		// S1: validate on R1.
		await kernel.step(
			"validate",
			{
				parentRunId: r1.runId,
				requestId: REQUEST.S1,
				attributes: { target: "fn_8003A1C4", unit: "d_a_player.cpp", checkpoint: "ckpt-1" },
				summarize: (r: { objdiff: number; exact: boolean }) => ({
					objdiff_percent: r.objdiff,
					exact: r.exact,
					micro_gates: "5/5",
					llm_review: ["A1 type_erasing_cast", "A2 stack_offset_local", "A3 type_erasing_cast"],
				}),
			},
			(span) => {
				span.addEvent("objdiff", { percent: 97.4 });
				span.addEvent("micro-gates", { passed: 5, total: 5 });
				span.addEvent("review_lint", { warnings: 3, llm_review: 3 });
				span.setAttributes({ objdiff_percent: 97.4, exact: false, micro_gates_passed: 5, micro_gates_total: 5, llm_review_warnings: 3 });
				return { objdiff: 97.4, exact: false };
			},
		);

		// Gate checkpoint-accepted, first pass: A2 fails (attempt 1: Jev 503 offline, a 1 ms budget live),
		// then the job is killed inside the justification:A3 step (the promise is abandoned; nothing more
		// is written).
		setup.failDecision("A2");
		let reachedA3!: () => void;
		const killedAtA3 = new Promise<void>((resolveReached) => {
			reachedA3 = resolveReached;
		});
		void kernel
			.gate(
				"checkpoint-accepted",
				{ parentRunId: r1.runId, requestId: REQUEST.GATE },
				gateChecks({
					a2: setup.failingDecision,
					justificationA3: () => {
						reachedA3();
						return new Promise<never>(() => {});
					},
				}),
			)
			.catch(() => {});
		await killedAtA3;
		setup.restoreDecisions();
		log("gate pass 1: killed in justification:A3");

		// The retried job runs the gate again with the same requestIds.
		const gate = await kernel.gate(
			"checkpoint-accepted",
			{ parentRunId: r1.runId, requestId: REQUEST.GATE },
			gateChecks({ justificationA3: () => ({ result: "pass", value: true }) }),
		);
		log(`gate pass 2: ${gate.verdict} (${gate.checks.map((c) => `${c.name}=${c.result}`).join(", ")})`);

		// Escalation of A3 to the BAML judge: fails.
		try {
			await kernel.call("JudgeAdvisoryWithRationale", [judgeCase("A3")], {
				parentRunId: r1.runId,
				requestId: REQUEST.FAILED_CALL,
				trigger: "judge",
				displayLabel: "JudgeAdvisoryWithRationale:A3",
				...setup.failingCall,
			});
			log("call JudgeAdvisoryWithRationale:A3: ok (expected a failure)");
		} catch (error) {
			if (!(error instanceof KernelCallError)) throw error;
			log(`call JudgeAdvisoryWithRationale:A3: failed (${error.failure.kind})`);
		}

		// R4: ContinueOrStop.
		const r4 = await kernel.decide(
			"ContinueOrStop",
			{
				note: { status: "partial", kept_advisories: 3, remaining_diff: "Tail call through mpActor is two instructions short." },
				validation: { objdiff_percent: 97.4, exact: false, micro_gates: "5/5" },
				gate: { name: "checkpoint-accepted", verdict: gate.verdict },
				attempt: 1,
				attempt_budget: 3,
			},
			{ questions: { next: CONTINUE_QUESTION }, parentRunId: r1.runId, requestId: REQUEST.R4, displayLabel: "ContinueOrStop" },
		);
		log(`decide ContinueOrStop: ${r4.chosen}`);

		// ContractProbe attempt 1 under R1: fails.
		try {
			await kernel.call("ContractProbe", [summaryText(R1_NOTE)], {
				parentRunId: r1.runId,
				requestId: REQUEST.SUMMARY,
				displayLabel: "ContractProbe (R1)",
				...setup.failingCall,
			});
			log("call ContractProbe (R1): ok (expected a failure)");
		} catch (error) {
			if (!(error instanceof KernelCallError)) throw error;
			log(`call ContractProbe (R1): failed (${error.failure.kind})`);
		}

		// ── Attempt 2: R5 (steer, same session) ──
		scriptR5(worker.faux);
		const r5 = await kernel.spawnAgent("worker", R5_PROMPT, worker.ctx, { ...spawnOpts, trigger: "steer" });
		log(`spawn R5 ${r5.runId} (session ${r5.piSessionId})`);

		// R6: extraction from the R5 note.
		await kernel.call("ExtractCheckpointKnowledge", [R5_NOTE, []], {
			parentRunId: r5.runId,
			requestId: REQUEST.R6,
			displayLabel: "ExtractCheckpointKnowledge (R5)",
		});
		log("call ExtractCheckpointKnowledge (R5): ok");

		// S2 validate, S3 stop (code decides; no model).
		await kernel.step(
			"validate",
			{
				parentRunId: r5.runId,
				requestId: REQUEST.S2,
				attributes: { target: "fn_8003A1C4", unit: "d_a_player.cpp", checkpoint: "ckpt-2" },
				summarize: (r: { objdiff: number; exact: boolean }) => ({
					objdiff_percent: r.objdiff,
					exact: r.exact,
					micro_gates: "5/5",
					llm_review: [],
				}),
			},
			(span) => {
				span.addEvent("objdiff", { percent: 100 });
				span.addEvent("micro-gates", { passed: 5, total: 5 });
				span.addEvent("review_lint", { warnings: 0, llm_review: 0 });
				span.setAttributes({ objdiff_percent: 100, exact: true, micro_gates_passed: 5, micro_gates_total: 5, llm_review_warnings: 0 });
				return { objdiff: 100, exact: true };
			},
		);
		await kernel.step("stop", { parentRunId: r5.runId, requestId: REQUEST.S3, summarize: (reason: string) => ({ reason }) }, () => "exact_match");

		// ContractProbe attempt 2 (same requestId) under R5: done.
		await kernel.call("ContractProbe", [summaryText(`${R1_NOTE}\n\n${R5_NOTE}`)], {
			parentRunId: r5.runId,
			requestId: REQUEST.SUMMARY,
			displayLabel: "ContractProbe (R5)",
		});
		log("call ContractProbe (R5): ok");

		// ── Settlement: ExtractConfirmedCheckpointKnowledge for ckpt-2 (post-run, parent R5) ──
		// Attempt 1: claimed by a process that dies mid-call (its engine never answers).
		const dying = createKernel<unknown, DemoCalls>({
			...kernelConfig,
			calls: { ...setup.calls, engine: neverAnswers(setup.calls.engine) },
			logger: quietLogger,
		});
		kernels.push(dying);
		let claimed!: () => void;
		const claimedAttempt1 = new Promise<void>((resolveClaimed) => {
			claimed = resolveClaimed;
		});
		void dying
			.call("ExtractConfirmedCheckpointKnowledge", [CONFIRMED_INPUT], {
				parentRunId: r5.runId,
				requestId: REQUEST.CONFIRMED,
				displayLabel: "ExtractConfirmedCheckpointKnowledge",
				timeoutMs: DYING_CALL_TIMEOUT_MS,
				onNodeStarted: () => claimed(),
			})
			.catch(() => {});
		await claimedAttempt1;
		log("call ExtractConfirmedCheckpointKnowledge attempt 1: claimed, process dies");

		// Attempt 2: the restarted process, 190 s later, recovers the stale claim and runs.
		const restarted: ModelNodes<DemoCalls> = createModelNodes(
			createModelNodeContext<DemoCalls>({
				kernelId: KERNEL_ID,
				db: handle.db,
				now: () => Date.now() + RESTART_CLOCK_SHIFT_MS,
				logger: quietLogger,
				models: setup.models,
				calls: setup.calls,
				...(setup.decideEngine !== undefined && { decide: { engine: setup.decideEngine } }),
				piModels: () => setup.piModels,
			}),
		);
		await restarted.call("ExtractConfirmedCheckpointKnowledge", [CONFIRMED_INPUT], {
			parentRunId: r5.runId,
			requestId: REQUEST.CONFIRMED,
			displayLabel: "ExtractConfirmedCheckpointKnowledge",
		});
		log("call ExtractConfirmedCheckpointKnowledge attempt 2: recovered and done");

		await updateContainerStatus(handle.db, container.id, "done", {
			endedAt: new Date(Date.now() + RESTART_CLOCK_SHIFT_MS).toISOString(),
		});
		await kernel.traceWriter.flush();
		const doctor = await kernel.doctor();
		const nodes = await nodeReports(handle.db);
		const secretHits = live ? scanSecrets(handle.db, setup.secrets) : null;
		return { kernelId: KERNEL_ID, containerId: container.id, live, doctor, gate, nodes, secretHits };
	} finally {
		for (const k of kernels) k.dispose();
		handle.close();
		rmSync(root, { recursive: true, force: true });
	}
}

/** The gate's checks in order; the first pass overrides A2's options and the A3 justification step. */
function gateChecks(opts: {
	a2?: { timeoutMs?: number };
	justificationA3: () => { result: "pass"; value: true } | Promise<never>;
}): GateCheckSpec[] {
	const justification = (id: AdvisoryId): GateCheckSpec => ({
		kind: "step",
		name: `justification:${id}`,
		run: () => (id === "A3" ? opts.justificationA3() : { result: "pass", value: true }),
	});
	const judge = (id: AdvisoryId, extra: { timeoutMs?: number } = {}): GateCheckSpec => ({
		kind: "decide",
		name: `JudgeAdvisory:${id}`,
		state: advisoryState(id),
		questions: { justified: id === "A3" ? STRICT_JUSTIFIED_QUESTION : JUSTIFIED_QUESTION },
		...extra,
	});
	return [
		{
			kind: "step",
			name: "objdiff",
			attributes: { floor_percent: 95 },
			run: (span) => {
				span.setAttributes({ previous_best_percent: 91.2 });
				return { result: "pass", value: 97.4, reason: "improved from 91.2%" };
			},
		},
		justification("A1"),
		judge("A1"),
		justification("A2"),
		judge("A2", opts.a2),
		justification("A3"),
		judge("A3"),
	];
}

function summaryText(note: string): string {
	return `Worker-run narrative for the knowledge DB:\n${note}`;
}

/** The engine of a process that dies mid-call: it claims, then never answers (it ignores the abort too). */
function neverAnswers(engine: CallEngine<DemoCalls>): CallEngine<DemoCalls> {
	return {
		engine: engine.engine,
		transportFor: (name) => engine.transportFor(name),
		functionNames: () => engine.functionNames(),
		manifest: (name) => engine.manifest(name),
		promptHash: (name) => engine.promptHash(name),
		invoke: () => new Promise<never>(() => {}),
	};
}

const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

// ─── Report ──────────────────────────────────────────────────────────────────

async function nodeReports(db: KernelDatabase): Promise<NodeRunReport[]> {
	const rows = db.all<{ type: string; event_data: string; timestamp: string }>(
		sql`SELECT type, event_data, timestamp FROM trace_events WHERE type IN ('call_start', 'call_end', 'decision_made') ORDER BY timestamp, event_id`,
	);
	const starts = new Map<string, CallStartData>();
	const decisions = new Map<string, DecisionMadeData>();
	const ends: CallEndData[] = [];
	for (const row of rows) {
		const data = JSON.parse(row.event_data) as CallStartData & CallEndData & DecisionMadeData;
		if (row.type === "call_start") starts.set(data.run_id, data);
		else if (row.type === "decision_made") decisions.set(data.run_id, data);
		else ends.push(data);
	}
	return ends.map((end) => {
		const start = starts.get(end.run_id);
		const decision = decisions.get(end.run_id);
		return {
			kind: end.node_kind,
			name: end.function_name,
			label: start?.display_label ?? null,
			runId: end.run_id,
			parentRunId: start?.parent_run_id ?? null,
			status: end.status,
			attempt: start?.attempt ?? null,
			requestedModel: start?.model ?? "",
			servedModel: end.resolved_model ?? decision?.model ?? null,
			durationMs: end.duration_ms,
			attempts: end.attempts,
			inputTokens: end.usage?.inputTokens ?? null,
			outputTokens: end.usage?.outputTokens ?? null,
			costEstimate: end.usage?.costEstimate ?? null,
			error: end.error ? `${end.error.kind}${end.error.http_status !== undefined ? ` ${end.error.http_status}` : ""}` : null,
			chosen: decision?.chosen ?? null,
		};
	});
}

/**
 * Rows (any table, any column) holding one of `secrets`, an unredacted
 * `Bearer <token>`, or an authorization / api-key header with a value other
 * than `<redacted>`. Returns "table:rowid" labels only.
 */
export function scanSecrets(db: KernelDatabase, secrets: readonly string[]): string[] {
	const patterns = [
		/bearer\s+(?!<redacted>)[A-Za-z0-9._~+/=-]{8,}/i,
		/"(?:authorization|x-api-key|api-key|openai-api-key)"\s*:\s*"(?!<redacted>")[^"]+"/i,
	];
	const hits: string[] = [];
	const tables = db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
	for (const { name } of tables) {
		for (const row of db.all<Record<string, unknown>>(sql`SELECT rowid AS __rowid, * FROM ${sql.identifier(name)}`)) {
			const text = Object.values(row)
				.map((value) => (value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(value)))
				.join("\n");
			if (secrets.some((secret) => secret.length > 0 && text.includes(secret)) || patterns.some((p) => p.test(text))) {
				hits.push(`${name}:${String(row.__rowid)}`);
			}
		}
	}
	return hits;
}

function formatReport(result: RunRealResult, dbPath: string): string {
	const lines = [
		`model-nodes real demo (${result.live ? "live" : "offline"})`,
		`db        ${dbPath}`,
		`kernel    ${result.kernelId}`,
		`container ${result.containerId}`,
		`doctor    ${result.doctor.ok ? "ok" : "VIOLATIONS"}`,
		`gate      checkpoint-accepted: ${result.gate.verdict}`,
		"",
		"node runs (status · served model · latency · tokens in/out · cost):",
	];
	for (const node of result.nodes) {
		const tokens = node.inputTokens !== null ? `${node.inputTokens}/${node.outputTokens ?? 0}` : "-";
		const cost = node.costEstimate !== null ? `$${node.costEstimate.toFixed(6)}` : "-";
		const extra = [node.chosen !== null ? `chosen ${node.chosen}` : "", node.error !== null ? `error ${node.error}` : ""]
			.filter(Boolean)
			.join(", ");
		lines.push(
			`  ${node.kind.padEnd(8)} ${(node.label ?? node.name).padEnd(38)} #${node.attempt ?? 1} ${node.status.padEnd(7)} ${String(node.servedModel ?? node.requestedModel).padEnd(26)} ${`${node.durationMs} ms`.padStart(9)}  ${tokens.padEnd(11)} ${cost.padEnd(10)} ${extra}`,
		);
	}
	if (result.secretHits !== null) {
		lines.push("", `secret scan: ${result.secretHits.length} hit(s)${result.secretHits.length > 0 ? ` in ${result.secretHits.join(", ")}` : ""}`);
	}
	if (!result.doctor.ok) lines.push("", formatDoctorReport(result.doctor, dbPath));
	return lines.join("\n");
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function removeDatabaseFiles(path: string): void {
	for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${path}${suffix}`, { force: true });
}

/** The nearest ancestor directory holding `.git`, if any. */
function gitCheckoutOf(path: string): string | undefined {
	let dir = resolve(path);
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

function parseArgs(argv: string[]): { dbPath: string } {
	let dbPath = join("/tmp/model-nodes-real", `${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--db") {
			const value = argv[++i];
			if (value === undefined) throw new Error("--db needs a value");
			dbPath = resolve(value);
		} else throw new Error(`unknown flag ${flag}`);
	}
	const checkout = gitCheckoutOf(dirname(dbPath));
	if (checkout !== undefined) throw new Error(`--db ${dbPath} is inside the git checkout ${checkout}; use a path outside it`);
	if (existsSync(dbPath) && statSync(dbPath).isDirectory()) throw new Error(`--db ${dbPath} is a directory`);
	return { dbPath };
}

async function main(): Promise<void> {
	const { dbPath } = parseArgs(process.argv.slice(2));
	const live = process.env.MODEL_NODES_LIVE === "1";
	const result = await runRealDemo({ dbPath, live, log: (line) => console.log(`· ${line}`) });
	console.log(`\n${formatReport(result, dbPath)}`);
	const failed = !result.doctor.ok || (result.secretHits?.length ?? 0) > 0;
	// Abandoned attempts (the killed gate pass, the dead call) leave promises that never settle.
	process.exit(failed ? 1 : 0);
}

if (import.meta.main) await main();
