import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	getTraceBlob,
	hashTraceBlobBytes,
	openKernelDatabase,
	traceBlobs,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import type { PiRequestSnapshotData, TraceEvent } from "@agent-kernel/protocol";

import {
	createRequestSnapshotRecorder,
	type RequestSnapshotSessionLike,
} from "./spawn-pipeline/streaming/request-snapshot";

const IDS = {
	containerId: "container-1",
	runId: "run-1",
	piSessionUuid: "pi-session-1",
};

const IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04]);
const IMAGE_B64 = IMAGE_BYTES.toString("base64");
const CUSTOM_IMAGE_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const CUSTOM_IMAGE_B64 = CUSTOM_IMAGE_BYTES.toString("base64");
const SYSTEM_PROMPT = "You are a test agent.";

/** Turn-1 transcript covering the three pass-through roles plus an excluded bash execution. */
function turnOneMessages(): any[] {
	return [
		{ role: "user", content: "hello" },
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "hmm" },
				{ type: "text", text: "look" },
				{ type: "toolCall", id: "tc1", name: "read", arguments: "{}" },
			],
		},
		{
			role: "toolResult",
			toolCallId: "tc1",
			toolName: "read",
			isError: false,
			content: [
				{ type: "text", text: "file" },
				{ type: "image", data: IMAGE_B64, mimeType: "image/png" },
			],
		},
		{
			role: "bashExecution",
			content: "not part of the llm context",
			excludeFromContext: true,
		},
	];
}

function makeSession(messages: any[]): RequestSnapshotSessionLike {
	return { messages, systemPrompt: SYSTEM_PROMPT };
}

function snapshotData(event: TraceEvent): PiRequestSnapshotData {
	return event.eventData as PiRequestSnapshotData;
}

