/**
 * window.ts — sizing strategies, pair-safe turn-boundary cuts, image stubbing.
 *
 * Window policy is per-agent configuration, not a kernel rule: the kernel
 * ships the strategies ("turns", "token-budget") and each agent's config picks
 * and tunes one. The ONE invariant, whatever the strategy:
 *
 *   cuts land only on turn boundaries — an assistant toolCall and its
 *   toolResult are NEVER split, because providers reject orphaned halves.
 *
 * That invariant is structural here, not a check: turns are segmented so a
 * turn can never end while a toolCall is still unanswered, and every cut is a
 * turn boundary. See window.test.ts for the property test over random
 * transcripts and random cuts.
 */

import type {
	AgentMessage,
	ResolvedWindowPolicy,
	WindowPolicy,
} from "./types";

export const DEFAULT_WINDOW: ResolvedWindowPolicy = {
	strategy: "turns",
	maxTurns: 8,
	maxTokens: 60_000,
	charsPerToken: 4,
	imageTokens: 1_600,
	maxImages: 4,
	elisionMarker: true,
};

export function resolveWindowPolicy(
	policy?: WindowPolicy | null,
): ResolvedWindowPolicy {
	if (!policy) return { ...DEFAULT_WINDOW };
	return {
		strategy: policy.strategy ?? DEFAULT_WINDOW.strategy,
		maxTurns:
			policy.maxTurns !== undefined && policy.maxTurns > 0
				? Math.floor(policy.maxTurns)
				: DEFAULT_WINDOW.maxTurns,
		maxTokens:
			policy.maxTokens !== undefined && policy.maxTokens > 0
				? Math.floor(policy.maxTokens)
				: DEFAULT_WINDOW.maxTokens,
		charsPerToken:
			policy.charsPerToken !== undefined && policy.charsPerToken > 0
				? policy.charsPerToken
				: DEFAULT_WINDOW.charsPerToken,
		imageTokens:
			policy.imageTokens !== undefined && policy.imageTokens >= 0
				? policy.imageTokens
				: DEFAULT_WINDOW.imageTokens,
		maxImages:
			policy.maxImages === undefined
				? DEFAULT_WINDOW.maxImages
				: policy.maxImages === null || policy.maxImages < 0
					? null
					: Math.floor(policy.maxImages),
		elisionMarker: policy.elisionMarker ?? DEFAULT_WINDOW.elisionMarker,
	};
}

// ─── Message shape helpers (AgentMessage is an open union) ─────────────────

interface BlockLike {
	type?: string;
	text?: string;
	thinking?: string;
	data?: string;
	mimeType?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
	[key: string]: unknown;
}

interface MessageLike {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	[key: string]: unknown;
}

function asMessage(message: AgentMessage): MessageLike {
	return message as unknown as MessageLike;
}

function blocksOf(message: AgentMessage): BlockLike[] {
	const content = asMessage(message).content;
	return Array.isArray(content) ? (content as BlockLike[]) : [];
}

