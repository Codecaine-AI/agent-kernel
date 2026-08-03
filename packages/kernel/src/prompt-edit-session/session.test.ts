import { describe, expect, test } from "bun:test";
import { hashPrompt } from "@codecaine-ai/prompt-kit";

import {
	createPromptEditSession,
	type CreatePromptEditSessionOptions,
} from "./session";
import type { PromptEditSessionEvent } from "./types";
import { PROMPT_EDIT_DISPOSITION_STATUS } from "./types";
import { fixtureDoc, fixtureRequests } from "./test-fixtures";

function makeSession(
	overrides: Partial<CreatePromptEditSessionOptions> = {},
) {
	return createPromptEditSession({
		targetAgent: "target-agent",
		document: fixtureDoc(),
		requests: fixtureRequests(),
		declaredVariables: ["tone"],
		...overrides,
	});
}

describe("session queue — aliases", () => {
	test("aliases are assigned R1..Rn in request order and stay stable", () => {
		const session = makeSession();
		expect(session.requests().map((entry) => entry.alias)).toEqual([
			"R1",
			"R2",
			"R3",
		]);
		expect(session.requests().map((entry) => entry.annotationId)).toEqual([
			"ann-1",
			"ann-2",
			"ann-3",
		]);
		// Disposing an entry does not renumber the rest.
		const resolved = session.resolve("R2", "declined", "Out of scope.");
		expect(resolved.ok).toBe(true);
		expect(session.requests().map((entry) => entry.alias)).toEqual([
			"R1",
			"R2",
			"R3",
		]);
	});

	test("add_note continues the alias sequence mid-session", () => {
		const session = makeSession();
		const note = session.addNote("par-2", "This duplicates the rules section.");
		if (!note.ok) throw new Error(note.message);
		expect(note.request.alias).toBe("R4");
		expect(note.request.author).toBe("agent");
		expect(note.request.waitingOnHuman).toBe(true);
		// Doc-level note via the document id.
		const docNote = session.addNote("doc-1", "General observation.");
		if (!docNote.ok) throw new Error(docNote.message);
		expect(docNote.request.alias).toBe("R5");
		expect(docNote.request.target).toEqual({ kind: "doc" });
	});
});

