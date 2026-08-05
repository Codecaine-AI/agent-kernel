/**
 * prompt-edit-client tests — catalog-client conventions: an inline fetchImpl
 * records URLs/bodies and answers Response.json; no globals patched. Plus the
 * SSE frame parser and the fetch-stream subscriber against an in-memory
 * ReadableStream response.
 */
import { describe, expect, test } from "bun:test";
import type { PromptEditSessionEventDto } from "@agent-kernel/viewer-core";

import {
	createPromptEditClient,
	feedSseChunk,
	isPromptEditClientFailure,
} from "./prompt-edit-client";

interface RecordedCall {
	url: string;
	method: string;
	body: unknown;
}

function makeClient(
	respond: (call: RecordedCall) => Response,
	calls: RecordedCall[] = [],
) {
	const client = createPromptEditClient({
		origin: "http://kernel.test",
		agentName: "layout editor",
		fetchImpl: async (input, init) => {
			const call: RecordedCall = {
				url: input,
				method: init?.method ?? "GET",
				body:
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
			};
			calls.push(call);
			return respond(call);
		},
	});
	return { client, calls };
}

describe("URLs and encoding", () => {
	test("annotation list/add hit the sidecar routes with an encoded agent name", async () => {
		const { client, calls } = makeClient(() =>
			Response.json({ annotations: { schemaVersion: 1, annotations: [] }, hash: null, dangling: [] }),
		);
		await client.listAnnotations();
		await client.addAnnotation({
			target: { kind: "prompt-node", docId: "d", nodeId: "d" },
			body: "note",
			intent: "agent-request",
			author: "human",
		});
		expect(calls[0]!.url).toBe(
			"http://kernel.test/kernel/catalog/agents/layout%20editor/annotations",
		);
		expect(calls[1]!.method).toBe("POST");
		expect(calls[1]!.body).toMatchObject({ intent: "agent-request" });
	});

	test("session routes: create under the agent, reviews under the session id", async () => {
		const { client, calls } = makeClient(() => Response.json({ ok: true }));
		await client.createSession({ instruction: "go" });
		await client.acceptProposal("sess/1", "R1");
		await client.rejectProposal("sess/1", "R2", "nope");
		await client.undoProposal("sess/1", "R1");
		await client.replyToSessionRequest("sess/1", "R1", "answer");
		await client.disposeSession("sess/1");
		expect(calls.map((c) => c.url)).toEqual([
			"http://kernel.test/kernel/catalog/agents/layout%20editor/edit-sessions",
			"http://kernel.test/kernel/prompt-edit-sessions/sess%2F1/requests/R1/accept",
			"http://kernel.test/kernel/prompt-edit-sessions/sess%2F1/requests/R2/reject",
			"http://kernel.test/kernel/prompt-edit-sessions/sess%2F1/requests/R1/undo",
			"http://kernel.test/kernel/prompt-edit-sessions/sess%2F1/requests/R1/replies",
			"http://kernel.test/kernel/prompt-edit-sessions/sess%2F1",
		]);
		expect(calls[2]!.body).toEqual({ note: "nope" });
		expect(calls[5]!.method).toBe("DELETE");
	});
});

