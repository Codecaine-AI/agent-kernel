/**
 * S4 for calls (plan §1.3, §4.7): the credential reaches the engine, and no
 * persisted row or blob holds its value, even when the engine echoes it
 * unredacted in a request, a JSON body, an SSE frame, raw output, an HTTP
 * error, or a value; short credentials are refused before any request; and
 * credentials the Pi transport reads from the actual outbound headers after
 * preflight are scrubbed by the kernel's second pass. Error summaries are
 * constants: neither Pi's auth diagnostics nor a provider's finish reason is
 * persisted as text.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getAgentRun, getTraceBlob, getTraceEventsForRun, type KernelDatabase } from "@agent-kernel/db";
import type { CallEndData, CallStartData, PiTurnEndData } from "@agent-kernel/protocol";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";

import { createTempKernelDb, disableNetwork, type TempKernelDb } from "../__fixtures__/temp-kernel";
import { createModelNodeContext, type ModelNodeLogger } from "../context";
import { CALLBACK_THREW, EXECUTION_THREW, REQUEST_MISMATCH_MESSAGE } from "../node-run";
import { ROUTE_FAILURE_MESSAGES, SHORT_CREDENTIAL_MESSAGE } from "../pi-models";
import { KernelCallError, KernelNodeError, type FnName, type PiTransport } from "../types";
import { createCall } from "./index";
import { createCallKit, type CallKit, type CallKitOptions } from "./__fixtures__/call-kit";
import {
	createFakeCallEngine,
	fakeAttempt,
	fakeFailure,
	fakeOk,
	fakePiModels,
	FAKE_CALL_MODEL_REF,
	type FakeCallResponse,
	type FakePiModels,
} from "./__fixtures__/fake-call-engine";

let networkStub: typeof fetch;
let restoreFetch: () => void;
beforeAll(() => {
	restoreFetch = disableNetwork();
	networkStub = globalThis.fetch;
});
afterAll(() => {
	restoreFetch();
});

const kits: CallKit[] = [];
const temps: TempKernelDb[] = [];
async function kit(opts: CallKitOptions): Promise<CallKit> {
	const created = await createCallKit(opts);
	kits.push(created);
	return created;
}
afterEach(() => {
	globalThis.fetch = networkStub;
	for (const created of kits.splice(0)) created.cleanup();
	for (const temp of temps.splice(0)) temp.cleanup();
});

const API_KEY = "sk-live-call-key-QWERTYUIOP";
const HEADER_TOKEN = "hdr-custom-token-ZXCVBNM";
const ROTATED_KEY = "sk-rotated-call-key-ASDFGHJKL";
const STORE_CREDENTIAL = "sk-store-credential-POIUYTREWQ";
const FINISH_SENTINEL = "FINISH-REASON-MODEL-TEXT-SENTINEL";

/** A credential store whose read fails with a message that quotes a credential (Pi passes it through). */
class UnreadableCredentialStore extends InMemoryCredentialStore {
	override async read(): Promise<undefined> {
		throw new Error(`credential store unreadable near ${STORE_CREDENTIAL}`);
	}
}

/** Every persisted trace row and blob, as text. */
function persisted(db: KernelDatabase): string[] {
	const rows = [
		...db.all<{ event_data: unknown }>(sql`SELECT event_data FROM trace_events`).map((r) => String(r.event_data)),
		...db.all<{ data: Uint8Array }>(sql`SELECT data FROM trace_blobs`).map((r) => Buffer.from(r.data).toString("utf8")),
		...db.all(sql`SELECT * FROM agent_runs`).map((r) => JSON.stringify(r)),
		...db.all(sql`SELECT * FROM pi_agent_sessions`).map((r) => JSON.stringify(r)),
	];
	expect(rows.length).toBeGreaterThan(0);
	return rows;
}

function hits(db: KernelDatabase, values: readonly string[]): string[] {
	const rows = persisted(db);
	return values.filter((value) => rows.some((row) => row.includes(value)));
}

/**
 * The call-input blobs of a run: call_start's (the claim's placeholder) and
 * call_end's (the final input; null when call_end names none).
 */
