/**
 * Unit tests for the annotation→request adapter: target mapping (node, range,
 * whole-document encodings), the open/agent-request gate, doc-mismatch and
 * dangling skips, author/thread role mapping, and sidecar-order preservation.
 * The cross-track path (real sidecar ops → launch → bundle context) lives in
 * catalog/prompt-edit-integration.test.ts.
 */
import { describe, expect, test } from "bun:test";

import type { PromptAnnotation } from "@codecaine-ai/prompt-kit/annotations";

import { promptEditRequestsFromAnnotations } from "./from-annotations";

const DOC_ID = "doc-1";
const doc = { id: DOC_ID };

function annotation(overrides: Partial<PromptAnnotation> = {}): PromptAnnotation {
	return {
		id: "ann-1",
		target: { kind: "prompt-node", docId: DOC_ID, nodeId: "par-1" },
		body: "Tighten this.",
		intent: "agent-request",
		author: "ford",
		status: "open",
		createdAt: "2026-07-31T00:00:00.000Z",
		...overrides,
	};
}

describe("promptEditRequestsFromAnnotations", () => {
	test("maps a prompt-node target to a node request carrying the annotation id", () => {
		const { requests, skipped } = promptEditRequestsFromAnnotations(
			[annotation()],
			doc,
		);
		expect(skipped).toEqual([]);
		expect(requests).toEqual([
			{
				id: "ann-1",
				target: { kind: "node", nodeId: "par-1" },
				body: "Tighten this.",
				author: "human",
			},
		]);
	});

	test("nodeId===docId on a prompt-node target is the whole-document request", () => {
		const { requests } = promptEditRequestsFromAnnotations(
			[
				annotation({
					target: { kind: "prompt-node", docId: DOC_ID, nodeId: DOC_ID },
				}),
			],
			doc,
		);
		expect(requests[0]?.target).toEqual({ kind: "doc" });
	});

	test("preserves start/end/quote on range targets, including whole-document ranges", () => {
		const { requests } = promptEditRequestsFromAnnotations(
			[
				annotation({
					id: "ann-r",
					target: {
						kind: "prompt-range",
						docId: DOC_ID,
						nodeId: "par-2",
						start: 3,
						end: 9,
						quote: "answer",
					},
				}),
				annotation({
					id: "ann-doc-range",
					target: {
						kind: "prompt-range",
						docId: DOC_ID,
						nodeId: DOC_ID,
						start: 0,
						end: 5,
						quote: "You a",
					},
				}),
			],
			doc,
		);
		expect(requests.map((request) => request.target)).toEqual([
			{ kind: "range", nodeId: "par-2", start: 3, end: 9, quote: "answer" },
			// A whole-document range stays a range — collapsing to doc-level
			// would discard the offsets and quote prompt-kit sanctions for it.
			{ kind: "range", nodeId: DOC_ID, start: 0, end: 5, quote: "You a" },
		]);
	});

	test("skips resolved, note-intent, doc-mismatched, and dangling annotations with reasons", () => {
		const { requests, skipped } = promptEditRequestsFromAnnotations(
			[
				annotation({ id: "a-resolved", status: "resolved" }),
				annotation({ id: "a-note", intent: "note" }),
				annotation({
					id: "a-other-doc",
					target: { kind: "prompt-node", docId: "other-doc", nodeId: "par-1" },
				}),
				annotation({ id: "a-dangling" }),
				annotation({ id: "a-live" }),
			],
			doc,
			{
				dangling: [
					{ annotationId: "a-dangling", reason: 'Node "par-1" no longer exists.' },
				],
			},
		);
		expect(requests.map((request) => request.id)).toEqual(["a-live"]);
		expect(skipped).toEqual([
			{ annotationId: "a-resolved", reason: "not-open", detail: 'status is "resolved"' },
			{ annotationId: "a-note", reason: "not-agent-request", detail: 'intent is "note"' },
			{
				annotationId: "a-other-doc",
				reason: "doc-mismatch",
				detail: 'target document "other-doc" is not "doc-1"',
			},
			{
				annotationId: "a-dangling",
				reason: "dangling-target",
				detail: 'Node "par-1" no longer exists.',
			},
		]);
	});

	test("maps free-form authors to human, keeps the literal roles, and carries threads", () => {
		const { requests } = promptEditRequestsFromAnnotations(
			[
				annotation({
					author: "agent",
					replies: [
						{
							id: "r1",
							author: "ford",
							body: "More detail here.",
							createdAt: "2026-07-31T01:00:00.000Z",
						},
						{
							id: "r2",
							author: "system",
							body: "Auto-flagged.",
							createdAt: "2026-07-31T02:00:00.000Z",
						},
					],
				}),
			],
			doc,
		);
		expect(requests[0]?.author).toBe("agent");
		expect(requests[0]?.thread).toEqual([
			{ author: "human", body: "More detail here.", createdAt: "2026-07-31T01:00:00.000Z" },
			{ author: "system", body: "Auto-flagged.", createdAt: "2026-07-31T02:00:00.000Z" },
		]);
	});

	test("scopeIds narrows the queue and reports everything else out-of-scope", () => {
		const { requests, skipped } = promptEditRequestsFromAnnotations(
			[annotation({ id: "a" }), annotation({ id: "b" }), annotation({ id: "c" })],
			doc,
			{ scopeIds: ["b"] },
		);
		// Run-now shape: exactly the scoped request, so its alias becomes R1.
		expect(requests.map((request) => request.id)).toEqual(["b"]);
		expect(skipped).toEqual([
			{ annotationId: "a", reason: "out-of-scope", detail: "not in the requested scope" },
			{ annotationId: "c", reason: "out-of-scope", detail: "not in the requested scope" },
		]);
	});

	test("a scoped batch keeps sidecar order regardless of the order of the ids", () => {
		const { requests } = promptEditRequestsFromAnnotations(
			[annotation({ id: "a" }), annotation({ id: "b" }), annotation({ id: "c" })],
			doc,
			{ scopeIds: ["c", "a"] },
		);
		expect(requests.map((request) => request.id)).toEqual(["a", "c"]);
	});

	test("in-scope annotations that fail a later gate keep their specific reason and are not double-reported", () => {
		const { requests, skipped } = promptEditRequestsFromAnnotations(
			[annotation({ id: "gone", status: "resolved" }), annotation({ id: "live" })],
			doc,
			{ scopeIds: ["gone", "live"] },
		);
		expect(requests.map((request) => request.id)).toEqual(["live"]);
		expect(skipped).toEqual([
			{ annotationId: "gone", reason: "not-open", detail: 'status is "resolved"' },
		]);
	});

	test("a scope id that matches no annotation is reported scope-unmatched", () => {
		const { requests, skipped } = promptEditRequestsFromAnnotations(
			[annotation({ id: "live" })],
			doc,
			{ scopeIds: ["live", "never-existed"] },
		);
		expect(requests.map((request) => request.id)).toEqual(["live"]);
		expect(skipped).toEqual([
			{
				annotationId: "never-existed",
				reason: "scope-unmatched",
				detail: "no annotation with this id on the sidecar",
			},
		]);
	});

	test("omitting scopeIds is unchanged: every open agent-request enters the queue", () => {
		const { requests, skipped } = promptEditRequestsFromAnnotations(
			[annotation({ id: "a" }), annotation({ id: "b" })],
			doc,
		);
		expect(requests.map((request) => request.id)).toEqual(["a", "b"]);
		expect(skipped).toEqual([]);
	});

	test("keeps sidecar order so aliases land R1, R2, … in creation order", () => {
		const { requests } = promptEditRequestsFromAnnotations(
			[annotation({ id: "first" }), annotation({ id: "second" }), annotation({ id: "third" })],
			doc,
		);
		expect(requests.map((request) => request.id)).toEqual([
			"first",
			"second",
			"third",
		]);
	});
});