describe("propose — staging and the validation bounce", () => {
	test("a valid proposal stages with inherited baseHash and changedIds", async () => {
		const session = makeSession();
		const result = await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["Be direct."] } }],
			"Tighten the opening line.",
		);
		if (!result.ok) throw new Error(JSON.stringify(result.failure));
		expect(result.proposal.baseHash).toBe(session.baseHash);
		expect(result.proposal.changedIds).toEqual(["par-1"]);
		expect(result.proposal.transaction.steps).toEqual(result.proposal.steps);
		expect(result.proposal.renderedBefore).toContain("You are a helpful agent.");
		expect(result.proposal.renderedAfter).toContain("Be direct.");
		expect(session.proposals()).toHaveLength(1);
		expect(session.requests()[0]?.status).toBe("proposal-ready");
		expect(session.requests()[0]?.proposalId).toBe(result.proposal.transactionId);
	});

	test("an invalid op set bounces with compile errors and stages nothing", async () => {
		const session = makeSession();
		const result = await session.propose(
			"R1",
			[{ op: "remove_node", nodeId: "ghost" }],
			"Remove a node that does not exist.",
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.kind).toBe("compile");
		expect(session.proposals()).toHaveLength(0);
		expect(session.requests()[0]?.status).toBe("open");
		expect(hashPrompt(session.workingDocument())).toBe(session.baseHash);
	});

	test("a proposal introducing an undeclared variable bounces as validation", async () => {
		const session = makeSession();
		const result = await session.propose(
			"R1",
			[
				{
					op: "insert_after",
					refNodeId: "par-1",
					node: {
						type: "paragraph",
						content: [{ type: "variable", name: "undeclared" }],
					},
				},
			],
			"Add a variable that is not declared.",
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		if (result.failure.kind !== "validation") {
			throw new Error(`expected validation failure, got ${result.failure.kind}`);
		}
		expect(result.failure.diagnostics[0]?.code).toBe("unknown_variable");
		expect(session.proposals()).toHaveLength(0);
	});

	test("pre-existing base diagnostics are not charged to a proposal", async () => {
		const doc = fixtureDoc();
		doc.nodes.push({
			type: "paragraph",
			id: "par-bad",
			content: [{ type: "variable", name: "alreadyBroken" }],
		});
		const session = makeSession({ document: doc });
		const result = await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["Fine."] } }],
			"Unrelated edit on an already-invalid prompt.",
		);
		expect(result.ok).toBe(true);
	});

	test("proposals chain: later ops compile against the working document", async () => {
		const session = makeSession();
		const first = await session.propose(
			"R1",
			[{ op: "remove_node", nodeId: "par-2" }],
			"Cut the filler rule.",
		);
		expect(first.ok).toBe(true);
		// R2 now edits a document in which par-2 is gone.
		const stale = await session.propose(
			"R2",
			[{ op: "update_node", nodeId: "par-2", patch: { content: ["x"] } }],
			"Edit the node R1 removed.",
		);
		expect(stale.ok).toBe(false);
		if (!stale.ok) expect(stale.failure.kind).toBe("compile");

		const second = await session.propose(
			"R2",
			[
				{
					op: "insert_into",
					parentNodeId: "sec-b",
					index: 0,
					node: { type: "paragraph", id: "fresh-r2", content: ["Replacement."] },
				},
			],
			"Add the replacement rule.",
		);
		if (!second.ok) throw new Error(JSON.stringify(second.failure));
		expect(session.proposals().map((proposal) => proposal.requestAlias)).toEqual([
			"R1",
			"R2",
		]);
	});

	test("only the latest staged proposal can be replaced", async () => {
		const session = makeSession();
		await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["A"] } }],
			"First edit.",
		);
		await session.propose(
			"R2",
			[{ op: "update_node", nodeId: "par-2", patch: { content: ["B"] } }],
			"Second edit.",
		);
		const replaceEarlier = await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["A2"] } }],
			"Try to replace the earlier proposal.",
		);
		expect(replaceEarlier.ok).toBe(false);
		if (!replaceEarlier.ok) {
			expect(replaceEarlier.failure.kind).toBe("proposal_not_latest");
		}
		// Replacing the LATEST works and swaps the staged transaction.
		const before = session.proposals().map((proposal) => proposal.transactionId);
		const replaceLatest = await session.propose(
			"R2",
			[{ op: "update_node", nodeId: "par-2", patch: { content: ["B2"] } }],
			"Replace the latest proposal.",
		);
		if (!replaceLatest.ok) throw new Error(JSON.stringify(replaceLatest.failure));
		const after = session.proposals().map((proposal) => proposal.transactionId);
		expect(after).toHaveLength(2);
		expect(after[0]).toBe(before[0]!);
		expect(after[1]).not.toBe(before[1]!);
	});

	test("stale base is detected and surfaced, never rebased", async () => {
		const session = makeSession({
			getCurrentPromptHash: () => "pk1-somebody-else-saved",
		});
		const result = await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["X"] } }],
			"Edit on a moved base.",
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		if (result.failure.kind !== "stale_base") {
			throw new Error(`expected stale_base, got ${result.failure.kind}`);
		}
		expect(result.failure.expectedHash).toBe(session.baseHash);
		expect(result.failure.actualHash).toBe("pk1-somebody-else-saved");
		expect(session.proposals()).toHaveLength(0);
	});
});

