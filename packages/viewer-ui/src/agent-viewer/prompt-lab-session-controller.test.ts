/**
 * prompt-lab-session-controller tests — container behavior against a fully
 * faked PromptEditClient: sidecar load, composer→sidecar POSTs (with the
 * 409-retry idiom), session create + SSE event → lab-prop updates, accept →
 * one prompt refresh per revision move (deduped against the stream echo).
 */
import { describe, expect, test } from "bun:test";
import type { PromptAnnotation } from "@codecaine-ai/prompt-kit/annotations";
import type {
	CatalogAnnotationsResponse,
	PromptEditSessionEventDto,
	PromptEditSessionProposalDto,
	PromptEditSessionStateDto,
} from "@agent-kernel/viewer-core";

import type {
	PromptEditClient,
	PromptEditClientFailure,
} from "./prompt-edit-client";
import { createPromptLabSessionController } from "./prompt-lab-session-controller";

const DOC = "doc-1";

function makeAnnotation(overrides: Partial<PromptAnnotation> = {}): PromptAnnotation {
	return {
		id: "ann-1",
		target: { kind: "prompt-node", docId: DOC, nodeId: "para-0" },
		body: "Tighten this.",
		intent: "agent-request",
		author: "human",
		status: "open",
		createdAt: "2026-07-31T00:00:00.000Z",
		...overrides,
	};
}

function annotationsResponse(
	annotations: PromptAnnotation[],
	hash: string | null,
): CatalogAnnotationsResponse {
	return {
		annotations: { schemaVersion: 1, annotations },
		hash,
		dangling: [],
	};
}

function makeProposal(alias: string): PromptEditSessionProposalDto {
	return {
		transactionId: `tx-${alias}`,
		requestAlias: alias,
		baseHash: "hash-base",
		steps: [],
		changedIds: ["para-0"],
		summary: `Edit for ${alias}`,
		renderedBefore: "before",
		renderedAfter: "after",
		createdAt: "2026-07-31T00:00:00.000Z",
		review: "pending",
	};
}

function makeSessionState(
	overrides: Partial<PromptEditSessionStateDto> = {},
): PromptEditSessionStateDto {
	return {
		sessionId: "sess-1",
		targetAgent: "layout-editor",
		baseHash: "hash-base",
		currentHash: "hash-base",
		status: "running",
		createdAt: "2026-07-31T00:00:00.000Z",
		requests: [
			{
				alias: "R1",
				annotationId: "ann-1",
				target: { kind: "node", nodeId: "para-0" },
				body: "Tighten this.",
				author: "human",
				replies: [],
				status: "open",
				waitingOnHuman: false,
				review: "pending",
			},
		],
		proposals: [],
		nextAcceptAlias: null,
		undoableAlias: null,
		skipped: [],
		agent: { spawned: true },
		...overrides,
	};
}

interface FakeClientState {
	annotations: CatalogAnnotationsResponse;
	sessionState: PromptEditSessionStateDto;
	calls: Array<{ method: string; args: unknown[] }>;
	emit: ((event: PromptEditSessionEventDto) => void) | null;
	addAnnotationResults?: Array<
		| { kind: "ok"; hash: string }
		| { kind: "conflict"; currentHash: string }
	>;
	acceptResult?:
		| { kind: "ok"; hash: string; transactionId: string }
		| { kind: "failure"; failure: PromptEditClientFailure };
	/** Scripted create failure (the 409 conflicts of the create route). */
	createSessionFailure?: PromptEditClientFailure;
}

