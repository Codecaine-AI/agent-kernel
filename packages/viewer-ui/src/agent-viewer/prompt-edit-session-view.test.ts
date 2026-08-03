/**
 * prompt-edit-session-view tests — the DTO→lab-prop mapping (status matrix,
 * author/target vocab, proposal windowing) and the SSE event reducer's
 * staging-order invariants.
 */
import { describe, expect, test } from "bun:test";
import type { PromptAnnotation } from "@codecaine-ai/prompt-kit/annotations";
import type {
	PromptEditReviewStatus,
	PromptEditSessionProposalDto,
	PromptEditSessionRequestDto,
	PromptEditSessionStateDto,
} from "@agent-kernel/viewer-core";

import {
	annotationsToLabRequests,
	applySessionEvent,
	isAgentActive,
	toAnnotationTarget,
	toLabAuthor,
	toLabRequestStatus,
	toLabSessionData,
	toLabTarget,
	toSessionTarget,
	windowProposals,
} from "./prompt-edit-session-view";

const DOC = "doc-1";

function makeRequest(
	overrides: Partial<PromptEditSessionRequestDto> = {},
): PromptEditSessionRequestDto {
	return {
		alias: "R1",
		annotationId: "ann-1",
		target: { kind: "node", nodeId: "para-0" },
		body: "Tighten this.",
		author: "human",
		replies: [],
		status: "open",
		waitingOnHuman: false,
		review: "pending",
		...overrides,
	};
}

function makeProposal(
	alias: string,
	overrides: Partial<PromptEditSessionProposalDto> = {},
): PromptEditSessionProposalDto {
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
		...overrides,
	};
}

function makeState(
	overrides: Partial<PromptEditSessionStateDto> = {},
): PromptEditSessionStateDto {
	return {
		sessionId: "sess-1",
		targetAgent: "layout-editor",
		baseHash: "hash-base",
		currentHash: "hash-base",
		status: "running",
		createdAt: "2026-07-31T00:00:00.000Z",
		requests: [makeRequest()],
		proposals: [],
		nextAcceptAlias: null,
		undoableAlias: null,
		skipped: [],
		agent: { spawned: true },
		...overrides,
	};
}

describe("status matrix", () => {
	const rows: Array<{
		name: string;
		review: PromptEditReviewStatus;
		status: PromptEditSessionRequestDto["status"];
		waitingOnHuman?: boolean;
		proposalId?: string;
		agentActive: boolean;
		expected: string;
	}> = [
		{ name: "open, no live run", review: "pending", status: "open", agentActive: false, expected: "open" },
		{ name: "open, live run → working", review: "pending", status: "open", agentActive: true, expected: "working" },
		{ name: "waiting beats open", review: "pending", status: "open", waitingOnHuman: true, agentActive: true, expected: "waiting" },
		{ name: "proposal-ready → ready", review: "pending", status: "proposal-ready", proposalId: "tx", agentActive: true, expected: "ready" },
		{ name: "waiting beats proposal-ready", review: "pending", status: "proposal-ready", proposalId: "tx", waitingOnHuman: true, agentActive: true, expected: "waiting" },
		{ name: "done with proposal → ready (awaiting review)", review: "pending", status: "done", proposalId: "tx", agentActive: true, expected: "ready" },
		{ name: "done without proposal → resolved", review: "pending", status: "done", agentActive: true, expected: "resolved" },
		{ name: "declined by agent → declined", review: "pending", status: "declined", agentActive: true, expected: "declined" },
		{ name: "disposed requests never wait", review: "pending", status: "done", proposalId: "tx", waitingOnHuman: true, agentActive: true, expected: "ready" },
		{ name: "review applied wins", review: "applied", status: "done", proposalId: "tx", agentActive: true, expected: "applied" },
		{ name: "review rejected → declined", review: "rejected", status: "declined", agentActive: true, expected: "declined" },
		{ name: "review undone → ready (re-staged)", review: "undone", status: "done", proposalId: "tx", agentActive: true, expected: "ready" },
	];

	for (const row of rows) {
		test(row.name, () => {
			expect(
				toLabRequestStatus(
					{
						status: row.status,
						review: row.review,
						waitingOnHuman: row.waitingOnHuman ?? false,
						...(row.proposalId !== undefined
							? { proposalId: row.proposalId }
							: {}),
					},
					row.agentActive,
				),
			).toBe(row.expected as never);
		});
	}
});