describe("resolve / reply semantics", () => {
	test("done requires a staged proposal; declined does not", async () => {
		const session = makeSession();
		const premature = session.resolve("R1", "done", "Did it.");
		expect(premature.ok).toBe(false);

		await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["Done."] } }],
			"The edit.",
		);
		const done = session.resolve("R1", "done", "Rewrote the opening.");
		if (!done.ok) throw new Error(done.message);
		expect(done.request.status).toBe("done");
		expect(done.request.note).toBe("Rewrote the opening.");
		// The note is the closing reply on the thread.
		expect(done.request.replies.at(-1)).toMatchObject({
			author: "agent",
			body: "Rewrote the opening.",
		});
		// The staged proposal survives disposition (held for Phase 2 review).
		expect(session.proposals()).toHaveLength(1);
		expect(PROMPT_EDIT_DISPOSITION_STATUS.done).toBe("applied-pending-review");
		expect(PROMPT_EDIT_DISPOSITION_STATUS.declined).toBe("resolved");
	});

	test("declining the latest staged proposal reverts the working document", async () => {
		const session = makeSession();
		await session.propose(
			"R1",
			[{ op: "remove_node", nodeId: "par-3" }],
			"Cut the sign-off.",
		);
		expect(hashPrompt(session.workingDocument())).not.toBe(session.baseHash);
		const declined = session.resolve("R1", "declined", "Human vetoed in thread.");
		if (!declined.ok) throw new Error(declined.message);
		expect(session.proposals()).toHaveLength(0);
		expect(hashPrompt(session.workingDocument())).toBe(session.baseHash);
		expect(declined.request.proposalId).toBeUndefined();
	});

	test("declining a non-latest staged proposal is refused (Phase 1)", async () => {
		const session = makeSession();
		await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["A"] } }],
			"First.",
		);
		await session.propose(
			"R2",
			[{ op: "update_node", nodeId: "par-2", patch: { content: ["B"] } }],
			"Second.",
		);
		const declined = session.resolve("R1", "declined", "Changed my mind.");
		expect(declined.ok).toBe(false);
		expect(session.proposals()).toHaveLength(2);
		expect(session.requests()[0]?.status).toBe("proposal-ready");
	});

	test("agent replies flag waiting-on-human; a human reply clears it", () => {
		const session = makeSession();
		const reply = session.reply("R2", "Cut it entirely, or keep a shorter form?");
		if (!reply.ok) throw new Error(reply.message);
		expect(reply.request.waitingOnHuman).toBe(true);
		const answer = session.appendHumanReply("R2", "Cut it entirely.");
		if (!answer.ok) throw new Error(answer.message);
		expect(answer.request.waitingOnHuman).toBe(false);
		expect(answer.request.replies.map((entry) => entry.author)).toEqual([
			"agent",
			"human",
		]);
	});

	test("session completes when every non-agent request is disposed", async () => {
		const session = makeSession();
		session.addNote("par-1", "Open agent note — must not gate completion.");
		expect(session.status()).toBe("running");
		await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["New."] } }],
			"Edit.",
		);
		session.resolve("R1", "done", "Done.");
		session.resolve("R2", "declined", "Not worth it.");
		expect(session.status()).toBe("running");
		session.resolve("R3", "declined", "Prompt does not actually repeat itself.");
		expect(session.status()).toBe("completed");
	});
});

describe("events", () => {
	test("staging, disposition, threads, and status emit typed events", async () => {
		const session = makeSession();
		const events: PromptEditSessionEvent[] = [];
		const unsubscribe = session.subscribe((event) => events.push(event));

		await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["E."] } }],
			"Edit.",
		);
		expect(events.map((event) => event.type)).toEqual([
			"proposal-staged",
			"request-updated",
		]);

		events.length = 0;
		session.reply("R2", "Question?");
		expect(events.map((event) => event.type)).toEqual(["thread-updated"]);

		events.length = 0;
		session.resolve("R1", "done", "Done.");
		session.resolve("R2", "declined", "No.");
		session.resolve("R3", "declined", "No.");
		expect(events.map((event) => event.type)).toEqual([
			"request-updated",
			"thread-updated",
			"request-updated",
			"thread-updated",
			"request-updated",
			"thread-updated",
			"session-status",
		]);
		const last = events.at(-1);
		expect(last).toMatchObject({ type: "session-status", status: "completed" });

		unsubscribe();
		session.addNote("par-1", "Silent.");
		expect(events.at(-1)).toBe(last!);
	});
});
