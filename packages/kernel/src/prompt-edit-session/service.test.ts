/**
 * Prompt-edit session service tests (Phase 2 apply path): a real registry
 * over a temp agent-catalog + a temp SQLite kernel db, with the catalog
 * service providing annotations, savePrompt and the sidecar ops. No LLM is
 * spawned — the tests drive the underlying session directly (as the agent
 * tools would) and exercise the review flow through the service.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

import { buildRegistry, registerPromptRevisions, type AgentRegistry } from "../agent-registry";
import {
	createKernelCatalogService,
	type KernelCatalogService,
} from "../catalog-service";
import {
	createPromptEditSessionService,
	type PromptEditSessionService,
	type PromptEditSessionStreamEvent,
} from "./service";
import type { LaunchedPromptEditSession } from "./launch";

const AGENT = "prompt-edit-service-agent";
const DOC_ID = "prompt-edit-service-doc";

function makePromptDocument(paragraphs: [string, string]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: DOC_ID,
		title: "Apply Path Test",
		nodes: [
			{
				type: "section",
				id: "sec-purpose",
				tag: "purpose",
				children: paragraphs.map((text, index) => ({
					type: "paragraph",
					id: `para-${index}`,
					content: [text],
				})),
			},
		],
	} as PromptDocument;
}

let dir: string;
let agentDir: string;
let handle: KernelDatabaseHandle;
let registry: AgentRegistry;
let catalog: KernelCatalogService;
let service: PromptEditSessionService;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "agent-kernel-pes-service-test-"));
	const catalogRoot = join(dir, "agent-catalog");
	agentDir = join(catalogRoot, AGENT);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		`${JSON.stringify(
			{
				$schema: "agent-kernel/agent-v1",
				name: AGENT,
				description: "Apply-path fixture agent.",
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
		canonicalizePrompt(
			makePromptDocument(["You are the fixture agent.", "Keep answers short."]),
		),
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
	service = createPromptEditSessionService({
		registry: async () => registry,
		catalog,
		allowWrites: true,
	});
});

afterEach(() => {
	service.disposeAll();
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

function nodeTarget(nodeId: string) {
	return { kind: "prompt-node", docId: DOC_ID, nodeId };
}

async function addAgentRequest(nodeId: string, body: string): Promise<string> {
	const result = await catalog.addAnnotation(AGENT, {
		target: nodeTarget(nodeId),
		body,
		intent: "agent-request",
		author: "ford",
	});
	if (!result || !result.ok) throw new Error("fixture annotation add failed");
	return result.annotation.id;
}

/** Annotation → session → two staged proposals (R1 on para-0, R2 on para-1). */
async function sessionWithTwoProposals() {
	const ann1 = await addAgentRequest("para-0", "Make the opening direct.");
	const ann2 = await addAgentRequest("para-1", "Tighten the brevity rule.");
	const created = await service.createSession(AGENT);
	if (!created.ok) throw new Error(`createSession failed: ${created.reason}`);
	const sessionId = created.state.sessionId;
	const session = service.getSession(sessionId);
	if (!session) throw new Error("no session");
	const p1 = await session.propose(
		"R1",
		[{ op: "update_node", nodeId: "para-0", patch: { content: ["Be direct."] } }],
		"Rewrite the opening to be direct.",
	);
	if (!p1.ok) throw new Error(JSON.stringify(p1.failure));
	const p2 = await session.propose(
		"R2",
		[
			{
				op: "update_node",
				nodeId: "para-1",
				patch: { content: ["Answer in one short paragraph."] },
			},
		],
		"Make the brevity rule concrete.",
	);
	if (!p2.ok) throw new Error(JSON.stringify(p2.failure));
	return { sessionId, session, ann1, ann2 };
}

function diskPromptText(): string {
	return readFileSync(join(agentDir, "prompt.json"), "utf8");
}

