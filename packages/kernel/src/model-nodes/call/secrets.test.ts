/**
 * S4 for calls (plan §1.3, §4.7): the credential reaches the engine, and no
 * persisted row or blob holds its value, even when the engine echoes it
 * unredacted in a request, a JSON body, an SSE frame, raw output, an HTTP
 * error, or a value; short credentials are refused before any request; and
 * credentials the Pi transport reads from the actual outbound headers after
 * preflight are scrubbed by the kernel's second pass.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getAgentRun, type KernelDatabase } from "@agent-kernel/db";

import { disableNetwork } from "../__fixtures__/temp-kernel";
import { SHORT_CREDENTIAL_MESSAGE } from "../pi-models";
import { KernelCallError } from "../types";
import { createCallKit, type CallKit, type CallKitOptions } from "./__fixtures__/call-kit";
import { fakeAttempt, fakeFailure, type FakeCallResponse } from "./__fixtures__/fake-call-engine";

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
async function kit(opts: CallKitOptions): Promise<CallKit> {
	const created = await createCallKit(opts);
	kits.push(created);
	return created;
}
afterEach(() => {
	globalThis.fetch = networkStub;
	for (const created of kits.splice(0)) created.cleanup();
});

const API_KEY = "sk-live-call-key-QWERTYUIOP";
const HEADER_TOKEN = "hdr-custom-token-ZXCVBNM";
const ROTATED_KEY = "sk-rotated-call-key-ASDFGHJKL";

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

	const shortCredentials: Array<{ name: string; pi: CallKitOptions["pi"]; value: string }> = [
		{ name: "api key", pi: { apiKey: "qwrt12" }, value: "qwrt12" },
		{ name: "custom auth header", pi: { apiKey: API_KEY, headers: { "x-api-key": "zyx9" } }, value: "zyx9" },
	];
	for (const c of shortCredentials) {
		test(`a short call credential (${c.name}) is refused before invoke`, async () => {
			const k = await kit({ pi: c.pi });
			const error = await rejection(k.call("Extract", ["note"]));
			expect(error.failure).toEqual({ kind: "route", message: SHORT_CREDENTIAL_MESSAGE });
			expect(k.engine.invocations).toHaveLength(0);
			expect((await getAgentRun(k.temp.db, error.runId))?.status).toBe("error");
			expect(hits(k.temp.db, [c.value])).toEqual([]);
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
		const k: CallKit = await kit({
			transport: "pi",
			pi: { apiKey: API_KEY },
			async respond(req) {
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
		const error = await rejection(k.call("Extract", ["note"]));
		expect(sent).toEqual([ROTATED_KEY]);
		expect(k.engine.invocations[0]?.secrets).not.toContain(ROTATED_KEY);
		expect(transportSecrets).toContain(ROTATED_KEY);
		expect(JSON.stringify(error.failure)).not.toContain(ROTATED_KEY);
		expect(hits(k.temp.db, [ROTATED_KEY, API_KEY])).toEqual([]);
	});
});
