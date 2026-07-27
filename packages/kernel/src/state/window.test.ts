/**
 * window.test.ts — the invariant that matters.
 *
 * Whatever the strategy, cuts land only on turn boundaries and an assistant
 * toolCall is never separated from its toolResult. The first test is a
 * property test: random transcripts × random policies, every cut checked for
 * orphaned halves.
 */
import { describe, expect, test } from "bun:test";

import type { AgentMessage } from "./types";
import {
	applyWindow,
	countImages,
	elisionMarkerText,
	estimateMessageTokens,
	resolveWindowPolicy,
	segmentTurns,
	selectFirstKeptTurn,
	stubOldImages,
} from "./window";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function user(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: 1,
	} as unknown as AgentMessage;
}

function assistantText(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: 1,
	} as unknown as AgentMessage;
}

function assistantCalls(ids: string[]): AgentMessage {
	return {
		role: "assistant",
		content: ids.map((id) => ({
			type: "toolCall",
			id,
			name: "read",
			arguments: { path: `/${id}` },
		})),
		timestamp: 1,
	} as unknown as AgentMessage;
}

function toolResult(id: string, opts: { image?: boolean } = {}): AgentMessage {
	const content: unknown[] = [{ type: "text", text: `result ${id}` }];
	if (opts.image) {
		content.push({ type: "image", data: "AAAAAAAA", mimeType: "image/png" });
	}
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		isError: false,
		content,
		timestamp: 1,
	} as unknown as AgentMessage;
}

// ─── Deterministic PRNG so failures reproduce ──────────────────────────────

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface GeneratedTranscript {
	messages: AgentMessage[];
	/** toolCallId → true when the transcript contains its result. */
	answered: Map<string, boolean>;
}

function generateTranscript(rand: () => number): GeneratedTranscript {
	const messages: AgentMessage[] = [];
	const answered = new Map<string, boolean>();
	const turns = 1 + Math.floor(rand() * 8);
	let callSeq = 0;
	for (let t = 0; t < turns; t += 1) {
		messages.push(user(`prompt ${t}`));
		const steps = Math.floor(rand() * 4);
		for (let s = 0; s < steps; s += 1) {
			const callCount = 1 + Math.floor(rand() * 3);
			const ids: string[] = [];
			for (let c = 0; c < callCount; c += 1) ids.push(`tc${callSeq++}`);
			messages.push(assistantCalls(ids));
			// A user message that lands while calls are open (steering) must not
			// open a new turn — that is the case the invariant has to survive.
			if (rand() < 0.25) messages.push(user(`steer ${t}.${s}`));
			for (const id of ids) {
				messages.push(toolResult(id, { image: rand() < 0.2 }));
				answered.set(id, true);
			}
		}
		if (rand() < 0.8) messages.push(assistantText(`answer ${t}`));
	}
	return { messages, answered };
}

interface PairCheck {
	orphanedResults: string[];
	lostResults: string[];
}

function checkPairs(
	windowMessages: AgentMessage[],
	answered: Map<string, boolean>,
): PairCheck {
	const seenCalls = new Set<string>();
	const seenResults = new Set<string>();
	const orphanedResults: string[] = [];
	for (const message of windowMessages) {
		const m = message as unknown as {
			role?: string;
			content?: unknown;
			toolCallId?: string;
		};
		if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const block of m.content as Array<{ type?: string; id?: string }>) {
				if (block?.type === "toolCall" && block.id) seenCalls.add(block.id);
			}
		}
		if (m.role === "toolResult" && typeof m.toolCallId === "string") {
			seenResults.add(m.toolCallId);
			if (!seenCalls.has(m.toolCallId)) orphanedResults.push(m.toolCallId);
		}
	}
	// A call whose result existed in the full transcript must keep it.
	const lostResults = [...seenCalls].filter(
		(id) => answered.get(id) === true && !seenResults.has(id),
	);
	return { orphanedResults, lostResults };
}

