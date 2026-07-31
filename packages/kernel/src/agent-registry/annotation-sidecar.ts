/**
 * Annotation sidecar — persistent, live-only annotation storage for a
 * prompt bundle. Each agent bundle carries an `annotations.json` at its ROOT
 * (`catalog/<agent>/annotations.json`, beside `agent.json`, for both the
 * file-form and folder-form prompt layouts; see bundle-layout.ts).
 *
 * "Live-only" is deliberate: the sidecar holds open/active annotations on
 * the CURRENT prompt. Agent-run history belongs to traces and the
 * prompt_revisions chain — resolved entries are prunable via
 * `pruneAnnotations`, and nothing here is an audit log.
 *
 * Concurrency discipline (ported from docs-system doc-ops):
 *   - every read-check-apply-write sequence runs inside an in-process async
 *     mutex keyed on the sidecar's absolute path, so two concurrent callers
 *     can never both pass the hash check against the same pre-write state;
 *   - mutations take an optional `expectedHash` (SHA-256 of the on-disk
 *     bytes) and answer a conflict carrying `currentHash` when stale;
 *   - writes are atomic (write temp + rename, same directory);
 *   - a missing file is a valid empty document, never an error;
 *   - every accepted write revalidates the FULL resulting document against
 *     the prompt-kit annotation schema before any bytes touch disk.
 *
 * Target validation: `addAnnotation` validates the new annotation's target
 * against the CURRENT PromptDocument — an unknown nodeId (or a range quote
 * that no longer matches) is a hard validation error. For entries already
 * on disk the same check is advisory only: `listAnnotations` reports them
 * as `dangling` without failing, since prompt edits happen out-of-band.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import {
	promptAnnotationSchema,
	type AnnotationAgentRun,
	type AnnotationReply,
	type DanglingTarget,
	type PromptAnnotation,
	type PromptAnnotationIntent,
	type PromptAnnotationsDocument,
	type PromptAnnotationStatus,
	type PromptAnnotationTarget,
} from "@codecaine-ai/prompt-kit/annotations";

export const ANNOTATIONS_SIDECAR_FILENAME = "annotations.json";

/** The sidecar path for a bundle directory (the agent.json's parent). */
export function annotationsSidecarPath(bundleDir: string): string {
	return join(bundleDir, ANNOTATIONS_SIDECAR_FILENAME);
}

export const EMPTY_PROMPT_ANNOTATIONS_DOCUMENT: PromptAnnotationsDocument = {
	schemaVersion: 1,
	annotations: [],
};

// ---------------------------------------------------------------------------
// Concurrency + persistence primitives (kernel-local port of the docs-server
// path-mutex / atomic-write / content-hash trio — Bun runs single-process, so
// an in-process mutex fully serializes the critical section).
// ---------------------------------------------------------------------------

const lockTails = new Map<string, Promise<unknown>>();

function withPathLock<T>(absPath: string, fn: () => Promise<T>): Promise<T> {
	const priorTail = lockTails.get(absPath) ?? Promise.resolve();
	// Swallow the prior tail's rejection so one failed critical section never
	// poisons the ones queued behind it.
	const run = priorTail.catch(() => undefined).then(() => fn());
	const settled = run.then(
		() => undefined,
		() => undefined,
	);
	lockTails.set(absPath, settled);
	return run.finally(() => {
		if (lockTails.get(absPath) === settled) lockTails.delete(absPath);
	});
}

function contentHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/** Write temp + rename (same directory, hence atomic on POSIX). */
async function atomicWriteFile(absPath: string, content: string): Promise<void> {
	await mkdir(dirname(absPath), { recursive: true });
	const tempPath = `${absPath}.tmp-${randomUUID()}`;
	try {
		await writeFile(tempPath, content, "utf8");
		await rename(tempPath, absPath);
	} catch (error) {
		try {
			await unlink(tempPath);
		} catch {
			// best-effort cleanup
		}
		throw error;
	}
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export type AnnotationSidecarReadResult =
	| { ok: true; annotations: PromptAnnotationsDocument; hash: string | null }
	| { ok: false; reason: "invalid"; errors: string[] };

/**
 * Reads + validates a bundle's sidecar. Absence is a valid empty state
 * (hash null, so the first optimistic write can assert "still absent").
 */
export async function readAnnotationsSidecar(
	bundleDir: string,
): Promise<AnnotationSidecarReadResult> {
	const abs = annotationsSidecarPath(bundleDir);
	let raw: string;
	try {
		raw = await readFile(abs, "utf8");
	} catch {
		return { ok: true, annotations: EMPTY_PROMPT_ANNOTATIONS_DOCUMENT, hash: null };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			reason: "invalid",
			errors: [`${ANNOTATIONS_SIDECAR_FILENAME} is not valid JSON`],
		};
	}
	const validated = promptAnnotationSchema.validateDocument(parsed);
	if (!validated.ok) {
		return {
			ok: false,
			reason: "invalid",
			errors: validated.issues.map((issue) => `${issue.path}: ${issue.message}`),
		};
	}
	return { ok: true, annotations: validated.document, hash: contentHash(raw) };
}