function makeFakeClient(state: FakeClientState): PromptEditClient {
	const record = (method: string, ...args: unknown[]) =>
		state.calls.push({ method, args });
	const notImplemented = (): never => {
		throw new Error("not implemented in fake");
	};
	return {
		loadAgentDetail: notImplemented,
		async listAnnotations() {
			record("listAnnotations");
			return state.annotations;
		},
		async addAnnotation(input) {
			record("addAnnotation", input);
			const scripted = state.addAnnotationResults?.shift();
			if (scripted?.kind === "conflict") {
				return {
					ok: false,
					status: 409,
					errors: ["conflict"],
					currentHash: scripted.currentHash,
				};
			}
			const annotation = makeAnnotation({
				id: `ann-new-${state.calls.length}`,
				body: input.body,
				target: input.target,
			});
			state.annotations = annotationsResponse(
				[...state.annotations.annotations.annotations, annotation],
				scripted?.kind === "ok" ? scripted.hash : "hash-after-add",
			);
			return {
				ok: true,
				annotation,
				annotations: state.annotations.annotations,
				hash: state.annotations.hash ?? "hash-after-add",
			};
		},
		async replyToAnnotation(annotationId, input) {
			record("replyToAnnotation", annotationId, input);
			return {
				ok: true,
				annotation: state.annotations.annotations.annotations[0]!,
				annotations: state.annotations.annotations,
				hash: "hash-after-reply",
			};
		},
		resolveAnnotation: notImplemented,
		async createSession(input) {
			record("createSession", input);
			if (state.createSessionFailure) return state.createSessionFailure;
			return { state: state.sessionState };
		},
		async getSession(sessionId) {
			record("getSession", sessionId);
			return { state: state.sessionState };
		},
		async addSessionRequest(sessionId, input) {
			record("addSessionRequest", sessionId, input);
			return { ok: true };
		},
		async replyToSessionRequest(sessionId, alias, body) {
			record("replyToSessionRequest", sessionId, alias, body);
			return { ok: true };
		},
		async acceptProposal(sessionId, alias) {
			record("acceptProposal", sessionId, alias);
			const scripted = state.acceptResult;
			if (scripted?.kind === "failure") return scripted.failure;
			return {
				ok: true,
				alias,
				transactionId: scripted?.transactionId ?? `tx-${alias}`,
				hash: scripted?.hash ?? "hash-1",
				annotation: {
					annotationId: "ann-1",
					attached: true,
					resolved: true,
				},
			};
		},
		async rejectProposal(sessionId, alias, note) {
			record("rejectProposal", sessionId, alias, note);
			return {
				ok: true,
				alias,
				transactionId: `tx-${alias}`,
				request: state.sessionState.requests[0]!,
				annotation: { annotationId: "ann-1", attached: false, resolved: true },
			};
		},
		async undoProposal(sessionId, alias) {
			record("undoProposal", sessionId, alias);
			return { ok: true, alias, transactionId: `tx-${alias}`, hash: "hash-undo" };
		},
		async disposeSession(sessionId) {
			record("disposeSession", sessionId);
			return { ok: true };
		},
		subscribeSessionEvents(sessionId, onEvent) {
			record("subscribeSessionEvents", sessionId);
			state.emit = onEvent;
			return () => {
				state.emit = null;
			};
		},
	};
}

function setup(overrides: Partial<FakeClientState> = {}) {
	const state: FakeClientState = {
		annotations: annotationsResponse([makeAnnotation()], "hash-sidecar"),
		sessionState: makeSessionState(),
		calls: [],
		emit: null,
		...overrides,
	};
	const refreshes: string[] = [];
	const controller = createPromptLabSessionController({
		client: makeFakeClient(state),
		docId: () => DOC,
		onPromptRefresh: (hash) => {
			refreshes.push(hash);
		},
	});
	return { state, controller, refreshes };
}

const called = (state: FakeClientState, method: string) =>
	state.calls.filter((call) => call.method === method);

