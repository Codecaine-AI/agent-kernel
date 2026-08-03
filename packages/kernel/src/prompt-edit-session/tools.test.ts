import { describe, expect, test } from "bun:test";

import { createPromptEditSession } from "./session";
import {
	toolAddNote,
	toolProposeTransaction,
	toolReadPrompt,
	toolReplyRequest,
	toolResolveRequest,
} from "./tools";
import { fixtureDoc, fixtureRequests } from "./test-fixtures";

function makeSession() {
	return createPromptEditSession({
		targetAgent: "target-agent",
		document: fixtureDoc(),
		requests: fixtureRequests(),
		declaredVariables: ["tone"],
	});
}

describe("read_prompt", () => {
	test("renders node-id markers and the live requests block", () => {
		const session = makeSession();
		const result = toolReadPrompt(session);
		expect(result.isError).toBeUndefined();
		expect(result.text).toContain("<!-- #sec-a -->");
		expect(result.text).toContain("<!-- #par-1 -->");
		expect(result.text).toContain("<overview>");
		expect(result.text).toContain("REQUESTS · 0/3 disposed");
		expect(result.text).toContain('R1 open  node:par-1  human');
		expect(result.text).toContain("range:par-2[0..4]");
		expect(result.text).toContain(`base ${session.baseHash}`);
	});

	test("reflects staged edits (the working document, not the base)", async () => {
		const session = makeSession();
		await session.propose(
			"R1",
			[{ op: "update_node", nodeId: "par-1", patch: { content: ["Be blunt."] } }],
			"Edit.",
		);
		const result = toolReadPrompt(session);
		expect(result.text).toContain("Be blunt.");
		expect(result.text).not.toContain("You are a helpful agent.");
		expect(result.text).toContain("R1 proposal-staged");
	});
});

describe("propose_transaction — the automatic retry loop", () => {
	test("compile failures return as the tool result; nothing staged", async () => {
		const session = makeSession();
		const result = await toolProposeTransaction(session, {
			requestAlias: "R1",
			ops: [{ op: "remove_node", nodeId: "ghost" }],
			summary: "Remove a ghost.",
		});
		expect(result.isError).toBe(true);
		expect(result.text).toContain("unknown_node");
		expect(result.text).toContain("Nothing was staged");
		expect(session.proposals()).toHaveLength(0);
	});

	test("validation failures bounce back with diagnostics; retry then succeeds", async () => {
		const session = makeSession();
		const bounced = await toolProposeTransaction(session, {
			requestAlias: "R1",
			ops: [
				{
					op: "insert_after",
					refNodeId: "par-1",
					node: {
						type: "paragraph",
						content: [{ type: "variable", name: "undeclared" }],
					},
				},
			],
			summary: "Introduce a broken variable.",
		});
		expect(bounced.isError).toBe(true);
		expect(bounced.text).toContain("unknown_variable");
		expect(session.proposals()).toHaveLength(0);
		expect(session.requests()[0]?.status).toBe("open");

		const retried = await toolProposeTransaction(session, {
			requestAlias: "R1",
			ops: [
				{
					op: "insert_after",
					refNodeId: "par-1",
					node: {
						type: "paragraph",
						content: [{ type: "variable", name: "tone" }],
					},
				},
			],
			summary: "Use the declared variable instead.",
		});
		expect(retried.isError).toBeUndefined();
		expect(retried.text).toContain("STAGED · transaction");
		expect(retried.details.ok).toBe(true);
		expect(session.proposals()).toHaveLength(1);
	});

	test("malformed ops are rejected at the boundary with typed shape errors", async () => {
		const session = makeSession();
		const result = await toolProposeTransaction(session, {
			requestAlias: "R1",
			ops: [{ op: "teleport_node", nodeId: "par-1" }],
			summary: "Bad op name.",
		});
		expect(result.isError).toBe(true);
		expect(result.text).toContain("invalid_op_shape");
	});
});

describe("resolve / reply / add_note through the tool surface", () => {
	test("resolve declined closes the entry with the note in the block", () => {
		const session = makeSession();
		const result = toolResolveRequest(session, {
			alias: "R2",
			outcome: "declined",
			note: "The rule earns its place.",
		});
		expect(result.isError).toBeUndefined();
		expect(result.text).toContain('R2 declined "The rule earns its place."');
		expect(result.text).toContain("REQUESTS · 1/3 disposed");
	});

	test("reply flags waiting-on-human in the re-rendered block", () => {
		const session = makeSession();
		const result = toolReplyRequest(session, {
			alias: "R3",
			body: "Which sections feel repetitive to you?",
		});
		expect(result.isError).toBeUndefined();
		expect(result.text).toContain("waiting-on-human");
		expect(result.text).toContain(
			'"Which sections feel repetitive to you?"',
		);
	});

	test("mid-session add_note appears in the next requests-block render", () => {
		const session = makeSession();
		const before = toolReadPrompt(session).text;
		expect(before).not.toContain("R4");

		const noted = toolAddNote(session, {
			nodeId: "par-3",
			body: "This sign-off conflicts with the rules section.",
		});
		expect(noted.isError).toBeUndefined();
		expect(noted.text).toContain("NOTED · R4 placed on node:par-3");

		const after = toolReadPrompt(session).text;
		expect(after).toContain(
			'R4 open · waiting-on-human  node:par-3  agent — "This sign-off conflicts with the rules section."',
		);
	});

	test("add_note on an unknown node is a tool error", () => {
		const session = makeSession();
		const result = toolAddNote(session, { nodeId: "ghost", body: "Note." });
		expect(result.isError).toBe(true);
		expect(result.text).toContain('No node "ghost"');
	});
});
