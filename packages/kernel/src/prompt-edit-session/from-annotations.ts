/**
 * prompt-edit-session/from-annotations — the annotation→request adapter
 * between the sidecar (agent-registry/annotation-sidecar.ts, prompt-kit
 * `Annotation<PromptAnnotationTarget>`) and the session's request inputs.
 *
 * Only OPEN annotations with intent "agent-request" become requests — notes
 * are ambient context and resolved threads are history. An optional `scopeIds`
 * allowlist narrows that further to an explicit set of annotation ids, which is
 * what makes a session single-request ("run now") or batch-scoped ("apply these
 * N"). Everything else is
 * reported in `skipped` with a reason, never silently dropped. The request's
 * `id` carries the source annotation id (it lands on the session entry as
 * `annotationId`), so Phase 2's apply path can `attachAgentRunToAnnotation`
 * back onto the sidecar.
 *
 * Target mapping:
 *   prompt-node {docId,nodeId}            → { kind:"node", nodeId }
 *   prompt-node with nodeId===docId       → { kind:"doc" } (the lab's
 *                                           whole-document encoding)
 *   prompt-range {nodeId,start,end,quote} → { kind:"range", … } — start/end/
 *                                           quote preserved. A range with
 *                                           nodeId===docId stays a RANGE:
 *                                           prompt-kit sanctions whole-document
 *                                           ranges (cross-section drags) and
 *                                           collapsing one to doc-level would
 *                                           discard its offsets and quote.
 *   target.docId !== doc.id               → skipped "doc-mismatch"
 *
 * Author adapter: the shared annotation schema's `author` is a free-form name
 * ("ford"), the session's is a closed role set. The literal role strings
 * "agent" / "system" map through; every other name reads as "human". Real
 * authorship on the shared schema is the Phase 3 item (plan §10).
 */
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type {
	DanglingTarget,
	PromptAnnotation,
	PromptAnnotationTarget,
} from "@codecaine-ai/prompt-kit/annotations";

import type {
	PromptEditRequestAuthor,
	PromptEditRequestInput,
	PromptEditTarget,
	PromptEditThreadReply,
} from "./types";

export type SkippedAnnotationReason =
	| "not-open"
	| "not-agent-request"
	| "doc-mismatch"
	| "dangling-target"
	/** A scope was supplied and this annotation is not in it. */
	| "out-of-scope"
	/** A scope id that matched no annotation on the sidecar at all. */
	| "scope-unmatched";

/** One annotation that did not become a request, and why. */
export interface SkippedAnnotation {
	annotationId: string;
	reason: SkippedAnnotationReason;
	detail?: string;
}

export interface PromptEditRequestsFromAnnotations {
	/** In annotation (sidecar) order — creation order, hence R1, R2, … */
	requests: PromptEditRequestInput[];
	skipped: SkippedAnnotation[];
}

export interface PromptEditRequestsFromAnnotationsOptions {
	/**
	 * The sidecar's advisory dangling report (listAnnotations). An open
	 * agent-request whose target no longer resolves is skipped as
	 * "dangling-target" instead of entering the queue pointing at nothing.
	 */
	dangling?: readonly DanglingTarget[];
	/**
	 * REQUEST SCOPE. When present, only annotations whose id is in this set can
	 * become requests — this is what makes a session single-request ("run now")
	 * or batch-scoped ("apply these N"). Everything else on the sidecar is
	 * skipped as "out-of-scope"; a scope id that matches nothing at all is
	 * reported as "scope-unmatched". Omitted (the pre-scope behavior): every
	 * open agent-request enters the queue.
	 *
	 * The scope gate runs BEFORE the open/intent/target gates so an out-of-scope
	 * annotation reports the reason the caller cares about; ids that ARE in
	 * scope but fail a later gate keep their specific reason (not-open,
	 * dangling-target, …) and are not double-reported.
	 */
	scopeIds?: Iterable<string>;
}

function toRole(author: string): PromptEditRequestAuthor {
	return author === "agent" || author === "system" ? author : "human";
}

function toTarget(
	target: PromptAnnotationTarget,
): PromptEditTarget {
	if (target.kind === "prompt-range") {
		return {
			kind: "range",
			nodeId: target.nodeId,
			start: target.start,
			end: target.end,
			quote: target.quote,
		};
	}
	// prompt-node; nodeId===docId is the whole-document encoding.
	return target.nodeId === target.docId
		? { kind: "doc" }
		: { kind: "node", nodeId: target.nodeId };
}

export function promptEditRequestsFromAnnotations(
	annotations: readonly PromptAnnotation[],
	doc: Pick<PromptDocument, "id">,
	options: PromptEditRequestsFromAnnotationsOptions = {},
): PromptEditRequestsFromAnnotations {
	const danglingById = new Map(
		(options.dangling ?? []).map((entry) => [entry.annotationId, entry.reason]),
	);
	const scopeIds =
		options.scopeIds === undefined ? null : new Set(options.scopeIds);
	/** Scope ids observed on the sidecar (whatever their fate) — the leftovers
	 * are the ones that matched nothing and get reported "scope-unmatched". */
	const seenScopeIds = new Set<string>();
	const requests: PromptEditRequestInput[] = [];
	const skipped: SkippedAnnotation[] = [];

	for (const annotation of annotations) {
		if (scopeIds !== null) {
			if (!scopeIds.has(annotation.id)) {
				skipped.push({
					annotationId: annotation.id,
					reason: "out-of-scope",
					detail: "not in the requested scope",
				});
				continue;
			}
			seenScopeIds.add(annotation.id);
		}
		if (annotation.status !== "open") {
			skipped.push({
				annotationId: annotation.id,
				reason: "not-open",
				detail: `status is "${annotation.status}"`,
			});
			continue;
		}
		if (annotation.intent !== "agent-request") {
			skipped.push({
				annotationId: annotation.id,
				reason: "not-agent-request",
				detail: `intent is "${annotation.intent}"`,
			});
			continue;
		}
		if (annotation.target.docId !== doc.id) {
			skipped.push({
				annotationId: annotation.id,
				reason: "doc-mismatch",
				detail: `target document "${annotation.target.docId}" is not "${doc.id}"`,
			});
			continue;
		}
		const danglingReason = danglingById.get(annotation.id);
		if (danglingReason !== undefined) {
			skipped.push({
				annotationId: annotation.id,
				reason: "dangling-target",
				detail: danglingReason,
			});
			continue;
		}

		const thread: PromptEditThreadReply[] = (annotation.replies ?? []).map(
			(reply) => ({
				author: toRole(reply.author),
				body: reply.body,
				createdAt: reply.createdAt,
			}),
		);
		requests.push({
			id: annotation.id,
			target: toTarget(annotation.target),
			body: annotation.body,
			author: toRole(annotation.author),
			...(thread.length > 0 ? { thread } : {}),
		});
	}

	if (scopeIds !== null) {
		// Scope ids nothing on the sidecar answered to. Ids that WERE found but
		// failed a later gate already carry their specific reason above.
		for (const wanted of scopeIds) {
			if (seenScopeIds.has(wanted)) continue;
			skipped.push({
				annotationId: wanted,
				reason: "scope-unmatched",
				detail: "no annotation with this id on the sidecar",
			});
		}
	}

	return { requests, skipped };
}