describe("annotation mirror (no session)", () => {
	test("load() lists the sidecar; labSession shows open requests, no review callbacks", async () => {
		const { controller } = setup();
		expect(controller.labSession()).toBeNull();
		await controller.load();
		const snapshot = controller.getSnapshot();
		expect(snapshot.annotationsLoaded).toBe(true);
		expect(snapshot.openRequestCount).toBe(1);
		const lab = controller.labSession();
		expect(lab).not.toBeNull();
		expect(lab!.requests.map((r) => r.alias)).toEqual(["R1"]);
		expect(lab!.proposals).toEqual([]);
		expect(lab!.onSendRequest).toBeDefined();
		expect(lab!.onAccept).toBeUndefined();
	});

	test("sendRequest POSTs to the sidecar with the tracked hash and echoes back", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.sendRequest(null, "Make it shorter.");
		const adds = called(state, "addAnnotation");
		expect(adds).toHaveLength(1);
		expect(adds[0]!.args[0]).toMatchObject({
			intent: "agent-request",
			author: "human",
			expectedHash: "hash-sidecar",
			target: { kind: "prompt-node", docId: DOC, nodeId: DOC },
		});
		expect(controller.getSnapshot().openRequestCount).toBe(2);
		expect(controller.labSession()!.requests).toHaveLength(2);
	});

	test("a 409 conflict re-lists once and retries with the fresh hash", async () => {
		const { state, controller } = setup({
			addAnnotationResults: [
				{ kind: "conflict", currentHash: "hash-fresh" },
				{ kind: "ok", hash: "hash-after-retry" },
			],
		});
		state.annotations = annotationsResponse([makeAnnotation()], "hash-stale");
		await controller.load();
		state.annotations = annotationsResponse([makeAnnotation()], "hash-fresh");
		await controller.sendRequest(null, "Retry me.");
		const adds = called(state, "addAnnotation");
		expect(adds).toHaveLength(2);
		expect((adds[0]!.args[0] as { expectedHash: string }).expectedHash).toBe("hash-stale");
		expect((adds[1]!.args[0] as { expectedHash: string }).expectedHash).toBe("hash-fresh");
		expect(controller.getSnapshot().annotationsError).toBeUndefined();
	});

	test("replies route to the aliased annotation", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.replyToRequest("R1", "Blunt, please.");
		const replies = called(state, "replyToAnnotation");
		expect(replies).toHaveLength(1);
		expect(replies[0]!.args[0]).toBe("ann-1");
	});
});

describe("session lifecycle", () => {
	test("startSession creates, subscribes, and swaps the lab prop to session state", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.startSession();
		expect(called(state, "createSession")).toHaveLength(1);
		expect(called(state, "subscribeSessionEvents")).toHaveLength(1);
		const lab = controller.labSession()!;
		expect(lab.onAccept).toBeDefined();
		expect(lab.requests[0]!.status).toBe("working");
	});

	test("a proposal-staged stream event surfaces in the lab prop", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.startSession();
		state.emit!({
			type: "proposal-staged",
			sessionId: "sess-1",
			proposal: makeProposal("R1"),
		});
		const lab = controller.labSession()!;
		expect(lab.proposals.map((p) => p.requestAlias)).toEqual(["R1"]);
	});

	test("session-disposed clears the session and returns to the annotation mirror", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.startSession();
		state.emit!({ type: "session-disposed", sessionId: "sess-1" });
		expect(controller.getSnapshot().session).toBeNull();
		expect(controller.labSession()!.onAccept).toBeUndefined();
	});

	test("endSession DELETEs and reloads the sidecar", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.startSession();
		await controller.endSession();
		expect(called(state, "disposeSession")).toHaveLength(1);
		expect(controller.getSnapshot().session).toBeNull();
	});
});