async function storedInputs(db: KernelDatabase, runId: string): Promise<{ start: unknown; end: unknown }> {
	const [start] = await getTraceEventsForRun(db, runId, ["call_start"]);
	const [end] = await getTraceEventsForRun(db, runId, ["call_end"]);
	const read = async (hash: string | undefined) => {
		const blob = hash ? await getTraceBlob(db, hash) : null;
		return blob ? (JSON.parse(Buffer.from(blob.data).toString("utf8")) as unknown) : null;
	};
	return {
		start: await read((start?.eventData as CallStartData | undefined)?.input_blob_hash),
		end: await read((end?.eventData as CallEndData | undefined)?.input_blob_hash),
	};
}

async function rejection(promise: Promise<unknown>): Promise<KernelCallError> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(KernelCallError);
		return error as KernelCallError;
	}
	throw new Error("expected a KernelCallError");
}

/** An attempt as a careless engine would report it: the credentials echoed, nothing redacted. */
function leakyAttempt(secret: string, output: string) {
	return fakeAttempt({
		headers: { authorization: `Bearer ${secret}`, "x-custom-token": HEADER_TOKEN, "content-type": "application/json" },
		requestBody: { model: "fake-model", input: [{ role: "user", content: `key=${secret}` }], echo: secret },
		output,
	});
}