describe("createSession", () => {
	test("unknown agent is a typed launch failure", async () => {
		const result = await service.createSession("no-such-agent");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("unknown-agent");
	});

	test("annotation-derived state snapshot with review overlay defaults", async () => {
		await addAgentRequest("para-0", "Make the opening direct.");
		const created = await service.createSession(AGENT, { instruction: "Go." });
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const state = created.state;
		expect(state.targetAgent).toBe(AGENT);
		expect(state.currentHash).toBe(state.baseHash);
		expect(state.instruction).toBe("Go.");
		expect(state.requests.map((request) => request.alias)).toEqual(["R1"]);
		expect(state.requests[0]?.review).toBe("pending");
		expect(state.nextAcceptAlias).toBeNull();
		expect(state.undoableAlias).toBeNull();
		expect(state.agent).toEqual({ spawned: false });
		expect(service.list().map((row) => row.sessionId)).toEqual([
			state.sessionId,
		]);
	});

	test("the spawn call sits behind the injectable function; failures land on agent state", async () => {
		await addAgentRequest("para-0", "Note.");
		const seen: LaunchedPromptEditSession[] = [];
		const spawning = createPromptEditSessionService({
			registry: async () => registry,
			catalog,
			allowWrites: true,
			spawnAgent: (launch) => {
				seen.push(launch);
				throw new Error("no runtime in tests");
			},
		});
		const created = await spawning.createSession(AGENT);
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(created.state.agent.spawned).toBe(true);
		await Bun.sleep(0);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.session.id).toBe(created.state.sessionId);
		expect(seen[0]?.spawn.agentName).toBe("prompt-editor");
		expect(spawning.getState(created.state.sessionId)?.agent.error).toBe(
			"no runtime in tests",
		);
		spawning.disposeAll();
	});
});

describe("acceptProposal", () => {
	test("staging order is enforced with a typed out-of-order failure", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		const result = await service.acceptProposal(sessionId, "R2");
		expect(result?.ok).toBe(false);
		if (!result || result.ok) return;
		expect(result.failure).toEqual({
			kind: "out_of_order",
			alias: "R2",
			nextAlias: "R1",
		});
	});

	test("full happy path: new revision on disk with source agent-run, sidecar agentRun + resolved, event emitted", async () => {
		const { sessionId, ann1 } = await sessionWithTwoProposals();
		const events: PromptEditSessionStreamEvent[] = [];
		service.subscribe(sessionId, (event) => events.push(event));
		const baseHash = service.getState(sessionId)!.baseHash;

		const result = await service.acceptProposal(sessionId, "R1");
		expect(result?.ok).toBe(true);
		if (!result || !result.ok) return;
		expect(result.hash).not.toBe(baseHash);
		expect(result.annotation).toMatchObject({
			annotationId: ann1,
			attached: true,
			resolved: true,
		});

		// Disk write-through: prompt.json carries the edit.
		expect(diskPromptText()).toContain("Be direct.");
		// Registry hot-swap: the live hash moved to the new revision.
		expect(registry.tryGet(AGENT)?.promptHash).toBe(result.hash);
		// Revision row with the new source.
		const revisions = await catalog.listRevisions(AGENT);
		const row = revisions?.find((candidate) => candidate.hash === result.hash);
		expect(row?.source).toBe("agent-run");

		// Sidecar: agentRun attached AND annotation resolved (Phase 3 will use
		// a proper `applied` status — plan item 10).
		const listed = await catalog.listAnnotations(AGENT);
		if (!listed || !listed.ok) throw new Error("sidecar unreadable");
		const annotation = listed.annotations.annotations.find(
			(candidate) => candidate.id === ann1,
		) as Record<string, unknown> | undefined;
		expect(annotation?.status).toBe("resolved");
		expect(annotation?.agentRun).toMatchObject({
			sessionId,
			patchId: result.transactionId,
			summary: "Rewrite the opening to be direct.",
			changedIds: ["para-0"],
		});

		// Service state: pointers advanced, review overlay applied.
		const state = service.getState(sessionId)!;
		expect(state.currentHash).toBe(result.hash);
		expect(state.requests.find((entry) => entry.alias === "R1")?.review).toBe(
			"applied",
		);
		expect(state.nextAcceptAlias).toBe("R2");
		expect(state.undoableAlias).toBe("R1");

		expect(events).toContainEqual({
			type: "proposal-applied",
			sessionId,
			alias: "R1",
			transactionId: result.transactionId,
			hash: result.hash,
		});
	});

	test("a lab save mid-session surfaces as a typed stale-base 409 result; nothing half-applied", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		// Someone saves from the lab while the review is open.
		const labDoc = makePromptDocument([
			"You are the fixture agent, edited in the lab.",
			"Keep answers short.",
		]);
		const labSave = await catalog.savePrompt(AGENT, labDoc);
		if (!labSave || !labSave.ok) throw new Error("lab save failed");

		const result = await service.acceptProposal(sessionId, "R1");
		expect(result?.ok).toBe(false);
		if (!result || result.ok) return;
		expect(result.failure.kind).toBe("stale_base");
		if (result.failure.kind !== "stale_base") return;
		expect(result.failure.currentHash).toBe(labSave.hash);
		// The lab content is untouched; the proposal did not land.
		expect(diskPromptText()).toContain("edited in the lab");
		expect(diskPromptText()).not.toContain("Be direct.");
		expect(
			service.getState(sessionId)!.requests.find((entry) => entry.alias === "R1")
				?.review,
		).toBe("pending");
	});

	test("re-accepting an applied proposal is refused", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		expect((await service.acceptProposal(sessionId, "R1"))?.ok).toBe(true);
		const again = await service.acceptProposal(sessionId, "R1");
		expect(again?.ok).toBe(false);
		if (!again || again.ok) return;
		expect(again.failure.kind).toBe("already_applied");
	});

	test("unknown session answers null; unknown alias and unstaged requests are typed", async () => {
		expect(await service.acceptProposal("nope", "R1")).toBeNull();
		await addAgentRequest("para-0", "No proposal staged for this one.");
		const created = await service.createSession(AGENT);
		if (!created.ok) throw new Error("create failed");
		const missing = await service.acceptProposal(created.state.sessionId, "R9");
		expect(missing && !missing.ok && missing.failure.kind).toBe(
			"unknown_request",
		);
		const unstaged = await service.acceptProposal(created.state.sessionId, "R1");
		expect(unstaged && !unstaged.ok && unstaged.failure.kind).toBe(
			"no_staged_proposal",
		);
	});
});