describe("authors and agent activity", () => {
	test("human → you; agent and system → agent", () => {
		expect(toLabAuthor("human")).toBe("you");
		expect(toLabAuthor("agent")).toBe("agent");
		expect(toLabAuthor("system")).toBe("agent");
	});

	test("agent is active only while running, spawned, error-free", () => {
		expect(isAgentActive(makeState())).toBe(true);
		expect(isAgentActive(makeState({ status: "completed" }))).toBe(false);
		expect(isAgentActive(makeState({ agent: { spawned: false } }))).toBe(false);
		expect(
			isAgentActive(makeState({ agent: { spawned: true, error: "boom" } })),
		).toBe(false);
	});
});

describe("targets", () => {
	test("session doc ↔ lab null", () => {
		expect(toLabTarget({ kind: "doc" }, DOC)).toBeNull();
		expect(toSessionTarget(null)).toEqual({ kind: "doc" });
	});

	test("node and range round-trip through the lab shape", () => {
		expect(toLabTarget({ kind: "node", nodeId: "para-0" }, DOC)).toEqual({
			kind: "prompt-node",
			docId: DOC,
			nodeId: "para-0",
		});
		expect(
			toSessionTarget({ kind: "prompt-node", docId: DOC, nodeId: "para-0" }),
		).toEqual({ kind: "node", nodeId: "para-0" });
		expect(
			toLabTarget(
				{ kind: "range", nodeId: "para-0", start: 2, end: 9, quote: "quote" },
				DOC,
			),
		).toEqual({
			kind: "prompt-range",
			docId: DOC,
			nodeId: "para-0",
			start: 2,
			end: 9,
			quote: "quote",
		});
		expect(
			toSessionTarget({
				kind: "prompt-range",
				docId: DOC,
				nodeId: "para-0",
				start: 2,
				end: 9,
				quote: "quote",
			}),
		).toEqual({ kind: "range", nodeId: "para-0", start: 2, end: 9, quote: "quote" });
	});

	test("lab whole-document encoding (nodeId === docId) reads as doc", () => {
		expect(
			toSessionTarget({ kind: "prompt-node", docId: DOC, nodeId: DOC }),
		).toEqual({ kind: "doc" });
	});

	test("range without a quote gains an empty one (lab schema requires it)", () => {
		expect(
			toLabTarget({ kind: "range", nodeId: "para-0", start: 0, end: 4 }, DOC),
		).toEqual({
			kind: "prompt-range",
			docId: DOC,
			nodeId: "para-0",
			start: 0,
			end: 4,
			quote: "",
		});
	});

	test("null lab target posts as the sidecar's nodeId===docId encoding", () => {
		expect(toAnnotationTarget(null, DOC)).toEqual({
			kind: "prompt-node",
			docId: DOC,
			nodeId: DOC,
		});
	});
});

describe("proposal windowing", () => {
	const proposals = [
		makeProposal("R1"),
		makeProposal("R2"),
		makeProposal("R3"),
	];

	test("nothing accepted: the full staged list, front first", () => {
		const window = windowProposals({ proposals, nextAcceptAlias: "R1" });
		expect(window.map((p) => p.requestAlias)).toEqual(["R1", "R2", "R3"]);
	});

	test("after one accept the applied proposal is removed", () => {
		const window = windowProposals({
			proposals: [
				makeProposal("R1", { review: "applied" }),
				proposals[1]!,
				proposals[2]!,
			],
			nextAcceptAlias: "R2",
		});
		expect(window.map((p) => p.requestAlias)).toEqual(["R2", "R3"]);
	});

	test("everything accepted: empty window", () => {
		expect(
			windowProposals({
				proposals: proposals.map((p) => ({ ...p, review: "applied" as const })),
				nextAcceptAlias: null,
			}),
		).toEqual([]);
	});

	test("an undone proposal re-enters at the front", () => {
		const window = windowProposals({
			proposals: [
				makeProposal("R1", { review: "applied" }),
				makeProposal("R2", { review: "undone" }),
				proposals[2]!,
			],
			nextAcceptAlias: "R2",
		});
		expect(window.map((p) => p.requestAlias)).toEqual(["R2", "R3"]);
	});
});

