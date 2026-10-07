/**
 * Engine attempts → node turn events (plan §3.4 step 7, §4.4).
 *
 * Per attempt, sorted by start time, with attempt index `i` as both the
 * turn number and the event-id ordinal:
 *   - pi_request_snapshot: the request's system/developer text as a `text`
 *     blob, each user/assistant message as a Pi-shaped `message` blob, and
 *     the whole redacted request as a `call-request` blob
 *     (`raw_request_blob_hash`). Only when the attempt has a request.
 *   - pi_turn_start / pi_turn_end: the attempt's window on the node clock,
 *     the response (or SSE frames) as a `call-response` blob, HTTP status,
 *     duration, reasoning tokens, and usage keyed by the served
 *     "provider/id" and priced from the kernel's price table.
 *
 * Every attempt is redacted again here (the kernel's second pass, §4.7):
 * secret values everywhere, sensitive header values by name.
 */
import type { TraceBlobInput } from "@agent-kernel/db";
import {
	createPiRequestSnapshotEvent,
	createPiTurnEndEvent,
	createPiTurnStartEvent,
	type PiRequestSnapshotMessageRef,
	type TraceEvent,
	type TurnUsage,
} from "@agent-kernel/protocol";

import type { ModelPriceTable } from "../../emitter";
import { jsonBlob, textBlob } from "../blobs";
import type { NodeRunHandle } from "../node-run";
import { nodeModelRef, priceNodeUsage } from "../pricing";
import { redactDeep, redactHeaders } from "../redact";
import type { EngineAttempt } from "../types";

export interface AttemptEventsInput {
	/** The engine's attempts, in any order. */
	attempts: readonly EngineAttempt[];
	/** The second-pass secret set: preflight route secrets plus every set the Pi transport returned. */
	secrets: readonly string[];
	/** The function's prompt hash ("baml1-…"), recorded on each snapshot. */
	promptHash: string;
	/** The Pi provider of the resolved route: served bare model ids are keyed `${provider}/${id}`. */
	provider: string;
	prices?: ModelPriceTable;
	/** Stop reason of the selected attempt: "stop" for an ok outcome, else the failure's. */
	selectedStopReason: string;
}

export interface AttemptEvents {
	/** Snapshot, turn start, turn end per attempt, in attempt order. */
	events: TraceEvent[];
	/** Deduplicated by hash. */
	blobs: TraceBlobInput[];
	/** Priced turn usages, in attempt order. */
	usages: TurnUsage[];
	/** The served "provider/id" of the selected attempt, else of the last attempt that reported usage. */
	resolvedModel?: string;
}

export function attemptsToEvents(run: NodeRunHandle, input: AttemptEventsInput): AttemptEvents {
	const blobs = new Map<string, TraceBlobInput>();
	const addBlob = ({ hash, blob }: { hash: string; blob: TraceBlobInput }) => {
		if (!blobs.has(hash)) blobs.set(hash, blob);
		return hash;
	};
	const events: TraceEvent[] = [];
	const usages: TurnUsage[] = [];
	let selectedModel: string | undefined;
	let lastModel: string | undefined;

	const ordered = [...input.attempts].sort((a, b) => a.startedAtMs - b.startedAtMs);
	ordered.forEach((raw, i) => {
		const attempt = redactAttempt(raw, input.secrets);
		const window = run.turnWindow(attempt.startedAtMs, attempt.durationMs);
		const opts = (type: string, timestamp: string) => ({
			eventId: run.eventId(i, type),
			parentEventId: run.startEventId,
			timestamp,
		});

		if (attempt.request) {
			const parsed = requestMessages(attempt.request.body);
			const systemPromptHash =
				parsed.system === null ? null : addBlob(textBlob("text", parsed.system, window.start));
			const refs: PiRequestSnapshotMessageRef[] = parsed.messages.map((message, index) => ({
				blob_hash: addBlob(jsonBlob("message", message.blob, window.start)),
				role: message.blob.role,
				index,
				text_chars: message.textChars,
				image_count: message.imageCount,
				tool_call_count: 0,
			}));
			events.push(
				createPiRequestSnapshotEvent(
					run.traceIds,
					{
						turn_number: i,
						system_prompt_blob_hash: systemPromptHash,
						prompt_hash: input.promptHash,
						message_count: refs.length,
						message_refs: refs,
						total_text_chars: refs.reduce((sum, ref) => sum + ref.text_chars, 0),
						total_image_count: refs.reduce((sum, ref) => sum + ref.image_count, 0),
						raw_request_blob_hash: addBlob(jsonBlob("call-request", attempt.request, window.start)),
						request_kind: attempt.transport === "pi" ? "pi-transport" : "baml-http",
					},
					opts("pi_request_snapshot", window.start),
				),
			);
		}

		events.push(createPiTurnStartEvent(run.traceIds, { turnNumber: i, ...opts("pi_turn_start", window.start) }));

		let usage: TurnUsage | undefined;
		if (attempt.usage) {
			usage = priceNodeUsage(
				{ ...attempt.usage, model: nodeModelRef(input.provider, attempt.usage.model) },
				input.prices,
			);
			usages.push(usage);
			lastModel = usage.model;
			if (attempt.selected) selectedModel = usage.model;
		}
		const responseHash = attempt.response ? addBlob(jsonBlob("call-response", attempt.response, window.end)) : undefined;
		events.push(
			createPiTurnEndEvent(run.traceIds, {
				turnNumber: i,
				stopReason: attempt.selected ? input.selectedStopReason : "error",
				...(usage !== undefined && { usage }),
				...(responseHash !== undefined && { responseBlobHash: responseHash }),
				...(attempt.status !== null && { httpStatus: attempt.status }),
				...(attempt.durationMs !== null && { durationMs: attempt.durationMs }),
				...(attempt.reasoningTokens !== undefined && { reasoningTokens: attempt.reasoningTokens }),
				...opts("pi_turn_end", window.end),
			}),
		);
	});

	const resolvedModel = selectedModel ?? lastModel;
	return { events, blobs: [...blobs.values()], usages, ...(resolvedModel !== undefined && { resolvedModel }) };
}