describe("call secrets (S4)", () => {
	test("the api key reaches the engine and no row", async () => {
		const responses: FakeCallResponse[] = [
			// ok: echoes in request headers and body, the JSON response body, an SSE frame, and the value.
			{
				ok: true,
				value: { kept: [API_KEY], reason: HEADER_TOKEN },
				rawText: `{"kept":["${API_KEY}"]}`,
				attempts: [
					leakyAttempt(API_KEY, `{"kept":["${API_KEY}"]}`),
					{ ...leakyAttempt(API_KEY, ""), selected: false, response: { sse: [{ delta: `token ${HEADER_TOKEN}` }] } },
				],
			},
			// parse failure: the raw model output and the engine's message echo the key.
			fakeFailure({ kind: "parse", message: `Failed to coerce ${API_KEY}`, rawOutput: `not json ${API_KEY}` }, [
				leakyAttempt(API_KEY, `not json ${API_KEY}`),
			]),
			// HTTP failure: the provider's error body echoes the key.
			fakeFailure({ kind: "http", status: 401, rawResponse: `{"error":"bad key ${API_KEY}"}` }, [
				{ ...leakyAttempt(API_KEY, ""), status: 401, response: { status: 401, headers: {}, body: { error: `bad key ${API_KEY}` } } },
			]),
			// Other failure: the engine's error message echoes the custom header.
			fakeFailure({ kind: "other", message: `connect failed with ${HEADER_TOKEN}` }, [], `partial ${HEADER_TOKEN}`),
		];
		const k = await kit({
			pi: { apiKey: API_KEY, headers: { "x-custom-token": HEADER_TOKEN } },
			respond: (_req, index) => responses[index]!,
		});

		await k.call("Extract", [`note mentioning ${API_KEY}`]);
		const failures = [
			await rejection(k.call("Extract", ["note"])),
			await rejection(k.call("Extract", ["note"])),
			await rejection(k.call("Extract", ["note"])),
		];

		const [req] = k.engine.invocations;
		expect(req?.route.apiKey).toBe(API_KEY);
		expect(req?.route.headers["x-custom-token"]).toBe(HEADER_TOKEN);
		expect(req?.secrets).toEqual(expect.arrayContaining([API_KEY, HEADER_TOKEN]));
		expect(failures.map((e) => e.failure.kind)).toEqual(["parse", "http", "other"]);
		expect(JSON.stringify(failures.map((e) => [e.message, e.failure]))).not.toContain(API_KEY);
		expect(JSON.stringify(failures.map((e) => [e.message, e.failure]))).not.toContain(HEADER_TOKEN);
		expect(hits(k.temp.db, [API_KEY, HEADER_TOKEN])).toEqual([]);
	});

	const authFailures: Array<{ name: string; pi: () => CallKitOptions["pi"]; message: string }> = [
		{
			name: "a credential store error that quotes a credential",
			pi: () => ({ apiKey: null, credentials: new UnreadableCredentialStore() }),
			message: ROUTE_FAILURE_MESSAGES["auth-failed"],
		},
		{
			name: "no credential for a provider that requires one",
			pi: () => ({ apiKey: null, authHeader: true }),
			message: ROUTE_FAILURE_MESSAGES["missing-credential"],
		},
	];
	for (const c of authFailures) {
		test(`an auth failure (${c.name}) persists only a constant route summary`, async () => {
			const k = await kit({ pi: c.pi() });
			const error = await rejection(k.call("Extract", ["note"]));
			expect(error.failure).toEqual({ kind: "route", message: c.message });
			expect(k.engine.invocations).toHaveLength(0);
			const [end] = await getTraceEventsForRun(k.temp.db, error.runId, ["call_end"]);
			expect((end?.eventData as CallEndData).error).toEqual({ kind: "route", message: c.message });
			expect(hits(k.temp.db, [STORE_CREDENTIAL])).toEqual([]);
		});
	}

	test("a provider finish reason is persisted only through a fixed vocabulary", async () => {
		const cases = [
			{ finishReason: `stopped by ${FINISH_SENTINEL}`, message: "model stopped: unexpected finish reason", stop: "unexpected" },
			{ finishReason: "MAX_TOKENS", message: "model stopped: length", stop: "length" },
		];
		const k = await kit({
			respond: (_req, index) =>
				fakeFailure({ kind: "finish_reason", finishReason: cases[index]!.finishReason, rawOutput: "truncated {" }, [
					fakeAttempt({ output: "truncated {" }),
				]),
		});
		for (const c of cases) {
			const error = await rejection(k.call("Extract", ["note"]));
			const [end] = await getTraceEventsForRun(k.temp.db, error.runId, ["call_end"]);
			const [turnEnd] = await getTraceEventsForRun(k.temp.db, error.runId, ["pi_turn_end"]);
			expect({
				error: (end?.eventData as CallEndData).error,
				stop: (turnEnd?.eventData as PiTurnEndData).stop_reason,
			}).toEqual({ error: { kind: "finish_reason", message: c.message }, stop: c.stop });
		}
		expect(hits(k.temp.db, [FINISH_SENTINEL])).toEqual([]);
	});

	const shortCredentials: Array<{ name: string; pi: CallKitOptions["pi"]; value: string }> = [
		{ name: "api key", pi: { apiKey: "qwrt12" }, value: "qwrt12" },
		{ name: "custom auth header", pi: { apiKey: API_KEY, headers: { "x-api-key": "zyx9" } }, value: "zyx9" },
	];
	for (const c of shortCredentials) {
		test(`a short call credential (${c.name}) is refused before invoke`, async () => {
			const k = await kit({ pi: c.pi });
			// The refused credential also appears in the arguments; the route never yields a set to scrub it with.
			const error = await rejection(k.call("Extract", [`note with ${c.value} inside`]));
			expect(error.failure).toEqual({ kind: "route", message: SHORT_CREDENTIAL_MESSAGE });
			expect(k.engine.invocations).toHaveLength(0);
			expect((await getAgentRun(k.temp.db, error.runId))?.status).toBe("error");
			expect(hits(k.temp.db, [c.value])).toEqual([]);
			expect(await storedInputs(k.temp.db, error.runId)).toEqual({ start: { omitted: expect.any(String) }, end: null });
		});
	}

	test("credentials the Pi transport reads from outbound headers after preflight are scrubbed by the kernel", async () => {
		const sent: string[] = [];
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			const bearer = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
			sent.push(bearer);
			return new Response(JSON.stringify({ error: { message: `rejected ${bearer}` } }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;
		let transportSecrets: string[] = [];
		let placeholder: unknown;
		const k: CallKit = await kit({
			transport: "pi",
			pi: { apiKey: API_KEY },
			async respond(req) {
				placeholder = (await storedInputs(k.temp.db, req.tags.runId!)).start;
				// The credential changes between route resolution and the send.
				await k.pi.rotateApiKey(ROTATED_KEY);
				const out = await req.transport.complete({ messages: [{ role: "user", text: "note" }] });
				transportSecrets = out.secrets;
				// An engine that keeps the raw key it saw: only the outbound set can scrub it.
				return {
					ok: false,
					failure: { kind: "other", message: `rejected ${ROTATED_KEY}` },
					rawText: `raw ${ROTATED_KEY}`,
					attempts: [out.attempt, leakyAttempt(ROTATED_KEY, `echo ${ROTATED_KEY}`)],
				};
			},
		});
		// The rotated credential is in the arguments too, before anyone knows it is a credential.
		const error = await rejection(k.call("Extract", [`note quoting ${ROTATED_KEY}`]));
		expect(sent).toEqual([ROTATED_KEY]);
		expect(k.engine.invocations[0]?.secrets).not.toContain(ROTATED_KEY);
		expect(transportSecrets).toContain(ROTATED_KEY);
		expect(JSON.stringify(error.failure)).not.toContain(ROTATED_KEY);
		expect(hits(k.temp.db, [ROTATED_KEY, API_KEY])).toEqual([]);
		// A "pi" transport resolves credentials again at send time: its placeholder holds no arguments;
		// the final input is redacted with the complete set, the rotated credential included.
		expect(placeholder).toEqual({ pending: true });
		expect(await storedInputs(k.temp.db, error.runId)).toEqual({
			start: { pending: true },
			end: ["note quoting <redacted>"],
		});
	});

	/** A kernel whose one generated function is named `name` (a caller mistake the kernel must still contain). */
	async function leakyNameKernel(name: string, respond: (req: { transport: PiTransport }, index: number) => Promise<FakeCallResponse> | FakeCallResponse, pi: FakePiModels) {
		type LeakyClient = Record<string, (note: string, opts?: object) => Promise<unknown>>;
		const logs: Array<{ message: string; data?: Record<string, unknown> }> = [];
		const capture = (message: string, data?: Record<string, unknown>) => logs.push({ message, ...(data && { data }) });
		const logger: ModelNodeLogger = { debug: capture, info: capture, warn: capture, error: capture };
		const engine = createFakeCallEngine<LeakyClient>({
			functions: [name as FnName<LeakyClient>],
			// A real engine's prompt hash is a digest (the fake's default embeds the name).
			promptHash: () => "baml1-0123abcd",
			transport: "pi",
			respond,
		});
		const temp = await createTempKernelDb();
		temps.push(temp);
		const call = createCall(
			createModelNodeContext<LeakyClient>({
				kernelId: temp.kernelId,
				db: temp.db,
				logger,
				calls: { engine },
				models: { defaults: { call: FAKE_CALL_MODEL_REF } },
				piModels: () => pi,
			}),
		);
		const run = (opts: { note?: string; requestId?: string } = {}): Promise<unknown> =>
			call(name as FnName<LeakyClient>, [opts.note ?? "note"], {
				containerId: temp.containerId,
				...(opts.requestId !== undefined && { requestId: opts.requestId }),
			});
		return { temp, engine, logs, run };
	}

	const okThenParseFailure = (index: number): FakeCallResponse =>
		index === 0
			? fakeOk({ kept: [] })
			: fakeFailure({ kind: "parse", message: "Failed to coerce", rawOutput: "not json" }, [fakeAttempt()]);

	test("a function name holding the route credential is scrubbed from every row and log line", async () => {
		const name = `Extract_${API_KEY}`;
		const k = await leakyNameKernel(name, (_req, index) => okThenParseFailure(index), fakePiModels({ apiKey: API_KEY }));
		await k.run({ requestId: "extract-1" });
		expect((await rejection(k.run())).failure.kind).toBe("parse");
		// A replay and a mismatched reuse of the requestId log the name too.
		await k.run({ requestId: "extract-1" });
		await expect(k.run({ requestId: "extract-1", note: "other" })).rejects.toThrow(REQUEST_MISMATCH_MESSAGE);
		// The engine still ran the real function; only what the kernel records is scrubbed.
		expect(k.engine.invocations.map((req) => String(req.name))).toEqual([name, name]);
		expect(k.logs.map((l) => l.message)).toEqual(
			expect.arrayContaining([
				"model call done",
				"model call failed",
				"model node replayed",
				"model node requestId reused for a different request",
			]),
		);
		expect(JSON.stringify(k.logs)).not.toContain(API_KEY);
		expect(hits(k.temp.db, [API_KEY])).toEqual([]);
	});

	test("a function name holding a credential first seen at send time is scrubbed from call_end and the completion logs", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: { message: "rejected" } }), {
				status: 400,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;
		const name = `Extract_${ROTATED_KEY}`;
		const pi = fakePiModels({ apiKey: API_KEY });
		const k = await leakyNameKernel(
			name,
			async (req, index) => {
				// The credential rotates after preflight; the transport captures it from the outbound header.
				// Rotating back keeps it out of the next call's preflight set.
				await pi.rotateApiKey(ROTATED_KEY);
				await req.transport.complete({ messages: [{ role: "user", text: "note" }] });
				await pi.rotateApiKey(API_KEY);
				return okThenParseFailure(index);
			},
			pi,
		);
		await k.run();
		await rejection(k.run());
		// call_start and the session row hold the name as claimed: the identifier contract (no credential in names).
		const ends = (await Promise.all(k.engine.invocations.map((req) => getTraceEventsForRun(k.temp.db, req.tags.runId!, ["call_end"])))).flat();
		expect(ends.map((e) => [(e.eventData as CallEndData).status, (e.eventData as CallEndData).function_name])).toEqual([
			["ok", "Extract_<redacted>"],
			["error", "Extract_<redacted>"],
		]);
		const completionLogs = k.logs.filter((l) => l.message === "model call done" || l.message === "model call failed");
		expect(completionLogs).toHaveLength(2);
		expect(JSON.stringify(completionLogs)).not.toContain(ROTATED_KEY);
	});

	/** A logger that keeps every line. */
	function captureLogs() {
		const lines: Array<{ message: string; data?: Record<string, unknown> }> = [];
		const capture = (message: string, data?: Record<string, unknown>) => lines.push({ message, ...(data && { data }) });
		const logger: ModelNodeLogger = { debug: capture, info: capture, warn: capture, error: capture };
		return { lines, logger };
	}

	test("claim metadata holding the route credential is scrubbed from every row and log line; identity stays raw", async () => {
		const { lines, logger } = captureLogs();
		const k = await kit({
			pi: { apiKey: API_KEY },
			logger,
			models: { aliases: { [`alias-${API_KEY}`]: "fake/fake-model" } },
		});
		const opts = {
			requestId: `req-${API_KEY}`,
			displayLabel: `label ${API_KEY}`,
			parentToolUseId: `tool-${API_KEY}`,
			model: `alias-${API_KEY}`,
		};
		await k.call("Extract", ["note"], opts);
		// The same raw requestId replays (identity is unscrubbed); different arguments are a mismatch.
		await k.call("Extract", ["note"], opts);
		const mismatch = await k.call("Extract", ["other note"], opts).catch((error: unknown) => error);
		expect(mismatch).toBeInstanceOf(KernelNodeError);
		expect((mismatch as KernelNodeError).message).toBe(REQUEST_MISMATCH_MESSAGE);
		expect(k.engine.invocations).toHaveLength(1);

		const [start] = await getTraceEventsForRun(k.temp.db, k.engine.invocations[0]!.tags.runId!, ["call_start"]);
		expect(start?.eventData).toMatchObject({
			request_id: "req-<redacted>",
			display_label: "label <redacted>",
			parent_tool_use_id: "tool-<redacted>",
			model_alias: "alias-<redacted>",
			model: "fake/fake-model",
		});
		expect(lines.map((l) => l.message)).toEqual(
			expect.arrayContaining(["model call done", "model node replayed", "model node requestId reused for a different request"]),
		);
		expect(JSON.stringify(lines)).not.toContain(API_KEY);
		expect(hits(k.temp.db, [API_KEY])).toEqual([]);
	});

	const thrownErrors: Array<{ name: string; message: string; throwIn: "callback" | "engine" }> = [
		{ name: "an onNodeStarted callback", message: CALLBACK_THREW, throwIn: "callback" },
		{ name: "the engine (a programmer error)", message: EXECUTION_THREW, throwIn: "engine" },
	];
	for (const c of thrownErrors) {
		test(`an error thrown by ${c.name} is recorded and logged as a fixed classification`, async () => {
			const sentinel = "THROWN-ERROR-SENTINEL-1234";
			const thrown = Object.assign(new Error(`message ${sentinel}`), { name: `Name${sentinel}` });
			const { lines, logger } = captureLogs();
			let runId = "";
			const k = await kit({
				logger,
				respond(req) {
					if (c.throwIn === "engine") throw thrown;
					return fakeFailure({ kind: "other", message: "unused" });
				},
			});
			const rejected = await k
				.call("Extract", ["note"], {
					onNodeStarted(ids) {
						runId = ids.runId;
						if (c.throwIn === "callback") throw thrown;
					},
				})
				.catch((error: unknown) => error);
			// The caller still receives its own error, once the error completion committed.
			expect(rejected).toBe(thrown);
			expect((await getAgentRun(k.temp.db, runId))?.status).toBe("error");
			const [end] = await getTraceEventsForRun(k.temp.db, runId, ["call_end"]);
			expect((end?.eventData as CallEndData).error).toEqual({ kind: "internal", message: c.message });
			expect(lines.find((l) => l.message === "model node execute threw")?.data).toMatchObject({ error: c.message });
			expect(JSON.stringify(lines)).not.toContain(sentinel);
			expect(hits(k.temp.db, [sentinel])).toEqual([]);
		});
	}
});