describe("review actions", () => {
	async function startWithProposal() {
		const context = setup();
		await context.controller.load();
		await context.controller.startSession();
		context.state.emit!({
			type: "proposal-staged",
			sessionId: "sess-1",
			proposal: makeProposal("R1"),
		});
		return context;
	}

	test("accept applies locally, refreshes the prompt once, reloads the sidecar", async () => {
		const { state, controller, refreshes } = await startWithProposal();
		await controller.accept("R1");
		expect(called(state, "acceptProposal")).toHaveLength(1);
		const session = controller.getSnapshot().session!;
		expect(session.currentHash).toBe("hash-1");
		expect(session.undoableAlias).toBe("R1");
		expect(controller.labSession()!.proposals).toEqual([]);
		expect(refreshes).toEqual(["hash-1"]);
		// The sidecar was re-listed after the server resolved the annotation.
		expect(called(state, "listAnnotations").length).toBeGreaterThanOrEqual(2);
	});

	test("the stream's echo of an applied proposal does not refresh twice", async () => {
		const { state, controller, refreshes } = await startWithProposal();
		await controller.accept("R1");
		state.emit!({
			type: "proposal-applied",
			sessionId: "sess-1",
			alias: "R1",
			transactionId: "tx-R1",
			hash: "hash-1",
		});
		await Bun.sleep(1);
		expect(refreshes).toEqual(["hash-1"]);
	});

	test("a typed accept failure lands in sessionError, nothing is reduced", async () => {
		const context = await startWithProposal();
		context.state.acceptResult = {
			kind: "failure",
			failure: {
				ok: false,
				status: 409,
				errors: [],
				failure: { kind: "out_of_order", alias: "R1", nextAlias: "R2" },
			},
		};
		await context.controller.accept("R1");
		expect(context.controller.getSnapshot().sessionError).toBe(
			"Accept R2 first — accepts apply in staging order.",
		);
		expect(context.controller.labSession()!.proposals).toHaveLength(1);
		expect(context.refreshes).toEqual([]);
	});

	test("reject removes the proposal and closes the request", async () => {
		const { state, controller } = await startWithProposal();
		await controller.reject("R1", "Not like this.");
		expect(called(state, "rejectProposal")[0]!.args).toEqual([
			"sess-1",
			"R1",
			"Not like this.",
		]);
		expect(controller.labSession()!.proposals).toEqual([]);
		expect(controller.labSession()!.requests[0]!.status).toBe("declined");
	});

	test("undo re-stages and refreshes to the revert hash", async () => {
		const { controller, refreshes } = await startWithProposal();
		await controller.accept("R1");
		await controller.undo("R1");
		const session = controller.getSnapshot().session!;
		expect(session.currentHash).toBe("hash-undo");
		expect(session.nextAcceptAlias).toBe("R1");
		expect(refreshes).toEqual(["hash-1", "hash-undo"]);
		expect(controller.labSession()!.proposals.map((p) => p.requestAlias)).toEqual(["R1"]);
	});

	test("mid-session sendRequest posts to the session, not the sidecar", async () => {
		const { state, controller } = await startWithProposal();
		await controller.sendRequest(null, "One more thing.");
		expect(called(state, "addSessionRequest")).toHaveLength(1);
		expect(called(state, "addSessionRequest")[0]!.args[1]).toEqual({
			target: { kind: "doc" },
			body: "One more thing.",
		});
		expect(called(state, "addAnnotation")).toHaveLength(0);
	});
});

