/**
 * Unit tests for the annotation sidecar: round-trip persistence, optimistic
 * concurrency (expectedHash -> conflict + currentHash), target validation
 * against the current PromptDocument (hard gate on add, advisory dangling on
 * list), replies, status flips, agent-run attach, remove, and the live-only
 * prune mechanism. Pure fs-level — a temp bundle directory, no registry.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROMPT_KIT_SCHEMA_VERSION, type PromptDocument } from "@codecaine-ai/prompt-kit";

import {
	addAnnotation,
	addAnnotationReply,
	annotationsSidecarPath,
	attachAgentRunToAnnotation,
	listAnnotations,
	pruneAnnotations,
	removeAnnotation,
	setAnnotationStatus,
} from "./annotation-sidecar";

const DOC_ID = "sidecar-test-prompt";

function makePromptDocument(paragraphs: string[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: DOC_ID,
		title: "Sidecar Test",
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

let bundleDir: string;
let prompt: PromptDocument;

const nodeTarget = { kind: "prompt-node", docId: DOC_ID, nodeId: "para-0" };

function addInput(overrides: Record<string, unknown> = {}) {
	return {
		target: nodeTarget,
		body: "Tighten this paragraph.",
		intent: "agent-request" as const,
		author: "ford",
		...overrides,
	};
}

beforeEach(() => {
	bundleDir = mkdtempSync(join(tmpdir(), "annotation-sidecar-test-"));
	prompt = makePromptDocument(["You are the annotation test agent."]);
});

afterEach(() => {
	rmSync(bundleDir, { recursive: true, force: true });
});

describe("read / list", () => {
	test("missing sidecar is a valid empty state (hash null, no dangling)", async () => {
		const result = await listAnnotations(bundleDir, prompt);
		expect(result).toEqual({
			ok: true,
			annotations: { schemaVersion: 1, annotations: [] },
			hash: null,
			dangling: [],
		});
	});

	test("corrupt JSON answers invalid without throwing", async () => {
		writeFileSync(annotationsSidecarPath(bundleDir), "{ not json", "utf8");
		const result = await listAnnotations(bundleDir, prompt);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0]).toContain("not valid JSON");
	});

	test("dangling is advisory: an entry orphaned by a prompt edit still lists", async () => {
		const added = await addAnnotation(bundleDir, prompt, addInput());
		expect(added.ok).toBe(true);

		// The prompt is edited out-of-band: para-0 no longer exists.
		const edited = {
			...makePromptDocument([]),
		} as PromptDocument;
		const result = await listAnnotations(bundleDir, edited);
		expect(result.ok).toBe(true);
		if (result.ok && added.ok) {
			expect(result.annotations.annotations).toHaveLength(1);
			expect(result.dangling).toEqual([
				{ annotationId: added.annotation.id, reason: 'Node "para-0" no longer exists.' },
			]);
		}
	});
});

describe("addAnnotation", () => {
	test("round-trips through the sidecar at the bundle root", async () => {
		const result = await addAnnotation(bundleDir, prompt, addInput());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.annotation.status).toBe("open");
		expect(result.annotation.intent).toBe("agent-request");
		expect(result.hash).toMatch(/^[0-9a-f]{64}$/);

		// The file lives at <bundle>/annotations.json, beside agent.json.
		expect(existsSync(join(bundleDir, "annotations.json"))).toBe(true);
		const onDisk = JSON.parse(readFileSync(join(bundleDir, "annotations.json"), "utf8"));
		expect(onDisk.schemaVersion).toBe(1);
		expect(onDisk.annotations).toHaveLength(1);

		const listed = await listAnnotations(bundleDir, prompt);
		expect(listed.ok).toBe(true);
		if (listed.ok) {
			expect(listed.annotations.annotations[0].id).toBe(result.annotation.id);
			expect(listed.hash).toBe(result.hash);
			expect(listed.dangling).toEqual([]);
		}
	});

	test("stale expectedHash answers conflict with the current hash", async () => {
		const first = await addAnnotation(bundleDir, prompt, addInput());
		expect(first.ok).toBe(true);
		const second = await addAnnotation(
			bundleDir,
			prompt,
			addInput({ expectedHash: "0".repeat(64) }),
		);
		expect(second.ok).toBe(false);
		if (!second.ok && second.reason === "conflict" && first.ok) {
			expect(second.currentHash).toBe(first.hash);
		} else {
			throw new Error(`expected conflict, got ${JSON.stringify(second)}`);
		}
	});

	test("two writers racing on the same expectedHash: exactly one wins", async () => {
		const first = await addAnnotation(bundleDir, prompt, addInput());
		expect(first.ok).toBe(true);
		if (!first.ok) return;

		const [a, b] = await Promise.all([
			addAnnotation(bundleDir, prompt, addInput({ expectedHash: first.hash })),
			addAnnotation(bundleDir, prompt, addInput({ expectedHash: first.hash })),
		]);
		const outcomes = [a, b];
		expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
		expect(
			outcomes.filter((r) => !r.ok && r.reason === "conflict"),
		).toHaveLength(1);

		const listed = await listAnnotations(bundleDir, prompt);
		if (listed.ok) expect(listed.annotations.annotations).toHaveLength(2);
	});

	test("rejects an unknown nodeId against the current prompt", async () => {
		const result = await addAnnotation(
			bundleDir,
			prompt,
			addInput({ target: { ...nodeTarget, nodeId: "para-99" } }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === "invalid") {
			expect(result.errors[0]).toContain('Node "para-99" no longer exists.');
		} else {
			throw new Error(`expected invalid, got ${JSON.stringify(result)}`);
		}
		expect(existsSync(annotationsSidecarPath(bundleDir))).toBe(false);
	});

	test("rejects a docId that is not the loaded document", async () => {
		const result = await addAnnotation(
			bundleDir,
			prompt,
			addInput({ target: { ...nodeTarget, docId: "some-other-doc" } }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === "invalid") {
			expect(result.errors[0]).toContain('targets document "some-other-doc"');
		}
	});

	test("rejects a structurally invalid target", async () => {
		const result = await addAnnotation(
			bundleDir,
			prompt,
			addInput({ target: { kind: "prompt-node", docId: DOC_ID } }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === "invalid") {
			expect(result.errors.join("; ")).toContain("nodeId");
		}
	});

	test("range target: matching quote accepted, drifted quote rejected", async () => {
		const good = await addAnnotation(
			bundleDir,
			prompt,
			addInput({
				target: {
					kind: "prompt-range",
					docId: DOC_ID,
					nodeId: "para-0",
					start: 0,
					end: 15,
					quote: "annotation test",
				},
			}),
		);
		expect(good.ok).toBe(true);

		const drifted = await addAnnotation(
			bundleDir,
			prompt,
			addInput({
				target: {
					kind: "prompt-range",
					docId: DOC_ID,
					nodeId: "para-0",
					start: 0,
					end: 15,
					quote: "text that was never there",
				},
			}),
		);
		expect(drifted.ok).toBe(false);
		if (!drifted.ok && drifted.reason === "invalid") {
			expect(drifted.errors[0]).toContain("Selected text no longer matches.");
		}
	});
});

describe("replies / status / agent-run", () => {
	test("replies append in order with generated ids", async () => {
		const added = await addAnnotation(bundleDir, prompt, addInput());
		if (!added.ok) throw new Error("add failed");

		const first = await addAnnotationReply(bundleDir, added.annotation.id, {
			author: "agent",
			body: "Which direction — shorter or more specific?",
		});
		expect(first.ok).toBe(true);
		const second = await addAnnotationReply(bundleDir, added.annotation.id, {
			author: "ford",
			body: "Shorter.",
		});
		expect(second.ok).toBe(true);
		if (second.ok) {
			const replies = second.annotation.replies ?? [];
			expect(replies.map((reply) => [reply.author, reply.body])).toEqual([
				["agent", "Which direction — shorter or more specific?"],
				["ford", "Shorter."],
			]);
		}
	});

	test("reply to an unknown annotation answers annotation-not-found", async () => {
		const result = await addAnnotationReply(bundleDir, "missing-id", {
			author: "ford",
			body: "hello?",
		});
		expect(result).toEqual({
			ok: false,
			reason: "annotation-not-found",
			annotationId: "missing-id",
		});
	});

	test("resolve persists the note; re-open clears it", async () => {
		const added = await addAnnotation(bundleDir, prompt, addInput());
		if (!added.ok) throw new Error("add failed");

		const resolved = await setAnnotationStatus(bundleDir, added.annotation.id, {
			status: "resolved",
			resolution: "Rewrote the paragraph by hand.",
		});
		expect(resolved.ok).toBe(true);
		if (resolved.ok) {
			expect(resolved.annotation.status).toBe("resolved");
			expect(resolved.annotation.resolution).toBe("Rewrote the paragraph by hand.");
		}

		const reopened = await setAnnotationStatus(bundleDir, added.annotation.id, {
			status: "open",
		});
		expect(reopened.ok).toBe(true);
		if (reopened.ok) {
			expect(reopened.annotation.status).toBe("open");
			expect(reopened.annotation.resolution).toBeUndefined();
		}
	});

	test("mutation with a stale expectedHash answers conflict", async () => {
		const added = await addAnnotation(bundleDir, prompt, addInput());
		if (!added.ok) throw new Error("add failed");
		const result = await setAnnotationStatus(bundleDir, added.annotation.id, {
			status: "resolved",
			expectedHash: "0".repeat(64),
		});
		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === "conflict") {
			expect(result.currentHash).toBe(added.hash);
		}
	});

	test("attachAgentRun records the run and flips to resolved", async () => {
		const added = await addAnnotation(bundleDir, prompt, addInput());
		if (!added.ok) throw new Error("add failed");

		const result = await attachAgentRunToAnnotation(bundleDir, added.annotation.id, {
			sessionId: "sess-1",
			patchId: "patch-1",
			summary: "Shortened para-0 to one sentence.",
			changedIds: ["para-0"],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.annotation.status).toBe("resolved");
			expect(result.annotation.agentRun).toEqual({
				sessionId: "sess-1",
				patchId: "patch-1",
				summary: "Shortened para-0 to one sentence.",
				changedIds: ["para-0"],
			});
		}
	});
});

describe("remove / prune (live-only semantics)", () => {
	test("remove deletes the entry; unknown id answers annotation-not-found", async () => {
		const added = await addAnnotation(bundleDir, prompt, addInput());
		if (!added.ok) throw new Error("add failed");

		const removed = await removeAnnotation(bundleDir, added.annotation.id);
		expect(removed.ok).toBe(true);
		if (removed.ok) expect(removed.annotations.annotations).toHaveLength(0);

		const again = await removeAnnotation(bundleDir, added.annotation.id);
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.reason).toBe("annotation-not-found");
	});

	test("prune drops resolved entries and keeps open ones", async () => {
		const keep = await addAnnotation(bundleDir, prompt, addInput({ body: "still open" }));
		const drop = await addAnnotation(bundleDir, prompt, addInput({ body: "done" }));
		if (!keep.ok || !drop.ok) throw new Error("add failed");
		await setAnnotationStatus(bundleDir, drop.annotation.id, { status: "resolved" });

		const pruned = await pruneAnnotations(bundleDir);
		expect(pruned.ok).toBe(true);
		if (pruned.ok) {
			expect(pruned.removed).toBe(1);
			expect(pruned.annotations.annotations.map((a) => a.id)).toEqual([
				keep.annotation.id,
			]);
		}
	});

	test("resolvedOlderThan cutoff: recent resolutions survive, old ones prune", async () => {
		const added = await addAnnotation(bundleDir, prompt, addInput());
		if (!added.ok) throw new Error("add failed");
		await setAnnotationStatus(bundleDir, added.annotation.id, { status: "resolved" });

		// Cutoff in the past: the entry was created after it, so it stays.
		const kept = await pruneAnnotations(bundleDir, {
			resolvedOlderThan: new Date(Date.now() - 60_000).toISOString(),
		});
		expect(kept.ok).toBe(true);
		if (kept.ok) expect(kept.removed).toBe(0);

		// Cutoff in the future: the entry is older, so it prunes.
		const gone = await pruneAnnotations(bundleDir, {
			resolvedOlderThan: new Date(Date.now() + 60_000).toISOString(),
		});
		expect(gone.ok).toBe(true);
		if (gone.ok) {
			expect(gone.removed).toBe(1);
			expect(gone.annotations.annotations).toHaveLength(0);
		}
	});

	test("prune rejects a malformed cutoff", async () => {
		const result = await pruneAnnotations(bundleDir, { resolvedOlderThan: "yesterday-ish" });
		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === "invalid") {
			expect(result.errors[0]).toContain("resolvedOlderThan");
		}
	});

	test("a no-op prune on a missing sidecar does not create the file", async () => {
		const result = await pruneAnnotations(bundleDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.removed).toBe(0);
			expect(result.hash).toBeNull();
		}
		expect(existsSync(annotationsSidecarPath(bundleDir))).toBe(false);
	});
});