describe("rejectProposal", () => {
	test("rejecting a non-latest staged proposal is a typed refusal (sequential staging)", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		const result = await service.rejectProposal(sessionId, "R1", "Nope.");
		expect(result?.ok).toBe(false);
		if (!result || result.ok) return;
		expect(result.failure).toEqual({
			kind: "proposal_not_latest",
			alias: "R1",
			latestAlias: "R2",
		});
	});

	test("rejecting the latest discards it, resolves the annotation with the note, and emits", async () => {
		const { sessionId, session, ann2 } = await sessionWithTwoProposals();
		const events: PromptEditSessionStreamEvent[] = [];
		service.subscribe(sessionId, (event) => events.push(event));

		const result = await service.rejectProposal(
			sessionId,
			"R2",
			"Too aggressive a cut.",
		);
		expect(result?.ok).toBe(true);
		if (!result || !result.ok) return;
		expect(result.request.status).toBe("declined");
		expect(result.annotation).toMatchObject({ annotationId: ann2, resolved: true });
		expect(session.proposals().map((proposal) => proposal.requestAlias)).toEqual([
			"R1",
		]);

		const listed = await catalog.listAnnotations(AGENT);
		if (!listed || !listed.ok) throw new Error("sidecar unreadable");
		const annotation = listed.annotations.annotations.find(
			(candidate) => candidate.id === ann2,
		) as Record<string, unknown> | undefined;
		expect(annotation?.status).toBe("resolved");
		expect(annotation?.resolution).toBe("Too aggressive a cut.");
		expect(annotation?.agentRun).toBeUndefined();

		expect(
			events.some((event) => event.type === "proposal-rejected"),
		).toBe(true);
		expect(
			service.getState(sessionId)!.requests.find((entry) => entry.alias === "R2")
				?.review,
		).toBe("rejected");
		// R1 is still acceptable after the discard.
		expect((await service.acceptProposal(sessionId, "R1"))?.ok).toBe(true);
	});

	test("an applied proposal cannot be rejected — undo owns it", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		await service.acceptProposal(sessionId, "R1");
		await service.acceptProposal(sessionId, "R2");
		const result = await service.rejectProposal(sessionId, "R2");
		expect(result && !result.ok && result.failure.kind).toBe("already_applied");
	});
});