describe("toLabSessionData", () => {
	test("maps requests + windowed proposals + undoableAlias", () => {
		const state = makeState({
			requests: [
				makeRequest({ alias: "R1", status: "done", proposalId: "tx-R1", review: "applied" }),
				makeRequest({ alias: "R2", annotationId: "ann-2", status: "done", proposalId: "tx-R2" }),
			],
			proposals: [
				makeProposal("R1", { review: "applied" }),
				makeProposal("R2"),
			],
			nextAcceptAlias: "R2",
			undoableAlias: "R1",
		});
		const data = toLabSessionData(state, DOC);
		expect(data.requests.map((r) => r.status)).toEqual(["applied", "ready"]);
		expect(data.proposals.map((p) => p.requestAlias)).toEqual(["R2"]);
		expect(data.proposals[0]!.annotationId).toBe("ann-2");
		expect(data.undoableAlias).toBe("R1");
	});
});

describe("annotationsToLabRequests", () => {
	function makeAnnotation(
		overrides: Partial<PromptAnnotation> = {},
	): PromptAnnotation {
		return {
			id: "ann-1",
			target: { kind: "prompt-node", docId: DOC, nodeId: "para-0" },
			body: "Tighten this.",
			intent: "agent-request",
			author: "ford",
			status: "open",
			createdAt: "2026-07-31T00:00:00.000Z",
			...overrides,
		};
	}

	test("open agent-requests become R-aliased cards in sidecar order", () => {
		const requests = annotationsToLabRequests([
			makeAnnotation({ id: "a" }),
			makeAnnotation({ id: "b", status: "resolved" }),
			makeAnnotation({ id: "c", intent: "note" }),
			makeAnnotation({ id: "d", author: "agent" }),
		]);
		expect(requests.map((r) => r.alias)).toEqual(["R1", "R2"]);
		expect(requests.map((r) => r.annotationId)).toEqual(["a", "d"]);
		expect(requests.map((r) => r.author)).toEqual(["you", "agent"]);
		expect(requests.every((r) => r.status === "open")).toBe(true);
	});

	test("threads carry through with mapped voices", () => {
		const requests = annotationsToLabRequests([
			makeAnnotation({
				replies: [
					{ id: "r1", author: "agent", body: "Which tone?", createdAt: "t" },
					{ id: "r2", author: "ford", body: "Blunt.", createdAt: "t" },
				],
			}),
		]);
		expect(requests[0]!.thread).toEqual([
			{ author: "agent", body: "Which tone?" },
			{ author: "you", body: "Blunt." },
		]);
	});
});

