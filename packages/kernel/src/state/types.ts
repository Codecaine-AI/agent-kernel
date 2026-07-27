/**
 * types.ts — the state contract (docs/10-system-design/explainers/state-shapes.html).
 *
 * One state object per agent; the messages are part of the state. Every
 * request the model receives is three sections:
 *
 *   ① system prompt   — Pi's, untouched
 *   ② context message — rebuilt each request from the kernel-held L2 set
 *   ③ render(state)   — the state block(s) plus however much recent
 *                       conversation the renderer emits as REAL messages
 *
 * There is deliberately NO universal state schema. An agent with no `state.ts`
 * sidecar and no window config behaves EXACTLY like a normal agent — the state
 * extension is not even registered. An agent that wants more ships a `state.ts`
 * exporting seed / update / render; the kernel owns *when* they run, the agent
 * owns *what* they mean.
 */

import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import type { SpawnContext } from "../context";

/**
 * Pi's message type. `@earendil-works/pi-coding-agent` re-exports the hook
 * surface but not the message union itself, so we take it from the one hook
 * that carries it — the same array the context hook rewrites.
 */
export type AgentMessage = ContextEvent["messages"][number];

// ─── Session events (the `update` input) ────────────────────────────────────

/**
 * Fields every kernel session event carries. Events are derived from the Pi
 * message array in array order, so `messageIndex` doubles as the kernel's
 * catch-up cursor: an event set is fully applied once the cursor has passed
 * every message it was derived from.
 */
export interface SessionEventBase {
	/** Monotonic 0-based sequence number within one extension instance. */
	seq: number;
	/** Index of the session message this event was derived from. */
	messageIndex: number;
	/** Wall clock (ms) when the kernel folded the event into the state. */
	timestamp: number;
}

/** A user message landed (the prompt, a steering message, a follow-up). */
export interface StateUserMessageEvent extends SessionEventBase {
	kind: "user_message";
	/** Flattened text of the message; "" for an image-only message. */
	text: string;
	imageCount: number;
}

/** The assistant asked for a tool. One event per toolCall block. */
export interface StateToolCallEvent extends SessionEventBase {
	kind: "tool_call";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
}

/** A tool returned. */
export interface StateToolResultEvent extends SessionEventBase {
	kind: "tool_result";
	toolCallId: string;
	toolName: string;
	isError: boolean;
	/** Flattened text of the result content blocks. */
	text: string;
	imageCount: number;
}

/**
 * A turn boundary. Unlike the other three this is hook-derived (Pi's blocking
 * `turn_end`), not message-derived — the catch-up pass cannot reconstruct one,
 * by design: turn boundaries are the kernel's, not the transcript's.
 */
export interface StateTurnEndEvent extends SessionEventBase {
	kind: "turn_end";
	turnIndex: number;
	stopReason?: string;
}

/** Everything `update` can be handed. Minimal and kernel-owned. */
export type SessionEvent =
	| StateUserMessageEvent
	| StateToolCallEvent
	| StateToolResultEvent
	| StateTurnEndEvent;

/** Alias for callers that already have a `SessionEvent` in scope (Pi has one). */
export type KernelSessionEvent = SessionEvent;

/** Omit that distributes over a union instead of collapsing it. */
type DistributiveOmit<T, K extends keyof any> = T extends unknown
	? Omit<T, K>
	: never;

/**
 * An event before the kernel stamps `seq` and `timestamp` on it — what the
 * derivation helpers produce.
 */
export type SessionEventInput = DistributiveOmit<
	SessionEvent,
	"seq" | "timestamp"
>;

// ─── Window policy ─────────────────────────────────────────────────────────

export type WindowStrategy = "turns" | "token-budget";

/**
 * Per-agent window configuration. The kernel ships the sizing strategies; each
 * agent picks and tunes one. The pair-safe turn-boundary cut is the ONLY
 * invariant — it is not configurable.
 */