describe("createRequestSnapshotRecorder", () => {
	let dir: string;
	let handle: KernelDatabaseHandle;
	const events: TraceEvent[] = [];
	const sink = { submit: (event: TraceEvent) => void events.push(event) };

	beforeAll(async () => {
		dir = mkdtempSync(join(tmpdir(), "kernel-request-snapshot-"));
		handle = openKernelDatabase({ path: join(dir, "trace.db") });
		await ensureKernelObservabilitySchema(handle.db);
	});

	afterAll(() => {
		handle.close();
		rmSync(dir, { recursive: true, force: true });
	});

	async function captureOneTurn(messages: any[]): Promise<PiRequestSnapshotData> {
		const localEvents: TraceEvent[] = [];
		const recorder = createRequestSnapshotRecorder({
			db: handle.db,
			traceWriter: { submit: (event) => void localEvents.push(event) },
			ids: IDS,
		});
		const session = makeSession(messages);
		recorder.handleEvent({ type: "agent_start" }, session);
		recorder.handleEvent({ type: "turn_start" }, session);
		await recorder.flush();
		expect(localEvents.length).toBe(1);
		return snapshotData(localEvents[0]!);
	}

	test("captures two turns: refs, counts, blob dedup, image stripping", async () => {
		const recorder = createRequestSnapshotRecorder({
			db: handle.db,
			traceWriter: sink,
			ids: IDS,
			promptHash: "pk1-test",
		});

		// Turn 0.
		const session1 = makeSession(turnOneMessages());
		recorder.handleEvent({ type: "agent_start" }, session1);
		recorder.handleEvent({ type: "turn_start" }, session1);
		recorder.handleEvent({ type: "turn_end" }, session1);
		await recorder.flush();

		const blobsAfterTurn1 = await handle.db
			.select({ hash: traceBlobs.hash })
			.from(traceBlobs);
		// 1 system prompt + 1 image + 3 sanitized messages.
		expect(blobsAfterTurn1.length).toBe(5);

		// Turn 1: prefix-stable transcript grows by one user message.
		const session2 = makeSession([
			...turnOneMessages(),
			{ role: "user", content: "again" },
		]);
		recorder.handleEvent({ type: "turn_start" }, session2);
		await recorder.flush();

		expect(events.length).toBe(2);
		for (const event of events) {
			expect(event.type).toBe("pi_request_snapshot");
			expect(event.containerId).toBe(IDS.containerId);
			expect(event.runId).toBe(IDS.runId);
			expect(event.piSessionUuid).toBe(IDS.piSessionUuid);
		}

		const first = snapshotData(events[0]!);
		const second = snapshotData(events[1]!);

		// Turn numbering: 0-based, aligned with the emitter's pi_turn_start.
		expect(first.turn_number).toBe(0);
		expect(second.turn_number).toBe(1);
		expect(first.prompt_hash).toBe("pk1-test");

		// convertToLlm excludes bash executions explicitly marked out of context.
		expect(first.message_count).toBe(3);
		expect(first.message_refs.map((r) => r.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
		]);
		expect(first.message_refs.map((r) => r.index)).toEqual([0, 1, 2]);

		const [userRef, assistantRef, toolResultRef] = first.message_refs;
		expect(userRef!.text_chars).toBe("hello".length);
		expect(userRef!.image_count).toBe(0);
		expect(userRef!.tool_call_count).toBe(0);
		// thinking + text chars, one toolCall.
		expect(assistantRef!.text_chars).toBe("hmm".length + "look".length);
		expect(assistantRef!.tool_call_count).toBe(1);
		expect(assistantRef!.image_count).toBe(0);
		expect(toolResultRef!.text_chars).toBe("file".length);
		expect(toolResultRef!.image_count).toBe(1);
		expect(first.total_text_chars).toBe(5 + 7 + 4);
		expect(first.total_image_count).toBe(1);

		// System prompt blob: kind "text", exact bytes.
		const expectedPromptHash = hashTraceBlobBytes(
			Buffer.from(SYSTEM_PROMPT, "utf8"),
		);
		expect(first.system_prompt_blob_hash).toBe(expectedPromptHash);
		const promptBlob = await getTraceBlob(handle.db, expectedPromptHash);
		expect(promptBlob).not.toBeNull();
		expect(promptBlob!.kind).toBe("text");
		expect(promptBlob!.mimeType).toBe("text/plain");
		expect(Buffer.from(promptBlob!.data).toString("utf8")).toBe(SYSTEM_PROMPT);

		// Image blob: decoded bytes stored under their content hash.
		const expectedImageHash = hashTraceBlobBytes(IMAGE_BYTES);
		const imageBlob = await getTraceBlob(handle.db, expectedImageHash);
		expect(imageBlob).not.toBeNull();
		expect(imageBlob!.kind).toBe("image");
		expect(imageBlob!.mimeType).toBe("image/png");
		expect(imageBlob!.byteLength).toBe(IMAGE_BYTES.byteLength);
		expect(Buffer.from(imageBlob!.data).equals(IMAGE_BYTES)).toBe(true);

		// Sanitized toolResult message blob: base64 data replaced by blob ref.
		const toolResultBlob = await getTraceBlob(
			handle.db,
			toolResultRef!.blob_hash,
		);
		expect(toolResultBlob).not.toBeNull();
		expect(toolResultBlob!.kind).toBe("message");
		expect(toolResultBlob!.mimeType).toBe("application/json");
		const sanitized = JSON.parse(Buffer.from(toolResultBlob!.data).toString("utf8"));
		const imageBlock = sanitized.content.find(
			(b: { type: string }) => b.type === "image",
		);
		expect(imageBlock.data).toBeUndefined();
		expect(imageBlock.blob_hash).toBe(expectedImageHash);
		expect(imageBlock.mimeType).toBe("image/png");
		expect(imageBlock.byte_length).toBe(IMAGE_BYTES.byteLength);
		expect(JSON.stringify(sanitized)).not.toContain(IMAGE_B64);

		// Dedup across turns: only the new user message blob was added.
		const blobsAfterTurn2 = await handle.db
			.select({ hash: traceBlobs.hash })
			.from(traceBlobs);
		expect(blobsAfterTurn2.length).toBe(6);

		// Prefix messages keep the same hashes turn over turn.
		expect(second.message_refs.slice(0, 3).map((r) => r.blob_hash)).toEqual(
			first.message_refs.map((r) => r.blob_hash),
		);
		expect(second.message_count).toBe(4);
		expect(second.message_refs[3]!.role).toBe("user");
	});

	test("includes a custom message with string content", async () => {
		const content = "injected agent context";
		const snapshot = await captureOneTurn([
			{
				role: "custom",
				customType: "agent-context",
				content,
				display: false,
			},
		]);

		expect(snapshot.message_count).toBe(1);
		const ref = snapshot.message_refs[0]!;
		expect(ref.role).toBe("custom");
		expect(ref.text_chars).toBe(content.length);

		const messageBlob = await getTraceBlob(handle.db, ref.blob_hash);
		expect(messageBlob).not.toBeNull();
		const storedMessage = JSON.parse(
			Buffer.from(messageBlob!.data).toString("utf8"),
		);
		expect(storedMessage.content).toBe(content);
	});

	test("includes and sanitizes custom message block-array content", async () => {
		const text = "context with image";
		const snapshot = await captureOneTurn([
			{
				role: "custom",
				customType: "agent-context",
				content: [
					{ type: "text", text },
					{
						type: "image",
						data: CUSTOM_IMAGE_B64,
						mimeType: "image/gif",
					},
				],
				display: false,
			},
		]);

		const ref = snapshot.message_refs[0]!;
		expect(ref.role).toBe("custom");
		expect(ref.text_chars).toBe(text.length);
		expect(ref.image_count).toBe(1);

		const expectedImageHash = hashTraceBlobBytes(CUSTOM_IMAGE_BYTES);
		const messageBlob = await getTraceBlob(handle.db, ref.blob_hash);
		expect(messageBlob).not.toBeNull();
		const storedMessage = JSON.parse(
			Buffer.from(messageBlob!.data).toString("utf8"),
		);
		const imageBlock = storedMessage.content.find(
			(block: { type: string }) => block.type === "image",
		);
		expect(imageBlock).toEqual({
			type: "image",
			mimeType: "image/gif",
			blob_hash: expectedImageHash,
			byte_length: CUSTOM_IMAGE_BYTES.byteLength,
		});
		expect(JSON.stringify(storedMessage)).not.toContain(CUSTOM_IMAGE_B64);

		const imageBlob = await getTraceBlob(handle.db, expectedImageHash);
		expect(imageBlob).not.toBeNull();
		expect(imageBlob!.kind).toBe("image");
		expect(imageBlob!.mimeType).toBe("image/gif");
		expect(imageBlob!.byteLength).toBe(CUSTOM_IMAGE_BYTES.byteLength);
		expect(Buffer.from(imageBlob!.data).equals(CUSTOM_IMAGE_BYTES)).toBe(true);
	});

	test("includes branch and compaction summaries with summary text counts", async () => {
		const branchSummary = "branch summary";
		const compactionSummary = "compaction summary";
		const snapshot = await captureOneTurn([
			{ role: "branchSummary", summary: branchSummary },
			{ role: "compactionSummary", summary: compactionSummary },
		]);

		expect(snapshot.message_count).toBe(2);
		expect(snapshot.message_refs.map((ref) => ref.role)).toEqual([
			"branchSummary",
			"compactionSummary",
		]);
		expect(snapshot.message_refs.map((ref) => ref.text_chars)).toEqual([
			branchSummary.length,
			compactionSummary.length,
		]);
		expect(snapshot.total_text_chars).toBe(
			branchSummary.length + compactionSummary.length,
		);
	});

	test("applies bash execution exclusion and drops unknown roles", async () => {
		const includedBash = {
			role: "bashExecution",
			command: "pwd",
			output: "/workspace",
		};
		const snapshot = await captureOneTurn([
			{
				role: "bashExecution",
				command: "printf secret",
				output: "secret",
				excludeFromContext: true,
			},
			includedBash,
			{ role: "somethingElse", content: "not sent" },
		]);

		expect(snapshot.message_count).toBe(1);
		expect(snapshot.message_refs.map((ref) => ref.role)).toEqual([
			"bashExecution",
		]);
		const messageBlob = await getTraceBlob(
			handle.db,
			snapshot.message_refs[0]!.blob_hash,
		);
		expect(messageBlob).not.toBeNull();
		expect(
			JSON.parse(Buffer.from(messageBlob!.data).toString("utf8")),
		).toEqual(includedBash);
	});

	test("recorder errors are logged, never thrown", async () => {
		const logged: string[] = [];
		const localEvents: TraceEvent[] = [];
		const recorder = createRequestSnapshotRecorder({
			db: handle.db,
			traceWriter: { submit: (e) => void localEvents.push(e) },
			ids: IDS,
			logger: { error: (message) => void logged.push(message) },
		});

		const throwingSession = {
			get messages(): any[] {
				throw new Error("boom");
			},
			systemPrompt: "x",
		} as unknown as RequestSnapshotSessionLike;

		expect(() =>
			recorder.handleEvent({ type: "turn_start" }, throwingSession),
		).not.toThrow();
		await recorder.flush();
		expect(localEvents.length).toBe(0);
		expect(logged.length).toBe(1);
		expect(logged[0]).toContain("request snapshot");

		// A failed capture still leaves the recorder usable.
		recorder.handleEvent({ type: "turn_start" }, makeSession([]));
		await recorder.flush();
		expect(localEvents.length).toBe(1);
	});
	test("recordBuiltRequest stamps section tags and takes over from turn_start", async () => {
		const localEvents: TraceEvent[] = [];
		const recorder = createRequestSnapshotRecorder({
			db: handle.db,
			traceWriter: { submit: (event) => void localEvents.push(event) },
			ids: IDS,
		});
		const session = makeSession(turnOneMessages());
		recorder.handleEvent({ type: "agent_start" }, session);

		const built = [
			{ role: "user", content: [{ type: "text", text: "<context>caps</context>" }] },
			{ role: "user", content: [{ type: "text", text: "<state v=\"1\"/>" }] },
			{ role: "user", content: "hello" },
			{ role: "assistant", content: [{ type: "text", text: "hi" }] },
		];
		recorder.recordBuiltRequest(session, {
			messages: built,
			sections: [
				{ kind: "context", start: 0, end: 1 },
				{ kind: "state", start: 1, end: 2 },
				{ kind: "tail", start: 2, end: 4 },
			],
		});
		// Once a builder has spoken, the raw-transcript path stands down.
		recorder.handleEvent({ type: "turn_start" }, session);
		await recorder.flush();

		expect(localEvents.length).toBe(1);
		const data = snapshotData(localEvents[0]!);
		expect(data.turn_number).toBe(0);
		expect(data.message_count).toBe(4);
		expect(data.sections).toEqual([
			{ kind: "context", start: 0, end: 1 },
			{ kind: "state", start: 1, end: 2 },
			{ kind: "tail", start: 2, end: 4 },
		]);
		// Sections index the snapshot's own ordered message list.
		expect(data.message_refs.map((ref) => ref.index)).toEqual([0, 1, 2, 3]);
	});

	test("builderOwnsCapture suppresses the turn_start capture that precedes the first built request", async () => {
		// Pi fires turn_start BEFORE the context hook the builder runs in. Without
		// the flag that first turn_start records an extra, untagged snapshot and
		// pushes every built request's turn_number one past its pi_turn_start.
		const localEvents: TraceEvent[] = [];
		const recorder = createRequestSnapshotRecorder({
			db: handle.db,
			traceWriter: { submit: (event) => void localEvents.push(event) },
			ids: IDS,
			builderOwnsCapture: true,
		});
		const session = makeSession(turnOneMessages());
		recorder.handleEvent({ type: "agent_start" }, session);
		recorder.handleEvent({ type: "turn_start" }, session);
		recorder.recordBuiltRequest(session, {
			messages: [{ role: "user", content: "built" }],
			sections: [{ kind: "tail", start: 0, end: 1 }],
		});
		await recorder.flush();

		expect(localEvents.length).toBe(1);
		const data = snapshotData(localEvents[0]!);
		expect(data.turn_number).toBe(0);
		expect(data.sections).toEqual([{ kind: "tail", start: 0, end: 1 }]);
	});

	test("a transcript-captured turn carries no sections (old snapshots stay valid)", async () => {
		const data = await captureOneTurn([{ role: "user", content: "hello" }]);
		expect(data.sections).toBeUndefined();
	});
});