describe("filing gestures (run now / apply / re-run)", () => {
	test("runRequest scopes the create to one annotation id", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.runRequest("ann-1");
		const creates = called(state, "createSession");
		expect(creates).toHaveLength(1);
		expect(creates[0]!.args[0]).toEqual({ requestIds: ["ann-1"] });
		expect(controller.getSnapshot().session?.sessionId).toBe("sess-1");
	});

	test("applyQueue scopes the create to the queued set; an empty batch is a no-op", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.applyQueue([]);
		expect(called(state, "createSession")).toHaveLength(0);
		await controller.applyQueue(["ann-1", "ann-2"]);
		expect(called(state, "createSession")[0]!.args[0]).toEqual({
			requestIds: ["ann-1", "ann-2"],
		});
	});

	test("startSession stays unscoped (the strip's Apply-all path is unchanged)", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.startSession("Work the queue.");
		expect(called(state, "createSession")[0]!.args[0]).toEqual({
			instruction: "Work the queue.",
		});
	});

	test("rerunRequest replies on the SESSION thread when a session covers the annotation", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.runRequest("ann-1");
		await controller.rerunRequest("ann-1", "  Shorter, please.  ");
		// Alias-resolved from the session's requests, and trimmed.
		expect(called(state, "replyToSessionRequest")[0]!.args).toEqual([
			"sess-1",
			"R1",
			"Shorter, please.",
		]);
		expect(called(state, "replyToAnnotation")).toHaveLength(0);
	});

	test("rerunRequest degrades to a sidecar reply when no session covers the annotation", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.rerunRequest("ann-1", "Shorter, please.");
		expect(called(state, "replyToAnnotation")[0]!.args[0]).toBe("ann-1");
		expect(called(state, "replyToSessionRequest")).toHaveLength(0);
		// Empty replies never reach the wire.
		await controller.rerunRequest("ann-1", "   ");
		expect(called(state, "replyToAnnotation")).toHaveLength(1);
	});

	test("the agent-busy conflict surfaces as a readable session error", async () => {
		const { controller } = setup({
			createSessionFailure: {
				ok: false,
				status: 409,
				errors: ["Agent layout-editor already has an open prompt-edit session"],
				failure: {
					ok: false,
					reason: "agent-busy",
					targetAgent: "layout-editor",
					sessionId: "sess-other",
				},
			},
		});
		await controller.load();
		await controller.runRequest("ann-1");
		expect(controller.getSnapshot().session).toBeNull();
		expect(controller.getSnapshot().sessionError).toBe(
			"Another prompt-edit session is already open for this agent — end it first.",
		);
	});

	test("every gesture rides on the lab session prop", async () => {
		const { controller } = setup();
		await controller.load();
		const lab = controller.labSession()!;
		expect(lab.onFileRequest).toBeDefined();
		expect(lab.onRunRequest).toBeDefined();
		expect(lab.onApplyQueue).toBeDefined();
		expect(lab.onRerunRequest).toBeDefined();
	});

	test("fileRequest persists every disposition as an open agent-request", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.fileRequest({
			annotationId: "lab-1",
			disposition: "batch",
			target: { kind: "prompt-node", docId: DOC, nodeId: "para-0" },
			body: "Queue this.",
		});
		await controller.fileRequest({
			annotationId: "lab-2",
			disposition: "global",
			target: null,
			body: "Whole-doc note.",
		});
		const adds = called(state, "addAnnotation");
		expect(adds).toHaveLength(2);
		expect(adds[0]!.args[0]).toMatchObject({
			intent: "agent-request",
			target: { kind: "prompt-node", docId: DOC, nodeId: "para-0" },
		});
		// A global filing has a null target, which maps to the document target.
		expect(adds[1]!.args[0]).toMatchObject({
			target: { kind: "prompt-node", docId: DOC, nodeId: DOC },
		});
	});

	test("run-now translates the lab-minted filing id to the kernel's annotation id", async () => {
		const { state, controller } = setup();
		await controller.load();
		// The lab fires onFileRequest WITHOUT awaiting it, then onRunRequest with
		// its own minted id in the same tick — run-now must wait for the POST and
		// scope the session to the id the kernel actually assigned.
		const filing = controller.fileRequest({
			annotationId: "lab-minted-id",
			disposition: "run-now",
			target: { kind: "prompt-node", docId: DOC, nodeId: "para-0" },
			body: "Run this now.",
		});
		const run = controller.runRequest("lab-minted-id");
		await Promise.all([filing, run]);

		const kernelId = state.annotations.annotations.annotations.at(-1)!.id;
		expect(kernelId).not.toBe("lab-minted-id");
		const creates = called(state, "createSession");
		expect(creates).toHaveLength(1);
		expect(creates[0]!.args[0]).toEqual({ requestIds: [kernelId] });
	});

	test("apply translates in-flight filing handles too, and drops ones that failed", async () => {
		const { state, controller } = setup({
			addAnnotationResults: [{ kind: "conflict", currentHash: "h" }, { kind: "conflict", currentHash: "h" }],
		});
		await controller.load();
		const filing = controller.fileRequest({
			annotationId: "lab-doomed",
			disposition: "batch",
			target: null,
			body: "This POST fails.",
		});
		await Promise.all([filing, controller.applyQueue(["lab-doomed"])]);
		// Nothing resolvable, so no session was created.
		expect(called(state, "createSession")).toHaveLength(0);
	});

	test("an agent-turn event flips the session's running flag", async () => {
		const { state, controller } = setup();
		await controller.load();
		await controller.runRequest("ann-1");
		state.emit!({
			type: "agent-turn",
			sessionId: "sess-1",
			phase: "started",
			turn: 2,
			aliases: ["R1"],
		});
		expect(controller.getSnapshot().session?.agent).toMatchObject({
			running: true,
			turns: 2,
		});
		state.emit!({
			type: "agent-turn",
			sessionId: "sess-1",
			phase: "finished",
			turn: 2,
			aliases: ["R1"],
		});
		expect(controller.getSnapshot().session?.agent.running).toBe(false);
	});
});