describe("failure mapping", () => {
	test("409 review conflicts carry the typed failure", async () => {
		const { client } = makeClient(() =>
			Response.json(
				{ failure: { kind: "out_of_order", alias: "R2", nextAlias: "R1" } },
				{ status: 409 },
			),
		);
		const result = await client.acceptProposal("s", "R2");
		if (!isPromptEditClientFailure(result)) throw new Error("expected failure");
		expect(result.status).toBe(409);
		expect(result.failure).toEqual({
			kind: "out_of_order",
			alias: "R2",
			nextAlias: "R1",
		});
	});

	test("stale-base 409 carries currentHash (the savePrompt idiom)", async () => {
		const { client } = makeClient(() =>
			Response.json(
				{
					currentHash: "hash-live",
					failure: {
						kind: "stale_base",
						expectedHash: "hash-old",
						currentHash: "hash-live",
					},
				},
				{ status: 409 },
			),
		);
		const result = await client.acceptProposal("s", "R1");
		if (!isPromptEditClientFailure(result)) throw new Error("expected failure");
		expect(result.currentHash).toBe("hash-live");
		// The failure union now also carries create-route conflicts (keyed by
		// `reason`), so review failures narrow on `kind`.
		expect(
			result.failure && "kind" in result.failure ? result.failure.kind : undefined,
		).toBe("stale_base");
	});

	test("errors arrays and error strings both surface", async () => {
		const { client } = makeClient(() =>
			Response.json({ errors: ["bad target"] }, { status: 400 }),
		);
		const result = await client.addAnnotation({
			target: { kind: "prompt-node", docId: "d", nodeId: "x" },
			body: "b",
			intent: "agent-request",
			author: "human",
		});
		if (!isPromptEditClientFailure(result)) throw new Error("expected failure");
		expect(result.errors).toEqual(["bad target"]);
	});
});

describe("feedSseChunk", () => {
	test("parses whole frames and returns the unparsed remainder", () => {
		const events: PromptEditSessionEventDto[] = [];
		const rest = feedSseChunk(
			'data: {"type":"session-status","sessionId":"s","status":"completed"}\n\ndata: {"type":"session-dis',
			(event) => events.push(event),
		);
		expect(events).toHaveLength(1);
		expect(events[0]!.type).toBe("session-status");
		expect(rest).toBe('data: {"type":"session-dis');
	});

	test("skips comment frames and malformed JSON without dying", () => {
		const events: PromptEditSessionEventDto[] = [];
		const rest = feedSseChunk(
			': connected\n\ndata: not-json\n\ndata: {"type":"session-disposed","sessionId":"s"}\n\n',
			(event) => events.push(event),
		);
		expect(events.map((e) => e.type)).toEqual(["session-disposed"]);
		expect(rest).toBe("");
	});
});

describe("subscribeSessionEvents", () => {
	function sseResponse(frames: string[]): Response {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const frame of frames) controller.enqueue(encoder.encode(frame));
				controller.close();
			},
		});
		return new Response(stream, {
			headers: { "content-type": "text/event-stream" },
		});
	}

	test("emits parsed events, split across chunk boundaries", async () => {
		const { client } = makeClient(() =>
			sseResponse([
				'data: {"type":"session-status","sessionId":"s","st',
				'atus":"completed"}\n\ndata: {"type":"session-disposed","sessionId":"s"}\n\n',
			]),
		);
		const events: PromptEditSessionEventDto[] = [];
		client.subscribeSessionEvents("s", (event) => events.push(event));
		await Bun.sleep(10);
		expect(events.map((e) => e.type)).toEqual([
			"session-status",
			"session-disposed",
		]);
	});

	test("unsubscribe aborts the request and stops emission", async () => {
		let signal: AbortSignal | undefined;
		const client = createPromptEditClient({
			origin: "http://kernel.test",
			agentName: "a",
			fetchImpl: async (_input, init) => {
				signal = init?.signal ?? undefined;
				// A stream that never closes on its own.
				return new Response(
					new ReadableStream<Uint8Array>({ start() {} }),
					{ headers: { "content-type": "text/event-stream" } },
				);
			},
		});
		const errors: Error[] = [];
		const unsubscribe = client.subscribeSessionEvents(
			"s",
			() => {},
			(error) => errors.push(error),
		);
		await Bun.sleep(5);
		unsubscribe();
		await Bun.sleep(5);
		expect(signal?.aborted).toBe(true);
		// Abort after unsubscribe is not an error.
		expect(errors).toHaveLength(0);
	});

	test("transport failure surfaces through onError", async () => {
		const { client } = makeClient(() =>
			Response.json({ error: "gone" }, { status: 404 }),
		);
		const errors: Error[] = [];
		client.subscribeSessionEvents("s", () => {}, (error) => errors.push(error));
		await Bun.sleep(10);
		expect(errors).toHaveLength(1);
		expect(errors[0]!.message).toContain("404");
	});
});
