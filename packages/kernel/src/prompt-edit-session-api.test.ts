/**
 * Route-level tests for the prompt-edit session endpoints: a real registry
 * over a temp agent-catalog + a temp SQLite kernel db, exercised through
 * Elysia's .handle(new Request(...)). The app under test is
 * createKernelCatalogApi with a session service passed in — proving the
 * session routes ride in through the one-line .use() wiring.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import {
	canonicalizePrompt,
	PROMPT_KIT_SCHEMA_VERSION,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";

import { buildRegistry, registerPromptRevisions, type AgentRegistry } from "./agent-registry";
import { createKernelCatalogApi } from "./catalog-api";
import {
	createKernelCatalogService,
	type KernelCatalogService,
} from "./catalog-service";
import {
	createPromptEditSessionService,
	type PromptEditSessionService,
} from "./prompt-edit-session";

const AGENT = "prompt-edit-api-agent";
const DOC_ID = "prompt-edit-api-doc";

function makePromptDocument(): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: DOC_ID,
		title: "Session API Test",
		nodes: [
			{
				type: "section",
				id: "sec-purpose",
				tag: "purpose",
				children: [
					{
						type: "paragraph",
						id: "para-0",
						content: ["You are the api fixture agent."],
					},
				],
			},
		],
	} as PromptDocument;
}

let dir: string;
let handle: KernelDatabaseHandle;
let registry: AgentRegistry;
let catalog: KernelCatalogService;
let sessions: PromptEditSessionService;
let app: ReturnType<typeof createKernelCatalogApi>;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "agent-kernel-pes-api-test-"));
	const catalogRoot = join(dir, "agent-catalog");
	const agentDir = join(catalogRoot, AGENT);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		`${JSON.stringify(
			{
				$schema: "agent-kernel/agent-v1",
				name: AGENT,
				description: "Session API fixture agent.",
				model: "test-model-alias",
				variables: {},
			},
			null,
			"\t",
		)}\n`,
		"utf8",
	);
	writeFileSync(
		join(agentDir, "prompt.json"),
		canonicalizePrompt(makePromptDocument()),
		"utf8",
	);

	handle = openKernelDatabase({ path: kernelDatabasePath(dir) });
	await ensureKernelObservabilitySchema(handle.db);
	registry = await buildRegistry({ roots: [catalogRoot] });
	await registerPromptRevisions(handle.db, registry);
	catalog = createKernelCatalogService({
		registry: async () => registry,
		db: () => handle.db,
		allowWrites: true,
	});
	sessions = createPromptEditSessionService({
		registry: async () => registry,
		catalog,
		allowWrites: true,
	});
	app = createKernelCatalogApi(catalog, { promptEditSessions: sessions });
});

afterEach(() => {
	sessions.disposeAll();
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

function url(path: string): string {
	return `http://localhost${path}`;
}

function post(path: string, body?: unknown) {
	return app.handle(
		new Request(url(path), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body ?? {}),
		}),
	);
}

async function addAgentRequest(body: string): Promise<void> {
	const result = await catalog.addAnnotation(AGENT, {
		target: { kind: "prompt-node", docId: DOC_ID, nodeId: "para-0" },
		body,
		intent: "agent-request",
		author: "ford",
	});
	if (!result || !result.ok) throw new Error("fixture annotation add failed");
}

async function createSessionViaRoute(): Promise<string> {
	const response = await post(`/kernel/catalog/agents/${AGENT}/edit-sessions`, {
		instruction: "Work the queue.",
	});
	expect(response.status).toBe(201);
	const body = (await response.json()) as { state: { sessionId: string } };
	return body.state.sessionId;
}

async function stageProposal(sessionId: string): Promise<void> {
	const session = sessions.getSession(sessionId);
	if (!session) throw new Error("no session");
	const result = await session.propose(
		"R1",
		[{ op: "update_node", nodeId: "para-0", patch: { content: ["Be blunt."] } }],
		"Sharpen the opening.",
	);
	if (!result.ok) throw new Error(JSON.stringify(result.failure));
}

describe("create / read routes", () => {
	test("POST create answers 404 for an unknown agent", async () => {
		const response = await post("/kernel/catalog/agents/no-such/edit-sessions");
		expect(response.status).toBe(404);
	});

	test("POST create answers 201 with the session state; GET list and GET state serve it", async () => {
		await addAgentRequest("Sharpen the opening.");
		const sessionId = await createSessionViaRoute();

		const listing = await app.handle(new Request(url("/kernel/prompt-edit-sessions")));
		expect(listing.status).toBe(200);
		const listed = (await listing.json()) as {
			sessions: Array<{ sessionId: string; requestCount: number }>;
		};
		expect(listed.sessions.map((row) => row.sessionId)).toEqual([sessionId]);
		expect(listed.sessions[0]?.requestCount).toBe(1);

		const detail = await app.handle(
			new Request(url(`/kernel/prompt-edit-sessions/${sessionId}`)),
		);
		expect(detail.status).toBe(200);
		const body = (await detail.json()) as {
			state: { requests: Array<{ alias: string; review: string }> };
		};
		expect(body.state.requests).toEqual([
			expect.objectContaining({ alias: "R1", review: "pending" }),
		]);

		expect(
			(await app.handle(new Request(url("/kernel/prompt-edit-sessions/nope"))))
				.status,
		).toBe(404);
	});
});

describe("review routes", () => {
	test("accept applies and answers the new hash; conflicts use the 409 idiom", async () => {
		await addAgentRequest("Sharpen the opening.");
		const sessionId = await createSessionViaRoute();

		// Nothing staged yet: a typed 409 conflict.
		const early = await post(
			`/kernel/prompt-edit-sessions/${sessionId}/requests/R1/accept`,
		);
		expect(early.status).toBe(409);
		expect(((await early.json()) as { failure: { kind: string } }).failure.kind).toBe(
			"no_staged_proposal",
		);

		await stageProposal(sessionId);
		const response = await post(
			`/kernel/prompt-edit-sessions/${sessionId}/requests/R1/accept`,
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean; hash: string };
		expect(body.ok).toBe(true);
		expect(typeof body.hash).toBe("string");

		// Undo it through the route as well.
		const undo = await post(
			`/kernel/prompt-edit-sessions/${sessionId}/requests/R1/undo`,
		);
		expect(undo.status).toBe(200);
		expect(((await undo.json()) as { ok: boolean }).ok).toBe(true);
	});

	test("reject with a note answers 200 and closes the request", async () => {
		await addAgentRequest("Sharpen the opening.");
		const sessionId = await createSessionViaRoute();
		await stageProposal(sessionId);
		const response = await post(
			`/kernel/prompt-edit-sessions/${sessionId}/requests/R1/reject`,
			{ note: "Keep the original tone." },
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			ok: boolean;
			request: { status: string };
		};
		expect(body.ok).toBe(true);
		expect(body.request.status).toBe("declined");
	});

	test("reply and add-request routes reach the session", async () => {
		await addAgentRequest("Sharpen the opening.");
		const sessionId = await createSessionViaRoute();
		const reply = await post(
			`/kernel/prompt-edit-sessions/${sessionId}/requests/R1/replies`,
			{ body: "Prefer a colon over a dash." },
		);
		expect(reply.status).toBe(200);

		const added = await post(`/kernel/prompt-edit-sessions/${sessionId}/requests`, {
			target: { kind: "doc" },
			body: "Overall: shorter.",
		});
		expect(added.status).toBe(200);
		const body = (await added.json()) as { request: { alias: string } };
		expect(body.request.alias).toBe("R2");
	});
});

describe("SSE stream", () => {
	test("smoke: hello snapshot, live events, terminal dispose", async () => {
		await addAgentRequest("Sharpen the opening.");
		const sessionId = await createSessionViaRoute();

		const response = await app.handle(
			new Request(url(`/kernel/prompt-edit-sessions/${sessionId}/events`)),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");

		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let buffered = "";
		const frames: Array<{ type: string }> = [];
		async function readFrames(until: number): Promise<void> {
			while (frames.length < until) {
				const { done, value } = await reader.read();
				if (done) return;
				buffered += decoder.decode(value, { stream: true });
				let index = buffered.indexOf("\n\n");
				while (index !== -1) {
					const frame = buffered.slice(0, index);
					buffered = buffered.slice(index + 2);
					const data = frame.replace(/^data: /, "");
					frames.push(JSON.parse(data) as { type: string });
					index = buffered.indexOf("\n\n");
				}
			}
		}

		await readFrames(1);
		expect(frames[0]?.type).toBe("session-state");

		// A staged proposal must arrive as a live event.
		await stageProposal(sessionId);
		await readFrames(3);
		const types = frames.map((frame) => frame.type);
		expect(types).toContain("proposal-staged");
		expect(types).toContain("request-updated");

		// Dispose ends the stream after a terminal marker.
		const disposed = await app.handle(
			new Request(url(`/kernel/prompt-edit-sessions/${sessionId}`), {
				method: "DELETE",
			}),
		);
		expect(disposed.status).toBe(200);
		await readFrames(frames.length + 1);
		expect(frames[frames.length - 1]?.type).toBe("session-disposed");
		const end = await reader.read();
		expect(end.done).toBe(true);
	});

	test("404 for an unknown session", async () => {
		const response = await app.handle(
			new Request(url("/kernel/prompt-edit-sessions/nope/events")),
		);
		expect(response.status).toBe(404);
	});
});

describe("read-only gating", () => {
	test("mutation routes answer 403 when writes are disabled; reads still serve", async () => {
		await addAgentRequest("Sharpen the opening.");
		const sessionId = await createSessionViaRoute();
		const readOnlyApp = createKernelCatalogApi(catalog, {
			allowWrites: false,
			promptEditSessions: sessions,
		});

		const mutations = [
			readOnlyApp.handle(
				new Request(url(`/kernel/catalog/agents/${AGENT}/edit-sessions`), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}",
				}),
			),
			readOnlyApp.handle(
				new Request(
					url(`/kernel/prompt-edit-sessions/${sessionId}/requests/R1/accept`),
					{ method: "POST" },
				),
			),
			readOnlyApp.handle(
				new Request(url(`/kernel/prompt-edit-sessions/${sessionId}`), {
					method: "DELETE",
				}),
			),
		];
		for (const pending of mutations) {
			expect((await pending).status).toBe(403);
		}

		const read = await readOnlyApp.handle(
			new Request(url(`/kernel/prompt-edit-sessions/${sessionId}`)),
		);
		expect(read.status).toBe(200);
	});
});
