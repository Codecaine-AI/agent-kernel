/**
 * End-to-end smoke over the full Phase 2 loop, in-process (no listening
 * server): the kernel catalog API boots exactly like Track D's route tests
 * (temp catalog + temp SQLite + createKernelCatalogApi with a session
 * service), and THIS package's client helpers drive it over HTTP via
 * `app.handle` — annotate (sidecar POST) → create session → stage (via the
 * session handle, standing in for the agent's propose tool) → SSE events →
 * accept (revision written) → undo → dispose. Asserts the client parses every
 * hop and the DTO→lab mapping windows correctly on live payloads.
 *
 * Dev-only dependency direction: @agent-kernel/kernel and /db are
 * devDependencies of viewer-ui, used by this test only — the shipped source
 * depends solely on viewer-core DTOs.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
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
	buildRegistry,
	createKernelCatalogService,
	createPromptEditSessionService,
	registerPromptRevisions,
	type PromptEditSessionService,
} from "@agent-kernel/kernel";
import { createKernelCatalogApi } from "@agent-kernel/kernel/catalog-api";
import {
	canonicalizePrompt,
	PROMPT_KIT_SCHEMA_VERSION,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import type { PromptEditSessionEventDto } from "@agent-kernel/viewer-core";

import {
	createPromptEditClient,
	isPromptEditClientFailure,
	type PromptEditClient,
} from "./prompt-edit-client";
import { toLabSessionData, windowProposals } from "./prompt-edit-session-view";

const AGENT = "loop-smoke-agent";
const DOC_ID = "loop-smoke-doc";

function makePromptDocument(): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: DOC_ID,
		title: "Loop Smoke",
		nodes: [
			{
				type: "section",
				id: "sec-purpose",
				tag: "purpose",
				children: [
					{
						type: "paragraph",
						id: "para-0",
						content: ["You are the loop smoke agent."],
					},
				],
			},
		],
	} as PromptDocument;
}

let dir: string;
let handle: KernelDatabaseHandle;
let sessions: PromptEditSessionService;
let client: PromptEditClient;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "viewer-ui-loop-smoke-"));
	const catalogRoot = join(dir, "agent-catalog");
	const agentDir = join(catalogRoot, AGENT);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		`${JSON.stringify(
			{
				$schema: "agent-kernel/agent-v1",
				name: AGENT,
				description: "Loop smoke fixture agent.",
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
	const registry = await buildRegistry({ roots: [catalogRoot] });
	await registerPromptRevisions(handle.db, registry);
	const catalog = createKernelCatalogService({
		registry: async () => registry,
		db: () => handle.db,
		allowWrites: true,
	});
	sessions = createPromptEditSessionService({
		registry: async () => registry,
		catalog,
		allowWrites: true,
	});
	const app = createKernelCatalogApi(catalog, { promptEditSessions: sessions });
	client = createPromptEditClient({
		origin: "http://localhost",
		agentName: AGENT,
		fetchImpl: (input, init) =>
			Promise.resolve(app.handle(new Request(input, init))),
	});
});

afterEach(() => {
	sessions.disposeAll();
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

async function waitFor(
	condition: () => boolean,
	label: string,
	timeoutMs = 2000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await Bun.sleep(5);
	}
}

test("annotate → session → stage → accept → undo → dispose, all through the client", async () => {
	// 1. Annotate: composer submit → sidecar POST.
	const added = await client.addAnnotation({
		target: { kind: "prompt-node", docId: DOC_ID, nodeId: "para-0" },
		body: "Sharpen the opening.",
		intent: "agent-request",
		author: "human",
	});
	if (isPromptEditClientFailure(added)) {
		throw new Error(`add failed: ${added.errors.join("; ")}`);
	}
	const listed = await client.listAnnotations();
	expect(listed.annotations.annotations).toHaveLength(1);
	expect(listed.hash).not.toBeNull();
	const annotationId = added.annotation.id;

	// 2. Create the session (headless — no spawn function configured).
	const created = await client.createSession({ instruction: "Work the queue." });
	if (isPromptEditClientFailure(created)) {
		throw new Error(`create failed: ${created.errors.join("; ")}`);
	}
	const state = created.state;
	const baseHash = state.currentHash;
	expect(state.requests.map((r) => r.alias)).toEqual(["R1"]);
	expect(state.requests[0]!.annotationId).toBe(annotationId);
	expect(state.agent.spawned).toBe(false);

	// 3. Subscribe the SSE stream (session-state hello first).
	const events: PromptEditSessionEventDto[] = [];
	const unsubscribe = client.subscribeSessionEvents(state.sessionId, (event) =>
		events.push(event),
	);
	await waitFor(() => events.some((e) => e.type === "session-state"), "hello");

	// 4. Stage a proposal via the session handle (the agent's propose tool).
	const session = sessions.getSession(state.sessionId);
	if (!session) throw new Error("session handle missing");
	const proposed = await session.propose(
		"R1",
		[{ op: "update_node", nodeId: "para-0", patch: { content: ["Be blunt."] } }],
		"Sharpen the opening.",
	);
	if (!proposed.ok) throw new Error(JSON.stringify(proposed.failure));
	await waitFor(
		() => events.some((e) => e.type === "proposal-staged"),
		"proposal-staged",
	);

	// 5. The staged state windows into the lab prop.
	const staged = await client.getSession(state.sessionId);
	if (isPromptEditClientFailure(staged)) throw new Error("getSession failed");
	expect(windowProposals(staged.state).map((p) => p.requestAlias)).toEqual(["R1"]);
	const labData = toLabSessionData(staged.state, DOC_ID);
	expect(labData.proposals).toHaveLength(1);
	expect(labData.proposals[0]!.renderedAfter).toContain("Be blunt.");

	// 6. Accept over HTTP: a new revision, the annotation resolved + stamped.
	const accepted = await client.acceptProposal(staged.state.sessionId, "R1");
	if (isPromptEditClientFailure(accepted)) {
		throw new Error(`accept failed: ${accepted.errors.join("; ")}`);
	}
	expect(accepted.hash).not.toBe(baseHash);
	expect(accepted.annotation.attached).toBe(true);
	expect(accepted.annotation.resolved).toBe(true);
	await waitFor(
		() => events.some((e) => e.type === "proposal-applied"),
		"proposal-applied",
	);
	const afterAccept = await client.getSession(state.sessionId);
	if (isPromptEditClientFailure(afterAccept)) throw new Error("getSession failed");
	expect(afterAccept.state.currentHash).toBe(accepted.hash);
	expect(afterAccept.state.undoableAlias).toBe("R1");
	expect(windowProposals(afterAccept.state)).toEqual([]);
	const resolvedList = await client.listAnnotations();
	expect(resolvedList.annotations.annotations[0]!.status).toBe("resolved");
	expect(resolvedList.annotations.annotations[0]!.agentRun?.patchId).toBe(
		accepted.transactionId,
	);

	// 7. Undo over HTTP: write-through revert back to the base content.
	const undone = await client.undoProposal(state.sessionId, "R1");
	if (isPromptEditClientFailure(undone)) {
		throw new Error(`undo failed: ${undone.errors.join("; ")}`);
	}
	expect(undone.hash).toBe(baseHash);
	const afterUndo = await client.getSession(state.sessionId);
	if (isPromptEditClientFailure(afterUndo)) throw new Error("getSession failed");
	expect(afterUndo.state.nextAcceptAlias).toBe("R1");
	expect(afterUndo.state.undoableAlias).toBeNull();

	// 8. Dispose: the stream ends with session-disposed.
	const disposed = await client.disposeSession(state.sessionId);
	if (isPromptEditClientFailure(disposed)) throw new Error("dispose failed");
	await waitFor(
		() => events.some((e) => e.type === "session-disposed"),
		"session-disposed",
	);
	unsubscribe();

	// Review-order guard still typed through the client after dispose: 404.
	const gone = await client.acceptProposal(state.sessionId, "R1");
	expect(isPromptEditClientFailure(gone) && gone.status === 404).toBe(true);
});
