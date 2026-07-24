/**
 * Route-level tests for the per-turn request snapshot read surface: the
 * content-addressed blob route (GET /kernel/blobs/:hash) and the resolved
 * turn-context route (GET /kernel/runs/:runId/turns/:turnNumber/context),
 * exercised through Elysia's .handle(new Request(...)) over a temp SQLite
 * kernel db with the default container read service — same conventions as
 * catalog-api.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ensureKernelObservabilitySchema,
	hashTraceBlobBytes,
	insertTraceEventsBatch,
	kernelDatabasePath,
	openKernelDatabase,
	upsertTraceBlobs,
	type KernelDatabaseHandle,
	type NewTraceBlob,
} from "@agent-kernel/db";
import {
	createPiRequestSnapshotEvent,
	type PiRequestSnapshotData,
} from "@agent-kernel/protocol";

import { createKernelTraceReadApi } from "./read-api";
import { createContainerReadService } from "./read-service";

const CONTAINER_ID = "container-snap-1";
const RUN_ID = "run-snap-1";
const TURN_NUMBER = 2;
const PROMPT_HASH = "pk1-test-prompt-hash";

const encoder = new TextEncoder();

const SYSTEM_PROMPT_TEXT = "You are the snapshot test agent.";
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const systemPromptBytes = encoder.encode(SYSTEM_PROMPT_TEXT);
const systemPromptHash = hashTraceBlobBytes(systemPromptBytes);

const imageHash = hashTraceBlobBytes(IMAGE_BYTES);

const userMessage = {
	role: "user",
	content: [{ type: "text", text: "What is in this image?" }],
};
const userMessageBytes = encoder.encode(JSON.stringify(userMessage));
const userMessageHash = hashTraceBlobBytes(userMessageBytes);

// Sanitized message: the image block carries blob_hash instead of base64 data.
const assistantMessage = {
	role: "assistant",
	content: [
		{ type: "text", text: "Looking at the attachment." },
		{
			type: "image",
			blob_hash: imageHash,
			mimeType: "image/png",
			byte_length: IMAGE_BYTES.byteLength,
		},
	],
};
const assistantMessageBytes = encoder.encode(JSON.stringify(assistantMessage));
const assistantMessageHash = hashTraceBlobBytes(assistantMessageBytes);

const NOW = new Date().toISOString();

function blobRow(
	bytes: Uint8Array,
	kind: string,
	mimeType: string,
): NewTraceBlob {
	return {
		hash: hashTraceBlobBytes(bytes),
		kind,
		mimeType,
		byteLength: bytes.byteLength,
		data: Buffer.from(bytes),
		createdAt: NOW,
	};
}

function makeSnapshotData(
	overrides: Partial<PiRequestSnapshotData> = {},
): PiRequestSnapshotData {
	return {
		turn_number: TURN_NUMBER,
		system_prompt_blob_hash: systemPromptHash,
		prompt_hash: PROMPT_HASH,
		message_count: 2,
		message_refs: [
			{
				blob_hash: userMessageHash,
				role: "user",
				index: 0,
				text_chars: 22,
				image_count: 0,
				tool_call_count: 0,
			},
			{
				blob_hash: assistantMessageHash,
				role: "assistant",
				index: 1,
				text_chars: 26,
				image_count: 1,
				tool_call_count: 0,
			},
		],
		total_text_chars: 48,
		total_image_count: 1,
		...overrides,
	};
}

let dir: string;
let handle: KernelDatabaseHandle;
// Structural: Elysia's route-level generics differ between the generic
// ReturnType and the concrete instantiation, and .handle is all we need.
let app: { handle(request: Request): Promise<Response> };

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "agent-kernel-read-api-snapshots-test-"));
	handle = openKernelDatabase({ path: kernelDatabasePath(dir) });
	await ensureKernelObservabilitySchema(handle.db);

	await upsertTraceBlobs(handle.db, [
		blobRow(systemPromptBytes, "text", "text/plain"),
		blobRow(userMessageBytes, "message", "application/json"),
		blobRow(assistantMessageBytes, "message", "application/json"),
		blobRow(IMAGE_BYTES, "image", "image/png"),
	]);

	await insertTraceEventsBatch(handle.db, [
		createPiRequestSnapshotEvent(
			{ containerId: CONTAINER_ID, runId: RUN_ID },
			makeSnapshotData(),
		),
	]);

	app = createKernelTraceReadApi(createContainerReadService({ db: handle.db }));
});

afterEach(() => {
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

function url(path: string): string {
	return `http://localhost${path}`;
}

describe("GET /kernel/blobs/:hash", () => {
	test("round-trips blob bytes with content-type and immutable caching", async () => {
		const response = await app.handle(new Request(url(`/kernel/blobs/${imageHash}`)));

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(IMAGE_BYTES);
	});

	test("serves text blobs with their stored mime type", async () => {
		const response = await app.handle(
			new Request(url(`/kernel/blobs/${systemPromptHash}`)),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/plain");
		expect(await response.text()).toBe(SYSTEM_PROMPT_TEXT);
	});

	test("404s on malformed hashes without touching the db", async () => {
		for (const bad of [
			"not-a-hash",
			"b2-" + "a".repeat(64),
			"b1-" + "a".repeat(63),
			"b1-" + "A".repeat(64),
			"b1-" + "g".repeat(64),
		]) {
			const response = await app.handle(new Request(url(`/kernel/blobs/${bad}`)));
			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error).toContain("not found");
		}
	});

	test("404s on a well-formed but unknown hash", async () => {
		const unknown = `b1-${"0".repeat(64)}`;
		const response = await app.handle(new Request(url(`/kernel/blobs/${unknown}`)));

		expect(response.status).toBe(404);
		const body = await response.json();
		expect(body.error).toContain(unknown);
	});

	test("404s when the service does not implement getBlob", async () => {
		const bare = createKernelTraceReadApi({
			async getContainerTrace() {
				return null;
			},
		});

		const response = await bare.handle(new Request(url(`/kernel/blobs/${imageHash}`)));
		expect(response.status).toBe(404);
	});
});

describe("GET /kernel/runs/:runId/turns/:turnNumber/context", () => {
	test("assembles the turn context from the snapshot event and blobs", async () => {
		const response = await app.handle(
			new Request(url(`/kernel/runs/${RUN_ID}/turns/${TURN_NUMBER}/context`)),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.run_id).toBe(RUN_ID);
		expect(body.turn_number).toBe(TURN_NUMBER);
		expect(body.prompt_hash).toBe(PROMPT_HASH);
		expect(body.system_prompt).toBe(SYSTEM_PROMPT_TEXT);
		expect(body.message_count).toBe(2);
		expect(body.messages).toEqual([userMessage, assistantMessage]);
		// The image block stays by-reference (blob_hash, no base64 data).
		expect(body.messages[1].content[1]).toEqual({
			type: "image",
			blob_hash: imageHash,
			mimeType: "image/png",
			byte_length: IMAGE_BYTES.byteLength,
		});
		expect(body.refs.map((ref: { index: number }) => ref.index)).toEqual([0, 1]);
		expect(body.refs[0].blob_hash).toBe(userMessageHash);
		expect(body.refs[1].role).toBe("assistant");
		expect(body.totals).toEqual({ text_chars: 48, image_count: 1 });
		expect(body.warnings).toBeUndefined();
	});

	test("404s for an unknown run and an unknown turn", async () => {
		const unknownRun = await app.handle(
			new Request(url(`/kernel/runs/no-such-run/turns/0/context`)),
		);
		expect(unknownRun.status).toBe(404);

		const unknownTurn = await app.handle(
			new Request(url(`/kernel/runs/${RUN_ID}/turns/99/context`)),
		);
		expect(unknownTurn.status).toBe(404);
		const body = await unknownTurn.json();
		expect(body.error).toContain(RUN_ID);
	});

	test("404s on malformed turn numbers", async () => {
		for (const bad of ["abc", "-1", "1.5", ""]) {
			const response = await app.handle(
				new Request(url(`/kernel/runs/${RUN_ID}/turns/${bad}/context`)),
			);
			expect(response.status).toBe(404);
		}
	});

	test("substitutes missing message blobs and reports warnings", async () => {
		const missingHash = `b1-${"f".repeat(64)}`;
		await insertTraceEventsBatch(handle.db, [
			createPiRequestSnapshotEvent(
				{ containerId: CONTAINER_ID, runId: "run-with-hole" },
				makeSnapshotData({
					turn_number: 0,
					message_refs: [
						{
							blob_hash: userMessageHash,
							role: "user",
							index: 0,
							text_chars: 22,
							image_count: 0,
							tool_call_count: 0,
						},
						{
							blob_hash: missingHash,
							role: "assistant",
							index: 1,
							text_chars: 26,
							image_count: 1,
							tool_call_count: 0,
						},
					],
				}),
			),
		]);

		const response = await app.handle(
			new Request(url(`/kernel/runs/run-with-hole/turns/0/context`)),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.messages).toEqual([userMessage, { missing_blob: missingHash }]);
		expect(body.warnings).toHaveLength(1);
		expect(body.warnings[0]).toContain(missingHash);
	});

	test("resolves a null system prompt without warnings", async () => {
		await insertTraceEventsBatch(handle.db, [
			createPiRequestSnapshotEvent(
				{ containerId: CONTAINER_ID, runId: "run-no-system" },
				makeSnapshotData({ turn_number: 0, system_prompt_blob_hash: null }),
			),
		]);

		const response = await app.handle(
			new Request(url(`/kernel/runs/run-no-system/turns/0/context`)),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.system_prompt).toBeNull();
		expect(body.warnings).toBeUndefined();
	});

	test("404s when the service does not implement getRunTurnContext", async () => {
		const bare = createKernelTraceReadApi({
			async getContainerTrace() {
				return null;
			},
		});

		const response = await bare.handle(
			new Request(url(`/kernel/runs/${RUN_ID}/turns/0/context`)),
		);
		expect(response.status).toBe(404);
	});
});
