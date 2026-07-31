import { describe, expect, test } from "bun:test";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";

import {
	loadPromptRevisionDocument,
	savePromptDocument,
} from "./catalog-client";

const document: PromptDocument = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "viewer-ui-catalog-client-test",
	nodes: [
		{
			type: "paragraph",
			id: "intro",
			content: ["Keep the save contract explicit."],
		},
	],
};

describe("viewer-ui catalog client", () => {
	test("loads a canonical historical revision document through the document route", async () => {
		const calls: string[] = [];
		const responseBody = {
			hash: "pk1-historical",
			createdAt: "2026-07-30T12:00:00.000Z",
			document,
		};

		const result = await loadPromptRevisionDocument(
			"http://kernel.test",
			"research/agent",
			"pk1-a+b",
			async (input) => {
				calls.push(input);
				return Response.json(responseBody);
			},
		);

		expect(calls).toEqual([
			"http://kernel.test/kernel/catalog/agents/research%2Fagent/revisions/pk1-a%2Bb/document",
		]);
		expect(result).toEqual(responseBody);
	});

	test("sends the expected hash with the prompt document", async () => {
		let requestBody: unknown;
		const result = await savePromptDocument(
			"http://kernel.test",
			"writer",
			document,
			"pk1-before",
			async (_input, init) => {
				requestBody = JSON.parse(String(init?.body));
				return Response.json({ hash: "pk1-after" });
			},
		);

		expect(requestBody).toEqual({
			document,
			expectedHash: "pk1-before",
		});
		expect(result).toEqual({ hash: "pk1-after" });
	});

	test("turns a 409 into a clear reload-before-saving conflict message", async () => {
		const result = await savePromptDocument(
			"http://kernel.test",
			"writer",
			document,
			"pk1-stale",
			async () =>
				Response.json(
					{ currentHash: "pk1-current" },
					{ status: 409 },
				),
		);

		expect(result).toEqual({
			errors: [
				"Save conflict: this prompt changed on the server (current revision pk1-current). Reload the agent before saving again.",
			],
		});
	});
});