describe("window — pair-safe turn-boundary cuts", () => {
	test("no cut under any strategy orphans a toolResult or drops a call's result", () => {
		const policies = [
			resolveWindowPolicy({ strategy: "turns", maxTurns: 1 }),
			resolveWindowPolicy({ strategy: "turns", maxTurns: 2 }),
			resolveWindowPolicy({ strategy: "turns", maxTurns: 5 }),
			resolveWindowPolicy({ strategy: "token-budget", maxTokens: 1 }),
			resolveWindowPolicy({ strategy: "token-budget", maxTokens: 200 }),
			resolveWindowPolicy({ strategy: "token-budget", maxTokens: 5_000 }),
		];
		for (let seed = 1; seed <= 200; seed += 1) {
			const rand = mulberry32(seed);
			const { messages, answered } = generateTranscript(rand);
			for (const policy of policies) {
				const windowed = applyWindow(messages, policy);
				const { orphanedResults, lostResults } = checkPairs(
					windowed.messages,
					answered,
				);
				expect({ seed, strategy: policy.strategy, orphanedResults }).toEqual({
					seed,
					strategy: policy.strategy,
					orphanedResults: [],
				});
				expect({ seed, strategy: policy.strategy, lostResults }).toEqual({
					seed,
					strategy: policy.strategy,
					lostResults: [],
				});
			}
		}
	});

	test("every cut point is the start of a turn", () => {
		for (let seed = 1; seed <= 60; seed += 1) {
			const { messages } = generateTranscript(mulberry32(seed));
			const turns = segmentTurns(messages);
			const starts = new Set(turns.map((t) => t.start));
			for (let maxTurns = 1; maxTurns <= 6; maxTurns += 1) {
				const policy = resolveWindowPolicy({ strategy: "turns", maxTurns });
				const first = selectFirstKeptTurn(messages, turns, policy);
				expect(starts.has(turns[first].start)).toBe(true);
			}
		}
	});

	test("a user message arriving while tool calls are open does not open a turn", () => {
		const messages = [
			user("go"),
			assistantCalls(["a"]),
			user("actually, also check b"),
			toolResult("a"),
			assistantText("done"),
			user("next"),
		];
		expect(segmentTurns(messages)).toEqual([
			{ start: 0, end: 5 },
			{ start: 5, end: 6 },
		]);
	});

	test("an empty transcript windows to nothing", () => {
		const result = applyWindow([], resolveWindowPolicy());
		expect(result.messages).toEqual([]);
		expect(result.totalTurns).toBe(0);
		expect(result.elisionMarker).toBeNull();
	});
});

describe("window — sizing strategies", () => {
	function turnsOf(count: number): AgentMessage[] {
		const messages: AgentMessage[] = [];
		for (let i = 1; i <= count; i += 1) {
			messages.push(user(`q${i}`), assistantText(`a${i}`));
		}
		return messages;
	}

	test("'turns' keeps exactly the last N turns", () => {
		const messages = turnsOf(14);
		const result = applyWindow(
			messages,
			resolveWindowPolicy({ strategy: "turns", maxTurns: 8 }),
		);
		expect(result.totalTurns).toBe(14);
		expect(result.elidedTurns).toBe(6);
		expect(result.messages).toHaveLength(16);
		expect(result.messages[0]).toBe(messages[12]);
		expect(result.elisionMarker).toBe("[turns 1–6 elided]");
	});

	test("'turns' with more room than history keeps everything and marks nothing", () => {
		const messages = turnsOf(3);
		const result = applyWindow(
			messages,
			resolveWindowPolicy({ strategy: "turns", maxTurns: 50 }),
		);
		expect(result.messages).toEqual(messages);
		expect(result.elidedTurns).toBe(0);
		expect(result.elisionMarker).toBeNull();
	});

	test("'token-budget' fills the ceiling and stops on a turn boundary", () => {
		const messages: AgentMessage[] = [];
		for (let i = 1; i <= 10; i += 1) {
			// ~100 tokens of assistant text per turn at charsPerToken 4.
			messages.push(user(`q${i}`), assistantText("x".repeat(400)));
		}
		const policy = resolveWindowPolicy({
			strategy: "token-budget",
			maxTokens: 350,
			charsPerToken: 4,
		});
		const result = applyWindow(messages, policy);
		const used = result.messages.reduce(
			(sum, m) => sum + estimateMessageTokens(m, policy),
			0,
		);
		expect(used).toBeLessThanOrEqual(350);
		// 3 turns fit (~101 tokens each); a 4th would break the ceiling.
		expect(result.messages).toHaveLength(6);
		expect(result.elidedTurns).toBe(7);
	});

	test("'token-budget' always keeps the live turn, even over budget", () => {
		const messages = [user("q"), assistantText("y".repeat(100_000))];
		const result = applyWindow(
			messages,
			resolveWindowPolicy({ strategy: "token-budget", maxTokens: 10 }),
		);
		expect(result.messages).toHaveLength(2);
		expect(result.elidedTurns).toBe(0);
	});

	test("images cost tokens in the estimate", () => {
		const policy = resolveWindowPolicy({ imageTokens: 1_000 });
		const withImage = toolResult("a", { image: true });
		const withoutImage = toolResult("a");
		expect(estimateMessageTokens(withImage, policy)).toBe(
			estimateMessageTokens(withoutImage, policy) + 1_000,
		);
	});

	test("elision marker singularizes", () => {
		expect(elisionMarkerText(1)).toBe("[turn 1 elided]");
		expect(elisionMarkerText(5)).toBe("[turns 1–5 elided]");
	});
});