describe("undoAccepted", () => {
	test("only the most recently applied proposal is undoable; undo is a write-through save and re-opens the accept", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		const first = await service.acceptProposal(sessionId, "R1");
		const second = await service.acceptProposal(sessionId, "R2");
		if (!first?.ok || !second?.ok) throw new Error("accepts failed");
		const events: PromptEditSessionStreamEvent[] = [];
		service.subscribe(sessionId, (event) => events.push(event));

		const linearity = await service.undoAccepted(sessionId, "R1");
		expect(linearity?.ok).toBe(false);
		if (!linearity || linearity.ok) return;
		expect(linearity.failure).toEqual({
			kind: "not_latest_applied",
			alias: "R1",
			lastAppliedAlias: "R2",
		});

		const undone = await service.undoAccepted(sessionId, "R2");
		expect(undone?.ok).toBe(true);
		if (!undone || !undone.ok) return;
		// Content-addressed history: reverting R2 restores the post-R1 content
		// and therefore the post-R1 hash; disk and registry follow.
		expect(undone.hash).toBe(first.hash);
		expect(diskPromptText()).toContain("Be direct.");
		expect(diskPromptText()).toContain("Keep answers short.");
		expect(diskPromptText()).not.toContain("Answer in one short paragraph.");
		expect(registry.tryGet(AGENT)?.promptHash).toBe(first.hash);

		const state = service.getState(sessionId)!;
		expect(state.currentHash).toBe(first.hash);
		expect(state.requests.find((entry) => entry.alias === "R2")?.review).toBe(
			"undone",
		);
		expect(state.nextAcceptAlias).toBe("R2");
		expect(state.undoableAlias).toBe("R1");
		expect(events.some((event) => event.type === "proposal-undone")).toBe(true);

		// Chain symmetry: the undone proposal is acceptable again.
		const reaccepted = await service.acceptProposal(sessionId, "R2");
		expect(reaccepted?.ok).toBe(true);
		if (reaccepted?.ok) expect(reaccepted.hash).toBe(second.hash);
	});

	test("undoing a never-applied request is typed", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		const result = await service.undoAccepted(sessionId, "R1");
		expect(result && !result.ok && result.failure.kind).toBe("not_applied");
	});
});

describe("read-only service", () => {
	test("accept, reject and undo refuse with writes_disabled", async () => {
		await addAgentRequest("para-0", "Request.");
		const readOnly = createPromptEditSessionService({
			registry: async () => registry,
			catalog,
			allowWrites: false,
		});
		const created = await readOnly.createSession(AGENT);
		if (!created.ok) throw new Error("create failed");
		const sessionId = created.state.sessionId;
		const session = readOnly.getSession(sessionId)!;
		const staged = await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "para-0", patch: { content: ["X."] } }],
			"Edit.",
		);
		expect(staged.ok).toBe(true);
		for (const result of [
			await readOnly.acceptProposal(sessionId, "R1"),
			await readOnly.rejectProposal(sessionId, "R1"),
			await readOnly.undoAccepted(sessionId, "R1"),
		]) {
			expect(result && !result.ok && result.failure.kind).toBe(
				"writes_disabled",
			);
		}
		readOnly.disposeAll();
	});
});

describe("human-side inputs and lifecycle", () => {
	test("replyToRequest passes through appendHumanReply and clears waiting-on-human", async () => {
		const { sessionId, session } = await sessionWithTwoProposals();
		session.reply("R1", "Should I also touch the sign-off?");
		expect(
			session.requests().find((entry) => entry.alias === "R1")?.waitingOnHuman,
		).toBe(true);
		const result = service.replyToRequest(sessionId, "R1", "No, leave it.");
		expect(result?.ok).toBe(true);
		expect(
			session.requests().find((entry) => entry.alias === "R1")?.waitingOnHuman,
		).toBe(false);
	});

	test("addHumanRequest joins the queue with the next alias and a generated id", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		const result = service.addHumanRequest(sessionId, {
			target: { kind: "node", nodeId: "para-1" },
			body: "Also mention the audience.",
		});
		expect(result?.ok).toBe(true);
		if (!result || !result.ok) return;
		expect(result.request.alias).toBe("R3");
		expect(result.request.author).toBe("human");
		expect(result.request.annotationId).toContain("host-req");
		const state = service.getState(sessionId)!;
		expect(state.requests).toHaveLength(3);
		expect(state.status).toBe("running");
	});

	test("dispose notifies stream listeners and forgets the session", async () => {
		const { sessionId } = await sessionWithTwoProposals();
		const events: PromptEditSessionStreamEvent[] = [];
		service.subscribe(sessionId, (event) => events.push(event));
		expect(service.dispose(sessionId)).toBe(true);
		expect(events).toContainEqual({ type: "session-disposed", sessionId });
		expect(service.getState(sessionId)).toBeNull();
		expect(service.dispose(sessionId)).toBe(false);
	});
});
