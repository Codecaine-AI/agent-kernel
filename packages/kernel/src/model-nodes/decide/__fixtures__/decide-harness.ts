/**
 * Shared helpers for the decide suites: scripted DecisionEngines, question
 * builders, row counts, a doctor check, a whole-database secret scan, and
 * Pi's real typesafe provider behind a recording fetch.
 */
import { expect } from "bun:test";
import { sql } from "drizzle-orm";
import type { KernelDatabase } from "@agent-kernel/db";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

import { runTraceDoctor } from "../../../doctor";
import type {
	BoolQuestion,
	ChoiceQuestion,
	DecisionEngine,
	EngineAnswer,
	EngineRequest,
	EngineResult,
	ScoreQuestion,
} from "../../types";

export const FAKE_REF = "fake-decide/fake-jev";

export function boolQ(overrides: Partial<BoolQuestion> = {}): BoolQuestion {
	return {
		type: "bool",
		instructions: "Is the cast justified by the surrounding code?",
		criteria: { true: "justified", false: "not justified" },
		...overrides,
	};
}

export function choiceQ(labels: string[] = ["accept", "revise", "escalate"], overrides: Partial<ChoiceQuestion> = {}): ChoiceQuestion {
	return {
		type: "choice",
		instructions: "What should happen next?",
		criteria: Object.fromEntries(labels.map((label) => [label, `do ${label}`])),
		...overrides,
	};
}

export function scoreQ(levels = 4, overrides: Partial<ScoreQuestion> = {}): ScoreQuestion {
	return {
		type: "score",
		instructions: "Rate the justification.",
		criteria: Array.from({ length: levels }, (_, i) => `level ${i}`),
		...overrides,
	};
}

export interface ScriptedEngine extends DecisionEngine {
	requests: EngineRequest[];
}

/** A DecisionEngine answering from `script` (default: every answer omitted → ok with no answers). */
export function scriptedEngine(
	script: (request: EngineRequest) => Partial<EngineResult> | Promise<Partial<EngineResult>>,
): ScriptedEngine {
	const requests: EngineRequest[] = [];
	return {
		requests,
		async classify(request) {
			requests.push(request);
			const startedAtMs = Date.now();
			const partial = await script(request);
			return {
				ok: true,
				engine: "jev",
				api: "typesafe-system-one",
				provider: "fake-decide",
				requestedModel: request.model,
				resolvedModel: request.model,
				answers: {},
				latencyMs: 3,
				attempts: 1,
				startedAtMs,
				secrets: [],
				...partial,
			};
		},
	};
}

/** An engine that returns `answers` for every request. */
export function answeringEngine(answers: Record<string, EngineAnswer>, extra: Partial<EngineResult> = {}): ScriptedEngine {
	return scriptedEngine(() => ({ answers, ...extra }));
}

export function countRows(db: KernelDatabase, table: string): number {
	const [row] = db.all<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)}`);
	if (typeof row?.n !== "number") throw new Error(`count(${table}) returned no number`);
	return row.n;
}

export async function expectDoctorOk(db: KernelDatabase): Promise<void> {
	const report = await runTraceDoctor(db);
	expect(report.violations).toEqual([]);
	expect(report.ok).toBe(true);
}

/** Rows of trace_events.event_data and trace_blobs.data that contain `value` (S4 scan). */
export function rowsContaining(db: KernelDatabase, value: string): string[] {
	const hits: string[] = [];
	for (const row of db.all<{ id: string; data: string }>(sql`SELECT event_id AS id, event_data AS data FROM trace_events`)) {
		if (String(row.data).includes(value)) hits.push(`event ${row.id}`);
	}
	for (const row of db.all<{ id: string; data: Uint8Array | string }>(sql`SELECT hash AS id, data FROM trace_blobs`)) {
		const text = typeof row.data === "string" ? row.data : Buffer.from(row.data).toString("utf8");
		if (text.includes(value)) hits.push(`blob ${row.id}`);
	}
	return hits;
}

// ── Pi's real typesafe provider behind an injected fetch ──────────────────────

export const TS_KEY = "ts-test-key-0123456789";
export const SYSTEM_ONE_REPLY = {
	model: "jev-1.13.0",
	answers: {
		justified: { type: "noul", noul: 0.92 },
		next_action: {
			type: "choice",
			choice: "accept",
			confidence: 0.69,
			probabilities: { other: 0, revise: 0.07, escalate: 0.16, accept: 0.77 },
		},
		quality: {
			type: "score",
			score: 3,
			confidence: 1,
			legend: { "0": "none", "1": "vague", "2": "plausible", "3": "concrete" },
			probabilities: { "0": 0, "1": 0, "2": 0, "3": 1 },
		},
	},
	usage: { input_tokens: 755, output_tokens: 80 },
};

export function wire(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

export interface Sent {
	url: string;
	body: Record<string, unknown>;
	auth: string | null;
}

/** A base fetch that records what Pi sends and answers with `reply(n, sent)`. */
export function wireFetch(reply: (n: number, sent: Sent) => Response | Promise<Response>) {
	const sent: Sent[] = [];
	const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const request: Sent = {
			url: String(input instanceof Request ? input.url : input),
			body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
			auth: new Headers(init?.headers).get("authorization"),
		};
		sent.push(request);
		return reply(sent.length - 1, request);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, sent };
}

export async function testRuntime(): Promise<ModelRuntime> {
	return ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
}

/** Pi's real typesafe provider with a runtime api key (stands in for auth.json / TYPESAFE_API_KEY). */
export async function typesafeRegistry(key = TS_KEY): Promise<ModelRegistry> {
	const runtime = await testRuntime();
	await runtime.setRuntimeApiKey("typesafe", key);
	return new ModelRegistry(runtime);
}