describe("window — image stubbing", () => {
	test("images past the newest-K cap become one-line text stubs", () => {
		const messages = [
			toolResult("a", { image: true }),
			toolResult("b", { image: true }),
			toolResult("c", { image: true }),
		];
		const { messages: stubbed, stubbed: count } = stubOldImages(messages, 1);
		expect(count).toBe(2);
		expect(countImages(stubbed[0])).toBe(0);
		expect(countImages(stubbed[1])).toBe(0);
		// The newest image survives untouched, by reference.
		expect(countImages(stubbed[2])).toBe(1);
		expect(stubbed[2]).toBe(messages[2]);

		const firstBlocks = (stubbed[0] as unknown as { content: any[] }).content;
		expect(firstBlocks[1]).toEqual({
			type: "text",
			text: "[image elided — image/png, 6 B]",
		});
	});

	test("a null cap keeps every image and returns the input array", () => {
		const messages = [toolResult("a", { image: true })];
		const result = stubOldImages(messages, null);
		expect(result.messages).toBe(messages);
		expect(result.stubbed).toBe(0);
	});

	test("maxImages 0 stubs everything", () => {
		const messages = [toolResult("a", { image: true })];
		const result = stubOldImages(messages, 0);
		expect(result.stubbed).toBe(1);
		expect(countImages(result.messages[0])).toBe(0);
	});

	test("stubbing never mutates the source transcript", () => {
		const messages = [
			toolResult("a", { image: true }),
			toolResult("b", { image: true }),
		];
		const before = JSON.stringify(messages);
		stubOldImages(messages, 0);
		expect(JSON.stringify(messages)).toBe(before);
	});

	test("applyWindow stubs inside the window it kept", () => {
		const messages = [
			user("q1"),
			toolResult("a", { image: true }),
			user("q2"),
			toolResult("b", { image: true }),
			user("q3"),
			toolResult("c", { image: true }),
		];
		const result = applyWindow(
			messages,
			resolveWindowPolicy({ strategy: "turns", maxTurns: 2, maxImages: 1 }),
		);
		expect(result.messages).toHaveLength(4);
		expect(result.stubbedImages).toBe(1);
		expect(result.elidedTurns).toBe(1);
	});
});

describe("window — policy resolution", () => {
	test("defaults apply when nothing is configured", () => {
		expect(resolveWindowPolicy()).toEqual({
			strategy: "turns",
			maxTurns: 8,
			maxTokens: 60_000,
			charsPerToken: 4,
			imageTokens: 1_600,
			maxImages: 4,
			elisionMarker: true,
		});
	});

	test("nonsense values fall back to defaults rather than breaking the window", () => {
		const resolved = resolveWindowPolicy({ maxTurns: 0, charsPerToken: -3 });
		expect(resolved.maxTurns).toBe(8);
		expect(resolved.charsPerToken).toBe(4);
	});

	test("a negative maxImages disables the cap", () => {
		expect(resolveWindowPolicy({ maxImages: -1 }).maxImages).toBeNull();
	});
});