/** The kernel's second pass over an engine attempt (§4.7). */
function redactAttempt(attempt: EngineAttempt, secrets: readonly string[]): EngineAttempt {
	const scrubbed = redactDeep(attempt, secrets);
	return {
		...scrubbed,
		request: scrubbed.request && { ...scrubbed.request, headers: redactHeaders(scrubbed.request.headers) },
		response:
			scrubbed.response && "sse" in scrubbed.response
				? scrubbed.response
				: scrubbed.response && { ...scrubbed.response, headers: redactHeaders(scrubbed.response.headers) },
	};
}

// ── request bodies → snapshot messages ────────────────────────────────────────

interface SnapshotMessage {
	/** Shaped like a Pi message: `{ role, content: [{ type: "text", text }] }`. */
	blob: { role: string; content: Array<{ type: "text"; text: string }> };
	textChars: number;
	imageCount: number;
}

interface ParsedRequest {
	/** System and developer text joined by blank lines; null when the request has none. */
	system: string | null;
	messages: SnapshotMessage[];
}

const SYSTEM_ROLES = new Set(["system", "developer"]);
const MESSAGE_ROLES = new Set(["user", "assistant"]);

/**
 * Reads the conversation out of the provider request bodies the call
 * transports send: OpenAI Responses (`instructions`, `input[]`), OpenAI chat
 * completions (`messages[]`), and Anthropic messages (`system`,
 * `messages[]`). Content may be a string or a block list; text blocks
 * (`text`, `input_text`, `output_text`) are kept, image blocks counted.
 * Anything else yields no messages; the raw request blob still holds it.
 */
function requestMessages(body: unknown): ParsedRequest {
	const system: string[] = [];
	const messages: SnapshotMessage[] = [];
	if (!isRecord(body)) return { system: null, messages };

	for (const field of ["instructions", "system"] as const) {
		const { parts } = contentText(body[field]);
		if (parts.length > 0) system.push(parts.join("\n\n"));
	}
	const items = Array.isArray(body.input) ? body.input : Array.isArray(body.messages) ? body.messages : [];
	for (const item of items) {
		if (!isRecord(item) || typeof item.role !== "string") continue;
		const content = contentText(item.content);
		if (SYSTEM_ROLES.has(item.role)) {
			if (content.parts.length > 0) system.push(content.parts.join("\n\n"));
		} else if (MESSAGE_ROLES.has(item.role)) {
			messages.push({
				blob: { role: item.role, content: content.parts.map((text) => ({ type: "text", text })) },
				textChars: content.parts.reduce((sum, part) => sum + part.length, 0),
				imageCount: content.images,
			});
		}
	}
	return { system: system.length === 0 ? null : system.join("\n\n"), messages };
}

function contentText(content: unknown): { parts: string[]; images: number } {
	if (typeof content === "string") return { parts: content.length > 0 ? [content] : [], images: 0 };
	const parts: string[] = [];
	let images = 0;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (!isRecord(block)) continue;
			if (typeof block.text === "string") parts.push(block.text);
			else if (typeof block.type === "string" && block.type.includes("image")) images++;
		}
	}
	return { parts, images };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