describe("event reducer", () => {
	test("proposal-staged appends in staging order and re-points the accept cursor", () => {
		let state = makeState();
		state = applySessionEvent(state, {
			type: "proposal-staged",
			sessionId: state.sessionId,
			proposal: makeProposal("R1"),
		});
		expect(state.proposals).toHaveLength(1);
		expect(state.nextAcceptAlias).toBe("R1");
		expect(state.undoableAlias).toBeNull();
	});

	test("re-staging the same alias replaces in place", () => {
		let state = makeState({
			proposals: [makeProposal("R1", { summary: "v1" })],
			nextAcceptAlias: "R1",
		});
		state = applySessionEvent(state, {
			type: "proposal-staged",
			sessionId: state.sessionId,
			proposal: makeProposal("R1", { summary: "v2" }),
		});
		expect(state.proposals).toHaveLength(1);
		expect(state.proposals[0]!.summary).toBe("v2");
	});

	test("proposal-applied marks review, moves currentHash, advances the cursor", () => {
		let state = makeState({
			requests: [makeRequest({ alias: "R1" }), makeRequest({ alias: "R2", annotationId: "ann-2" })],
			proposals: [makeProposal("R1"), makeProposal("R2")],
			nextAcceptAlias: "R1",
		});
		state = applySessionEvent(state, {
			type: "proposal-applied",
			sessionId: state.sessionId,
			alias: "R1",
			transactionId: "tx-R1",
			hash: "hash-1",
		});
		expect(state.currentHash).toBe("hash-1");
		expect(state.requests[0]!.review).toBe("applied");
		expect(state.proposals[0]!.review).toBe("applied");
		expect(state.nextAcceptAlias).toBe("R2");
		expect(state.undoableAlias).toBe("R1");
	});

	test("proposal-applied is idempotent (HTTP reduce + stream echo)", () => {
		const base = makeState({
			proposals: [makeProposal("R1")],
			nextAcceptAlias: "R1",
		});
		const event = {
			type: "proposal-applied" as const,
			sessionId: base.sessionId,
			alias: "R1",
			transactionId: "tx-R1",
			hash: "hash-1",
		};
		const once = applySessionEvent(base, event);
		const twice = applySessionEvent(once, event);
		expect(twice).toEqual(once);
	});

	test("proposal-rejected removes the proposal and closes the request", () => {
		let state = makeState({
			proposals: [makeProposal("R1")],
			nextAcceptAlias: "R1",
		});
		state = applySessionEvent(state, {
			type: "proposal-rejected",
			sessionId: state.sessionId,
			alias: "R1",
			transactionId: "tx-R1",
			note: "Not like this.",
		});
		expect(state.proposals).toHaveLength(0);
		expect(state.nextAcceptAlias).toBeNull();
		expect(state.requests[0]!.review).toBe("rejected");
		expect(state.requests[0]!.status).toBe("declined");
		expect(state.requests[0]!.note).toBe("Not like this.");
	});

	test("proposal-undone re-stages: cursor returns, undoable pops to the previous accept", () => {
		let state = makeState({
			requests: [makeRequest({ alias: "R1" }), makeRequest({ alias: "R2", annotationId: "ann-2" })],
			proposals: [
				makeProposal("R1", { review: "applied" }),
				makeProposal("R2", { review: "applied" }),
			],
			nextAcceptAlias: null,
			undoableAlias: "R2",
		});
		state = applySessionEvent(state, {
			type: "proposal-undone",
			sessionId: state.sessionId,
			alias: "R2",
			transactionId: "tx-R2",
			hash: "hash-undo",
		});
		expect(state.currentHash).toBe("hash-undo");
		expect(state.nextAcceptAlias).toBe("R2");
		expect(state.undoableAlias).toBe("R1");
		expect(state.requests[1]!.review).toBe("undone");
	});

	test("request-updated replaces known aliases and appends new ones", () => {
		let state = makeState();
		state = applySessionEvent(state, {
			type: "request-updated",
			sessionId: state.sessionId,
			request: makeRequest({ alias: "R1", status: "proposal-ready", proposalId: "tx" }),
		});
		expect(state.requests[0]!.status).toBe("proposal-ready");
		state = applySessionEvent(state, {
			type: "request-updated",
			sessionId: state.sessionId,
			request: makeRequest({ alias: "R9", annotationId: "ann-9" }),
		});
		expect(state.requests.map((r) => r.alias)).toEqual(["R1", "R9"]);
	});

	test("session-state replaces wholesale; session-status patches", () => {
		let state = makeState();
		const replacement = makeState({ sessionId: "sess-2" });
		state = applySessionEvent(state, {
			type: "session-state",
			sessionId: "sess-2",
			state: replacement,
		});
		expect(state.sessionId).toBe("sess-2");
		state = applySessionEvent(state, {
			type: "session-status",
			sessionId: "sess-2",
			status: "completed",
		});
		expect(state.status).toBe("completed");
	});
});