async function writeSidecar(
	bundleDir: string,
	document: PromptAnnotationsDocument,
): Promise<string> {
	const content = `${JSON.stringify(document, null, 2)}\n`;
	await atomicWriteFile(annotationsSidecarPath(bundleDir), content);
	return contentHash(content);
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type AnnotationSidecarFailure =
	| { ok: false; reason: "conflict"; currentHash: string | null }
	| { ok: false; reason: "invalid"; errors: string[] }
	| { ok: false; reason: "annotation-not-found"; annotationId: string };

export type AnnotationSidecarListResult =
	| {
			ok: true;
			annotations: PromptAnnotationsDocument;
			hash: string | null;
			/** Advisory: entries whose targets no longer resolve on the CURRENT prompt. */
			dangling: DanglingTarget[];
	  }
	| { ok: false; reason: "invalid"; errors: string[] };

export type AnnotationSidecarMutationResult =
	| {
			ok: true;
			/** The annotation the mutation created or touched. */
			annotation: PromptAnnotation;
			annotations: PromptAnnotationsDocument;
			hash: string;
	  }
	| AnnotationSidecarFailure;

export type AnnotationSidecarRemoveResult =
	| { ok: true; annotations: PromptAnnotationsDocument; hash: string }
	| AnnotationSidecarFailure;

export type AnnotationSidecarPruneResult =
	| {
			ok: true;
			removed: number;
			annotations: PromptAnnotationsDocument;
			/** Null only when nothing was pruned and no sidecar exists yet. */
			hash: string | null;
	  }
	| AnnotationSidecarFailure;

function conflict(currentHash: string | null): AnnotationSidecarFailure {
	return { ok: false, reason: "conflict", currentHash };
}

function danglingIndexes(prompt: PromptDocument | null): Record<string, unknown> {
	return { "prompt-node": prompt, "prompt-range": prompt };
}

/** Revalidate a candidate next document; shared write gate for every mutation. */
function validateNext(
	document: PromptAnnotationsDocument,
):
	| { ok: true; document: PromptAnnotationsDocument }
	| { ok: false; reason: "invalid"; errors: string[] } {
	const validated = promptAnnotationSchema.validateDocument(document);
	if (!validated.ok) {
		return {
			ok: false,
			reason: "invalid",
			errors: validated.issues.map((issue) => `${issue.path}: ${issue.message}`),
		};
	}
	return { ok: true, document: validated.document };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Lists the sidecar plus an advisory dangling report against the current
 * prompt (pass null when the prompt is unavailable to skip the check).
 */
export async function listAnnotations(
	bundleDir: string,
	currentPrompt: PromptDocument | null,
): Promise<AnnotationSidecarListResult> {
	const existing = await readAnnotationsSidecar(bundleDir);
	if (!existing.ok) return existing;
	return {
		ok: true,
		annotations: existing.annotations,
		hash: existing.hash,
		dangling: promptAnnotationSchema.detectDanglingTargets(
			existing.annotations,
			danglingIndexes(currentPrompt),
		),
	};
}

export interface AddAnnotationInput {
	/** Validated against the prompt annotation schema's target adapters. */
	target: unknown;
	body: string;
	intent: PromptAnnotationIntent;
	author: string;
	expectedHash?: string;
}

/**
 * Appends an open annotation. The target must validate structurally AND
 * resolve against the CURRENT PromptDocument — an unknown nodeId, a docId
 * mismatch, or a range quote that no longer matches is rejected as invalid.
 */
export async function addAnnotation(
	bundleDir: string,
	currentPrompt: PromptDocument,
	input: AddAnnotationInput,
): Promise<AnnotationSidecarMutationResult> {
	return withPathLock(annotationsSidecarPath(bundleDir), async () => {
		const existing = await readAnnotationsSidecar(bundleDir);
		if (!existing.ok) return existing;
		if (input.expectedHash !== undefined && input.expectedHash !== existing.hash) {
			return conflict(existing.hash);
		}

		const annotation: PromptAnnotation = {
			id: randomUUID(),
			target: input.target as PromptAnnotationTarget,
			body: input.body,
			intent: input.intent,
			author: input.author,
			status: "open" satisfies PromptAnnotationStatus,
			createdAt: new Date().toISOString(),
		};
		const next = validateNext({
			schemaVersion: 1,
			annotations: [...existing.annotations.annotations, annotation],
		});
		if (!next.ok) return next;

		// Hard gate for NEW entries only: the target must resolve right now.
		const dangling = promptAnnotationSchema.detectDanglingTargets(
			{ schemaVersion: 1, annotations: [annotation] },
			danglingIndexes(currentPrompt),
		);
		if (dangling.length > 0) {
			return {
				ok: false,
				reason: "invalid",
				errors: dangling.map((entry) => `target: ${entry.reason}`),
			};
		}

		const hash = await writeSidecar(bundleDir, next.document);
		return { ok: true, annotation, annotations: next.document, hash };
	});
}

export interface AddAnnotationReplyInput {
	author: string;
	body: string;
	expectedHash?: string;
}

/** Appends a reply to an annotation's thread. */
export async function addAnnotationReply(
	bundleDir: string,
	annotationId: string,
	input: AddAnnotationReplyInput,
): Promise<AnnotationSidecarMutationResult> {
	return mutateAnnotation(bundleDir, annotationId, input.expectedHash, (annotation) => {
		const reply: AnnotationReply = {
			id: randomUUID(),
			author: input.author,
			body: input.body,
			createdAt: new Date().toISOString(),
		};
		return { ...annotation, replies: [...(annotation.replies ?? []), reply] };
	});
}

export interface SetAnnotationStatusInput {
	status: PromptAnnotationStatus;
	/** Optional resolution note persisted when resolving with a response. */
	resolution?: string;
	expectedHash?: string;
}

/**
 * Flips an annotation's status (resolve, or re-open). Resolving may carry a
 * resolution note; re-opening clears any prior one.
 */
export async function setAnnotationStatus(
	bundleDir: string,
	annotationId: string,
	input: SetAnnotationStatusInput,
): Promise<AnnotationSidecarMutationResult> {
	return mutateAnnotation(bundleDir, annotationId, input.expectedHash, (annotation) => {
		const { resolution: _dropped, ...rest } = annotation;
		return {
			...rest,
			status: input.status,
			...(input.status === "resolved" && input.resolution !== undefined
				? { resolution: input.resolution }
				: {}),
		};
	});
}

export interface AttachAgentRunInput {
	sessionId: string;
	patchId: string;
	summary: string;
	changedIds?: string[];
	expectedHash?: string;
}

/**
 * Records a completed agent run on its originating annotation and flips it
 * to resolved. No hash precondition by default (mirrors docs-server): the
 * caller's apply path has already enforced its preconditions on the PROMPT
 * being edited — this only writes the sidecar, and the path lock prevents
 * racing a concurrent annotation mutation.
 */
export async function attachAgentRunToAnnotation(
	bundleDir: string,
	annotationId: string,
	input: AttachAgentRunInput,
): Promise<AnnotationSidecarMutationResult> {
	return mutateAnnotation(bundleDir, annotationId, input.expectedHash, (annotation) => {
		const agentRun: AnnotationAgentRun = {
			sessionId: input.sessionId,
			patchId: input.patchId,
			summary: input.summary,
			...(input.changedIds ? { changedIds: input.changedIds } : {}),
		};
		return { ...annotation, status: "resolved" satisfies PromptAnnotationStatus, agentRun };
	});
}

/** Deletes one annotation outright (a discarded note, not a resolution). */
export async function removeAnnotation(
	bundleDir: string,
	annotationId: string,
	expectedHash?: string,
): Promise<AnnotationSidecarRemoveResult> {
	return withPathLock(annotationsSidecarPath(bundleDir), async () => {
		const existing = await readAnnotationsSidecar(bundleDir);
		if (!existing.ok) return existing;
		if (expectedHash !== undefined && expectedHash !== existing.hash) {
			return conflict(existing.hash);
		}
		const remaining = existing.annotations.annotations.filter(
			(annotation) => annotation.id !== annotationId,
		);
		if (remaining.length === existing.annotations.annotations.length) {
			return { ok: false, reason: "annotation-not-found", annotationId };
		}
		const next = validateNext({ schemaVersion: 1, annotations: remaining });
		if (!next.ok) return next;
		const hash = await writeSidecar(bundleDir, next.document);
		return { ok: true, annotations: next.document, hash };
	});
}

export interface PruneAnnotationsInput {
	/**
	 * ISO timestamp cutoff: only resolved annotations CREATED before this
	 * instant are pruned. Omit to prune every resolved annotation. (The shared
	 * schema records no resolvedAt, so createdAt is the available clock.)
	 */
	resolvedOlderThan?: string;
	expectedHash?: string;
}

/**
 * The "live-only" mechanism: drops resolved annotations from the sidecar.
 * Their history lives on in traces and the prompt_revisions chain — the
 * sidecar only ever owes its host the open/active set.
 */
export async function pruneAnnotations(
	bundleDir: string,
	input: PruneAnnotationsInput = {},
): Promise<AnnotationSidecarPruneResult> {
	return withPathLock(annotationsSidecarPath(bundleDir), async () => {
		const existing = await readAnnotationsSidecar(bundleDir);
		if (!existing.ok) return existing;
		if (input.expectedHash !== undefined && input.expectedHash !== existing.hash) {
			return conflict(existing.hash);
		}
		const cutoff =
			input.resolvedOlderThan !== undefined ? Date.parse(input.resolvedOlderThan) : null;
		if (cutoff !== null && Number.isNaN(cutoff)) {
			return {
				ok: false,
				reason: "invalid",
				errors: ["resolvedOlderThan: expected an ISO-8601 timestamp"],
			};
		}
		const remaining = existing.annotations.annotations.filter((annotation) => {
			if (annotation.status !== "resolved") return true;
			if (cutoff === null) return false;
			return Date.parse(annotation.createdAt) >= cutoff;
		});
		const removed = existing.annotations.annotations.length - remaining.length;
		if (removed === 0) {
			// No-op: leave the on-disk bytes (or absence) untouched.
			return { ok: true, removed: 0, annotations: existing.annotations, hash: existing.hash };
		}
		const next = validateNext({ schemaVersion: 1, annotations: remaining });
		if (!next.ok) return next;
		const hash = await writeSidecar(bundleDir, next.document);
		return { ok: true, removed, annotations: next.document, hash };
	});
}

// ---------------------------------------------------------------------------

/**
 * Shared read-check-apply-write path for single-annotation mutations:
 * path lock -> read+validate -> hash precondition -> locate -> transform ->
 * full-document revalidation -> atomic write.
 */
async function mutateAnnotation(
	bundleDir: string,
	annotationId: string,
	expectedHash: string | undefined,
	transform: (annotation: PromptAnnotation) => PromptAnnotation,
): Promise<AnnotationSidecarMutationResult> {
	return withPathLock(annotationsSidecarPath(bundleDir), async () => {
		const existing = await readAnnotationsSidecar(bundleDir);
		if (!existing.ok) return existing;
		if (expectedHash !== undefined && expectedHash !== existing.hash) {
			return conflict(existing.hash);
		}
		const index = existing.annotations.annotations.findIndex(
			(annotation) => annotation.id === annotationId,
		);
		if (index < 0) {
			return { ok: false, reason: "annotation-not-found", annotationId };
		}
		const updated = transform(existing.annotations.annotations[index]);
		const nextAnnotations = existing.annotations.annotations.map(
			(annotation, position) => (position === index ? updated : annotation),
		);
		const next = validateNext({ schemaVersion: 1, annotations: nextAnnotations });
		if (!next.ok) return next;
		const hash = await writeSidecar(bundleDir, next.document);
		// Serve the revalidated (normalized) annotation, not the raw transform.
		const annotation =
			next.document.annotations.find((entry) => entry.id === annotationId) ?? updated;
		return { ok: true, annotation, annotations: next.document, hash };
	});
}
