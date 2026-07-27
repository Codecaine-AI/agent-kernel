/**
 * extension.ts — the kernel's side of the contract, wired to Pi's hooks.
 *
 * Measured on Pi 0.82.1: `tool_result`, `message_end` and `turn_end` block in
 * order, and `context` fires before every provider request and is the only
 * hook that can rewrite the outgoing array — non-destructively, so its result
 * affects one request and never feeds forward.
 *
 *   message_end / tool_result → fold the events that landed
 *   turn_end                  → fold, add the turn boundary, snapshot state.json
 *   context                   → catch up (usually a no-op), then return
 *                               [contextMessage, ...render(state)]
 *   agent_settled             → end-of-prompt flush
 *
 * Catch-up is what makes a retry or a prompt's first request unable to see
 * stale state: every event is derived from the session message array in array
 * order against a single cursor, so "apply what update hasn't seen yet" is one
 * comparison when everything is current.
 *
 * Compaction is disabled in createPiSession; nothing here ever compacts.
 */

import type {
	ExtensionAPI,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import type { SpawnContext } from "../context";
import { baseStateModule } from "./base";
import { buildRequest } from "./builder";
import { createContextSet, type ContextEntry, type ContextSet } from "./context-set";
import type {
	AgentMessage,
	BuiltRequest,
	RenderContext,
	SessionEvent,
	SessionEventInput,
	StateLoggerLike,
	StateModule,
	StateSink,
	WindowPolicy,
} from "./types";
import { countImages, messageText, resolveWindowPolicy } from "./window";

/** The slice of a live Pi AgentSession the extension reads. */
export interface StateSessionLike {
	messages: AgentMessage[];
}

export interface StateExtensionOptions<S = unknown> {
	agentName: string;
	/** Primary grouping identity; also the state.json directory. */
	containerId?: string;
	runId?: string;
	/** The agent's `state.ts` sidecar. Omit for base behavior. */
	module?: StateModule<S> | null;
	/** Per-agent window configuration. Overrides `module.window`. */
	window?: WindowPolicy | null;
	/** Same SpawnContext the context loaders get today. */
	spawnContext: SpawnContext;
	/** A previous run's final state, passed explicitly. Never auto-loaded. */
	priorState?: S;
	/** Seeds the L2 set behind section ②. */
	contextEntries?: ContextEntry[];
	/** Where state.json snapshots go. Omit to skip persistence. */
	sink?: StateSink | null;
	logger?: StateLoggerLike;
}

export interface StateExtensionHandle<S = unknown> {
	/** Register this in createPiSession's extensionFactories. */
	readonly factory: ExtensionFactory;
	/** The L2 set behind section ② — add/remove entries at any time. */
	readonly contextSet: ContextSet;
	/** Point the extension at the live session (after createAgentSession). */
	bindSession(session: StateSessionLike): void;
	/** Observe every request the builder assembles (the recorder's hook). */
	onRequestBuilt(listener: (built: BuiltRequest) => void): void;
	getState(): S;
	/** The most recently built request, or null before the first one. */
	lastRequest(): BuiltRequest | null;
	/** Fold pending message-derived events now. Cheap no-op when current. */
	catchUp(messages?: AgentMessage[]): number;
	/** Build the request for a given outgoing message array (test seam). */
	build(messages: AgentMessage[]): BuiltRequest;
	/** Write a state.json snapshot now. */
	snapshot(): void;
	flush(): Promise<void>;
}

/**
 * True when an agent bundle asked for anything beyond pass-through. With
 * neither a state module nor window config the extension must not be
 * registered at all — existing agents keep byte-identical behavior.
 */
export function stateExtensionEnabled(input: {
	module?: StateModule<any> | null;
	window?: WindowPolicy | null;
}): boolean {
	return Boolean(input.module) || Boolean(input.window);
}

interface MessageLike {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	[key: string]: unknown;
}

interface BlockLike {
	type?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
	[key: string]: unknown;
}

/** Derive the kernel's session events from one transcript message. */
export function deriveEvents(
	message: AgentMessage,
	messageIndex: number,
): SessionEventInput[] {
	const m = message as unknown as MessageLike;
	switch (m.role) {
		case "user":
			return [
				{
					kind: "user_message",
					messageIndex,
					text: messageText(message),
					imageCount: countImages(message),
				},
			];
		case "assistant": {
			const blocks = Array.isArray(m.content) ? (m.content as BlockLike[]) : [];
			const events: SessionEventInput[] = [];
			for (const block of blocks) {
				if (block?.type !== "toolCall") continue;
				events.push({
					kind: "tool_call",
					messageIndex,
					toolCallId: typeof block.id === "string" ? block.id : "",
					toolName: typeof block.name === "string" ? block.name : "",
					input:
						block.arguments && typeof block.arguments === "object"
							? (block.arguments as Record<string, unknown>)
							: {},
				});
			}
			return events;
		}
		case "toolResult":
			return [
				{
					kind: "tool_result",
					messageIndex,
					toolCallId: typeof m.toolCallId === "string" ? m.toolCallId : "",
					toolName: typeof m.toolName === "string" ? m.toolName : "",
					isError: m.isError === true,
					text: messageText(message),
					imageCount: countImages(message),
				},
			];
		default:
			// custom / bashExecution / branchSummary / compactionSummary carry no
			// kernel event — they are transcript furniture, not state input.
			return [];
	}
}

export function createStateExtension<S = unknown>(
	opts: StateExtensionOptions<S>,
): StateExtensionHandle<S> {
	const module = (opts.module ?? baseStateModule) as StateModule<S>;
	const window = resolveWindowPolicy(opts.window ?? module.window ?? null);
	const contextSet = createContextSet(opts.contextEntries ?? []);
	const sink = opts.sink ?? null;
	const listeners: Array<(built: BuiltRequest) => void> = [];

	let state: S = module.seed(opts.spawnContext as SpawnContext, opts.priorState);
	let session: StateSessionLike | null = null;
	let cursor = 0;
	let seq = 0;
	let turnIndex = 0;
	let version = 0;
	let lastBuilt: BuiltRequest | null = null;

	function logError(context: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		opts.logger?.error(`agent state ${context} failed`, {
			error: message,
			agentName: opts.agentName,
		});
	}

	function transcript(fallback?: AgentMessage[]): AgentMessage[] {
		if (session && Array.isArray(session.messages)) return session.messages;
		return fallback ?? [];
	}

	function fold(event: SessionEventInput): void {
		const full = {
			...event,
			seq: seq++,
			timestamp: Date.now(),
		} as SessionEvent;
		state = module.update(state, full);
	}

	/**
	 * Apply everything the cursor has not seen. Returns how many events were
	 * folded — 0 is the steady state, and costs one length comparison.
	 */
	function pump(fallback?: AgentMessage[]): number {
		const messages = transcript(fallback);
		if (messages.length < cursor) {
			// The branch shrank (fork / tree navigation): re-anchor rather than
			// re-fold history that the state already contains.
			cursor = messages.length;
			return 0;
		}
		if (messages.length === cursor) return 0;
		let applied = 0;
		for (let i = cursor; i < messages.length; i += 1) {
			for (const event of deriveEvents(messages[i], i)) {
				fold(event);
				applied += 1;
			}
		}
		cursor = messages.length;
		return applied;
	}

	function snapshot(): void {
		if (!sink) return;
		version += 1;
		try {
			sink.submit({
				containerId: opts.containerId ?? "unknown",
				agentName: opts.agentName,
				...(opts.runId !== undefined && { runId: opts.runId }),
				version,
				updatedAt: new Date().toISOString(),
				state,
			});
		} catch (error) {
			logError("snapshot", error);
		}
	}

	function build(messages: AgentMessage[]): BuiltRequest {
		const renderCtx: RenderContext = {
			agentName: opts.agentName,
			...(opts.containerId !== undefined && { containerId: opts.containerId }),
			messages,
			turnIndex,
			window,
		};
		const built = buildRequest({
			contextMessage: contextSet.render(),
			rendered: module.render(state, renderCtx),
		});
		lastBuilt = built;
		for (const listener of listeners) {
			try {
				listener(built);
			} catch (error) {
				logError("request listener", error);
			}
		}
		return built;
	}

	const factory: ExtensionFactory = (pi: ExtensionAPI) => {
		pi.on("message_end", () => {
			try {
				pump();
			} catch (error) {
				logError("message_end", error);
			}
		});

		pi.on("tool_result", () => {
			try {
				pump();
			} catch (error) {
				logError("tool_result", error);
			}
		});

		pi.on("turn_end", (event) => {
			try {
				pump();
				const index =
					typeof event.turnIndex === "number" ? event.turnIndex : turnIndex;
				const stopReason = (event.message as { stopReason?: string } | undefined)
					?.stopReason;
				fold({
					kind: "turn_end",
					messageIndex: cursor,
					turnIndex: index,
					...(stopReason !== undefined && { stopReason }),
				});
				turnIndex = index + 1;
				snapshot();
			} catch (error) {
				logError("turn_end", error);
			}
		});

		pi.on("context", (event) => {
			try {
				// Catch-up: anything `update` has not seen lands before we render.
				pump(event.messages);
				const built = build(event.messages);
				return { messages: built.messages };
			} catch (error) {
				logError("context", error);
				// Pass through untouched rather than break the request.
				return undefined;
			}
		});

		pi.on("agent_settled", () => {
			try {
				snapshot();
			} catch (error) {
				logError("agent_settled", error);
			}
		});
	};

	return {
		factory,
		contextSet,
		bindSession(next: StateSessionLike): void {
			session = next;
		},
		onRequestBuilt(listener): void {
			listeners.push(listener);
		},
		getState: () => state,
		lastRequest: () => lastBuilt,
		catchUp: (messages) => pump(messages),
		build,
		snapshot,
		async flush(): Promise<void> {
			await sink?.flush();
		},
	};
}