/** Flattened text of a message: string content, or every text/thinking block. */
export function messageText(message: AgentMessage): string {
	const content = asMessage(message).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content as BlockLike[]) {
		if (block?.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

export function countImages(message: AgentMessage): number {
	let n = 0;
	for (const block of blocksOf(message)) if (block?.type === "image") n += 1;
	return n;
}

/** toolCall ids requested by an assistant message. */
export function toolCallIdsOf(message: AgentMessage): string[] {
	if (asMessage(message).role !== "assistant") return [];
	const ids: string[] = [];
	for (const block of blocksOf(message)) {
		if (block?.type === "toolCall" && typeof block.id === "string") {
			ids.push(block.id);
		}
	}
	return ids;
}

// ─── Turn segmentation ─────────────────────────────────────────────────────

/** Half-open [start, end) range of message indices forming one turn. */
export interface Turn {
	start: number;
	end: number;
}

/**
 * Segment a transcript into turns. A turn opens at a `user` message and runs
 * until the next one — EXCEPT while tool calls are still unanswered, where a
 * user message (steering, a follow-up delivered mid-flight) is absorbed into
 * the open turn instead of starting a new one. That exception is what makes
 * every turn boundary a pair-safe cut point.
 *
 * Messages before the first user message form a leading turn of their own.
 */
export function segmentTurns(messages: AgentMessage[]): Turn[] {
	const turns: Turn[] = [];
	let start = -1;
	const openToolCalls = new Set<string>();

	for (let i = 0; i < messages.length; i += 1) {
		const message = messages[i];
		const role = asMessage(message).role;
		if (start === -1) {
			start = i;
		} else if (role === "user" && openToolCalls.size === 0) {
			turns.push({ start, end: i });
			start = i;
		}
		for (const id of toolCallIdsOf(message)) openToolCalls.add(id);
		if (role === "toolResult") {
			const id = asMessage(message).toolCallId;
			if (typeof id === "string") openToolCalls.delete(id);
		}
	}
	if (start !== -1) turns.push({ start, end: messages.length });
	return turns;
}

// ─── Sizing strategies ─────────────────────────────────────────────────────

export function estimateMessageTokens(
	message: AgentMessage,
	policy: ResolvedWindowPolicy,
): number {
	let chars = 0;
	const content = asMessage(message).content;
	if (typeof content === "string") {
		chars += content.length;
	} else {
		for (const block of blocksOf(message)) {
			if (typeof block.text === "string") chars += block.text.length;
			if (typeof block.thinking === "string") chars += block.thinking.length;
			if (block.type === "toolCall") {
				chars += JSON.stringify(block.arguments ?? {}).length;
				chars += (block.name ?? "").length;
			}
		}
	}
	const images = countImages(message);
	return Math.ceil(chars / policy.charsPerToken) + images * policy.imageTokens;
}

export function estimateTurnTokens(
	messages: AgentMessage[],
	turn: Turn,
	policy: ResolvedWindowPolicy,
): number {
	let total = 0;
	for (let i = turn.start; i < turn.end; i += 1) {
		total += estimateMessageTokens(messages[i], policy);
	}
	return total;
}

/**
 * Pick the index of the first KEPT turn. Every strategy returns a turn index,
 * which is why every cut is automatically a turn boundary. At least one turn
 * (the live one) always survives.
 */
export function selectFirstKeptTurn(
	messages: AgentMessage[],
	turns: Turn[],
	policy: ResolvedWindowPolicy,
): number {
	if (turns.length === 0) return 0;
	if (policy.strategy === "token-budget") {
		let used = 0;
		let first = turns.length - 1;
		for (let t = turns.length - 1; t >= 0; t -= 1) {
			const cost = estimateTurnTokens(messages, turns[t], policy);
			if (t < turns.length - 1 && used + cost > policy.maxTokens) break;
			used += cost;
			first = t;
		}
		return first;
	}
	return Math.max(0, turns.length - policy.maxTurns);
}

// ─── Image stubbing ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function imageStubText(block: BlockLike): string {
	const mimeType =
		typeof block.mimeType === "string" ? block.mimeType : "image";
	const b64 = typeof block.data === "string" ? block.data : "";
	// base64 → bytes, close enough for a one-line stub.
	const bytes = Math.floor((b64.length * 3) / 4);
	return `[image elided — ${mimeType}, ${formatBytes(bytes)}]`;
}

/**
 * Replace image blocks beyond the newest-K cap with one-line text stubs.
 * Walks newest → oldest so the K most recent images survive. Never mutates the
 * input: only messages that actually change are cloned.
 */
export function stubOldImages(
	messages: AgentMessage[],
	maxImages: number | null,
): { messages: AgentMessage[]; stubbed: number } {
	if (maxImages === null) return { messages, stubbed: 0 };
	let budget = maxImages;
	let stubbed = 0;
	const out = messages.slice();
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const blocks = blocksOf(messages[i]);
		if (blocks.length === 0) continue;
		let changed = false;
		// Within a message, later blocks are newer.
		const next = blocks.slice();
		for (let b = blocks.length - 1; b >= 0; b -= 1) {
			const block = blocks[b];
			if (block?.type !== "image") continue;
			if (budget > 0) {
				budget -= 1;
				continue;
			}
			next[b] = { type: "text", text: imageStubText(block) };
			changed = true;
			stubbed += 1;
		}
		if (changed) {
			out[i] = {
				...(messages[i] as object),
				content: next,
			} as unknown as AgentMessage;
		}
	}
	return { messages: out, stubbed };
}

// ─── The window ────────────────────────────────────────────────────────────

export interface WindowResult {
	/** The kept messages, image-stubbed, in transcript order. */
	messages: AgentMessage[];
	/** Total turns in the transcript. */
	totalTurns: number;
	/** How many leading turns were dropped. */
	elidedTurns: number;
	/** "[turns 1–5 elided]" — null when nothing was cut or markers are off. */
	elisionMarker: string | null;
	/** How many image blocks became one-line stubs. */
	stubbedImages: number;
}

export function elisionMarkerText(elidedTurns: number): string {
	return elidedTurns === 1
		? "[turn 1 elided]"
		: `[turns 1–${elidedTurns} elided]`;
}

/**
 * Roll a window over a transcript: pick a first-kept turn with the configured
 * strategy, cut there (always a turn boundary), then stub images past the
 * newest-K cap inside what survived.
 */
export function applyWindow(
	messages: AgentMessage[],
	policy: ResolvedWindowPolicy,
): WindowResult {
	const turns = segmentTurns(messages);
	if (turns.length === 0) {
		return {
			messages: [],
			totalTurns: 0,
			elidedTurns: 0,
			elisionMarker: null,
			stubbedImages: 0,
		};
	}
	const firstKept = selectFirstKeptTurn(messages, turns, policy);
	const kept = messages.slice(turns[firstKept].start);
	const { messages: stubbedMessages, stubbed } = stubOldImages(
		kept,
		policy.maxImages,
	);
	return {
		messages: stubbedMessages,
		totalTurns: turns.length,
		elidedTurns: firstKept,
		elisionMarker:
			firstKept > 0 && policy.elisionMarker
				? elisionMarkerText(firstKept)
				: null,
		stubbedImages: stubbed,
	};
}