export interface WindowPolicy {
	/** "turns" keeps the last N turns; "token-budget" fills a token ceiling. */
	strategy?: WindowStrategy;
	/** strategy "turns": how many most-recent turns stay verbatim. */
	maxTurns?: number;
	/** strategy "token-budget": approximate token ceiling for the window. */
	maxTokens?: number;
	/** Estimator: characters per token. */
	charsPerToken?: number;
	/** Estimator: tokens charged per image block. */
	imageTokens?: number;
	/**
	 * Newest-K image cap. Image blocks inside the window beyond the K newest
	 * become one-line text stubs. `0` stubs every image; omit to keep all.
	 */
	maxImages?: number;
	/** Emit the "[turns 1–5 elided]" marker when history was cut. Default true. */
	elisionMarker?: boolean;
}

export interface ResolvedWindowPolicy {
	strategy: WindowStrategy;
	maxTurns: number;
	maxTokens: number;
	charsPerToken: number;
	imageTokens: number;
	maxImages: number | null;
	elisionMarker: boolean;
}

// ─── The contract ──────────────────────────────────────────────────────────

/** Per-request information handed to `render`. */
export interface RenderContext {
	agentName: string;
	containerId?: string;
	/**
	 * The messages Pi is about to send — the conversation component of the
	 * state. Renderers window over this instead of duplicating it into S.
	 */
	messages: AgentMessage[];
	/** 0-based index of the turn about to run. */
	turnIndex: number;
	/** The agent's resolved window policy. */
	window: ResolvedWindowPolicy;
}

/**
 * What `render` may return when it wants the kernel to tag section boundaries:
 * the leading `stateMessageCount` messages are section ③'s state block(s), the
 * rest is the conversation tail.
 */
export interface RenderResult {
	messages: AgentMessage[];
	/** Leading messages that are state block(s). Defaults to 0 (all tail). */
	stateMessageCount?: number;
}

/** A bare array is the plain form — every message counts as tail. */
export type RenderOutput = AgentMessage[] | RenderResult;

/**
 * The `state.ts` sidecar contract. `S` is whatever the agent needs — the
 * kernel never looks inside. One requirement: `S` MUST be JSON-serializable,
 * because it snapshots to state.json.
 */
export interface StateModule<S = unknown> {
	/**
	 * Build the initial state at spawn. `ctx` is the same SpawnContext the
	 * context loaders get today. `prior` is a previous run's final state passed
	 * in explicitly by the caller — never auto-loaded.
	 */
	seed(ctx: SpawnContext, prior?: S): S;
	/**
	 * Advance the state. Called as each event lands, in order, via Pi's
	 * blocking hooks (plus the context hook's catch-up pass).
	 */
	update(state: S, event: SessionEvent): S;
	/** Produce section ③ of the request. */
	render(state: S, ctx: RenderContext): RenderOutput;
	/** Window policy default for agents shipping this module. Config wins. */
	window?: WindowPolicy;
}

// `defineState` — the typed identity helper for a `state.ts` sidecar — lives
// in ../agent-definition next to defineContext / defineTools.

// ─── Request sections ──────────────────────────────────────────────────────

export type RequestSectionKind = "context" | "state" | "tail";

/**
 * Half-open [start, end) range over the built request's ordered message list.
 * Structurally identical to protocol's PiRequestSnapshotSection so a built
 * request's sections can be stamped straight onto a snapshot.
 */
export interface RequestSection {
	kind: RequestSectionKind;
	start: number;
	end: number;
}

export interface BuiltRequest {
	messages: AgentMessage[];
	sections: RequestSection[];
}

// ─── Persistence ───────────────────────────────────────────────────────────

/**
 * One state.json write. `state` is the agent's own S — opaque here, but it
 * must survive JSON.stringify / JSON.parse.
 */
export interface StateSnapshot {
	containerId: string;
	agentName: string;
	runId?: string;
	/** 1-based, incremented per snapshot within one extension instance. */
	version: number;
	updatedAt: string;
	state: unknown;
}

/**
 * The sink seam for state — same submit()/flush() shape as TraceWriterSink, so
 * the sandbox stage swaps a remote sink in without touching the extension.
 */
export interface StateSink {
	submit(snapshot: StateSnapshot): void;
	flush(): Promise<void>;
}

export interface StateLoggerLike {
	error(message: string, data?: Record<string, unknown>): void;
}
