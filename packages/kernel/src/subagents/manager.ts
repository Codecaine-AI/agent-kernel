import { randomUUID } from "node:crypto";

import type { RunTrigger } from "@agent-kernel/db";
import { createRunSteeredEvent } from "@agent-kernel/protocol";

import { runContextStore } from "../run-context";
import type {
	AgentRecord,
	KernelExtensionAPI,
	KernelExtensionContext,
	OnAgentComplete,
	OnAgentStart,
	SpawnOptions,
	SubagentType,
	TraceWriterSink,
} from "./types";

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_SUBAGENT_LINK_CUSTOM_TYPE = "agent-kernel:subagent-link";

export interface AgentSpawnResult {
	responseText: string;
	session: {
		messages: any[];
		sessionId: string;
		steer(message: string): Promise<unknown>;
		dispose?: () => void;
	};
	aborted: boolean;
}

export interface AgentSpawnOptions {
	workingDir?: string;
	/** Primary grouping identity forwarded to the spawn pipeline. */
	containerId?: string;
	/** What opened the run — the manager forwards "parent-tool" for subagents. */
	trigger?: RunTrigger;
	/** Session working directory for Pi session storage. */
	sessionDir?: string;
	piSessionsDir?: string;
	variables?: Record<string, unknown>;
	parentRunId?: string;
	parentPiSessionUuid?: string;
	phase?: string;
	displayLabel?: string;
	parentToolUseId?: string;
	signal?: AbortSignal;
	onToolActivity?: (activity: { type: "start" | "end"; toolName: string }) => void;
	onTextDelta?: (delta: string) => void;
	onSessionCreated?: (session: AgentSpawnResult["session"]) => void;
	onTurnEnd?: (turnCount: number) => void;
	/** Fired by the spawn pipeline as soon as the run's identity exists. */
	onRunStarted?: (info: { runId: string; containerId: string }) => void;
}

export type SpawnAgentAdapter = (
	agentName: string,
	prompt: string,
	ctx: KernelExtensionContext | null | undefined,
	options: AgentSpawnOptions,
) => Promise<AgentSpawnResult>;

export interface AgentManagerDeps {
	spawnAgent: SpawnAgentAdapter;
	subagentLinkCustomType?: string;
	/** When present, steering control actions emit run_steered trace events. */
	traceWriter?: TraceWriterSink;
}

interface SpawnArgs {
	pi: KernelExtensionAPI;
	ctx: KernelExtensionContext;
	agentName: string;
	prompt: string;
	options: SpawnOptions;
}

export class AgentManager {
	private agents = new Map<string, AgentRecord>();
	private cleanupInterval: ReturnType<typeof setInterval>;
	private onComplete?: OnAgentComplete;
	private onStart?: OnAgentStart;
	private maxConcurrent: number;
	private spawnAgent: SpawnAgentAdapter;
	private subagentLinkCustomType: string;
	private traceWriter?: TraceWriterSink;
	/** run_steered emissions waiting for the run's trace identity. */
	private deferredSteerEvents = new Map<
		string,
		{ message: string; delivery: "delivered" | "queued" }[]
	>();
	/**
	 * Per-record completion deferreds (D77 background handles). Created at
	 * spawn() so `waitForAgent` works for queued records too — a queued
	 * record has no `promise` until startAgent runs, and a queued record
	 * aborted before starting never gets one at all.
	 */
	private completionWaiters = new Map<
		string,
		{ promise: Promise<AgentRecord>; resolve: (record: AgentRecord) => void }
	>();
	private queue: { id: string; args: SpawnArgs }[] = [];
	private runningBackground = 0;

	constructor(
		onComplete?: OnAgentComplete,
		maxConcurrent = DEFAULT_MAX_CONCURRENT,
		onStart?: OnAgentStart,
		deps?: AgentManagerDeps,
	) {
		if (!deps?.spawnAgent) {
			throw new Error("AgentManager requires a spawnAgent adapter");
		}
		this.onComplete = onComplete;
		this.onStart = onStart;
		this.maxConcurrent = maxConcurrent;
		this.spawnAgent = deps.spawnAgent;
		this.subagentLinkCustomType =
			deps.subagentLinkCustomType ?? DEFAULT_SUBAGENT_LINK_CUSTOM_TYPE;
		this.traceWriter = deps.traceWriter;
		this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
	}

	setMaxConcurrent(n: number): void {
		this.maxConcurrent = Math.max(1, n);
		this.drainQueue();
	}

	getMaxConcurrent(): number {
		return this.maxConcurrent;
	}

	spawn(
		pi: KernelExtensionAPI,
		ctx: KernelExtensionContext,
		agentName: string,
		prompt: string,
		options: SpawnOptions,
	): string {
		const id = randomUUID().slice(0, 17);
		const abortController = new AbortController();
		const type: SubagentType = agentName;

		const record: AgentRecord = {
			id,
			type,
			description: options.description,
			status: options.isBackground ? "queued" : "running",
			isBackground: options.isBackground,
			toolUses: 0,
			startedAt: Date.now(),
			abortController,
		};
		this.agents.set(id, record);
		let resolveCompletion!: (r: AgentRecord) => void;
		const completion = new Promise<AgentRecord>((resolve) => {
			resolveCompletion = resolve;
		});
		this.completionWaiters.set(id, {
			promise: completion,
			resolve: resolveCompletion,
		});

		const args: SpawnArgs = { pi, ctx, agentName, prompt, options };

		if (options.isBackground && this.runningBackground >= this.maxConcurrent) {
			this.queue.push({ id, args });
			return id;
		}

		this.startAgent(id, record, args);
		return id;
	}

	async spawnAndWait(
		pi: KernelExtensionAPI,
		ctx: KernelExtensionContext,
		agentName: string,
		prompt: string,
		options: Omit<SpawnOptions, "isBackground">,
	): Promise<AgentRecord> {
		const id = this.spawn(pi, ctx, agentName, prompt, {
			...options,
			isBackground: false,
		});
		const record = this.agents.get(id)!;
		await record.promise;
		return record;
	}

	private startAgent(
		id: string,
		record: AgentRecord,
		{ ctx, agentName, prompt, options }: SpawnArgs,
	): void {
		record.status = "running";
		record.startedAt = Date.now();
		if (options.isBackground) this.runningBackground++;
		this.onStart?.(record);

		// Track the abort listener so the completion path can remove it: a
		// long-lived coordinator signal would otherwise accrue one listener
		// (and one retained record closure) per dispatched child.
		let detachAbortListener: (() => void) | undefined;
		if (options.signal) {
			if (options.signal.aborted) {
				record.abortController?.abort();
			} else {
				const signal = options.signal;
				const onAbort = () => record.abortController?.abort();
				signal.addEventListener("abort", onAbort, { once: true });
				detachAbortListener = () =>
					signal.removeEventListener("abort", onAbort);
			}
		}

		const parentRunCtx = runContextStore.getStore();
		const parentPiSessionUuid =
			options.parentPiSessionUuid ?? ctx.sessionManager.getSessionId();
		const adapterOptions: AgentSpawnOptions = {
			workingDir: options.workingDir,
			containerId: options.containerId ?? parentRunCtx?.containerId,
			trigger: options.trigger ?? "parent-tool",
			sessionDir: options.sessionDir ?? parentRunCtx?.sessionDir,
			piSessionsDir: options.piSessionsDir ?? parentRunCtx?.piSessionsDir,
			variables: options.variables,
			parentRunId: options.parentRunId ?? parentRunCtx?.runId,
			parentPiSessionUuid,
			phase: options.phase ?? parentRunCtx?.phase,
			displayLabel: options.displayLabel,
			parentToolUseId: options.toolCallId,
			signal: record.abortController!.signal,
			onToolActivity: (activity) => {
				if (activity.type === "end") record.toolUses++;
				options.onToolActivity?.(activity.toolName);
			},
			onTextDelta: options.onTextDelta,
			onRunStarted: (info) => {
				record.traceIds = { ...info };
				this.flushDeferredSteerEvents(record);
			},
			onSessionCreated: (session) => {
				record.session = session;
				if (record.traceIds && session.sessionId) {
					record.traceIds.piSessionUuid = session.sessionId;
				}
				if (record.pendingSteers?.length) {
					for (const msg of record.pendingSteers) {
						session.steer(msg).catch(() => {});
					}
					record.pendingSteers = undefined;
				}
				if (options.toolCallId && options.parentPi) {
					const parentPiSessionId = parentPiSessionUuid;
					const childPiSessionId = session.sessionId;
					if (parentPiSessionId && childPiSessionId) {
						options.parentPi.appendEntry(this.subagentLinkCustomType, {
							parentPiSessionId,
							childPiSessionId,
							toolCallId: options.toolCallId,
							agentType: record.type,
							description: record.description,
						});
					}
				}
				options.onSessionCreated?.(session);
			},
			onTurnEnd: options.onTurnEnd,
		};

		const promise = this.spawnAgent(agentName, prompt, ctx, adapterOptions)
			.then(({ responseText, session, aborted }) => {
				if (record.status !== "stopped") {
					record.status = aborted ? "aborted" : "completed";
				}
				record.result = responseText;
				record.session = session;
				record.completedAt ??= Date.now();
				detachAbortListener?.();

				if (options.isBackground) {
					this.runningBackground--;
					this.onComplete?.(record);
					this.drainQueue();
				}
				this.settleCompletion(record);
				return responseText;
			})
			.catch((err) => {
				if (record.status !== "stopped") {
					record.status = "error";
				}
				record.error = err instanceof Error ? err.message : String(err);
				record.completedAt ??= Date.now();
				detachAbortListener?.();

				if (options.isBackground) {
					this.runningBackground--;
					this.onComplete?.(record);
					this.drainQueue();
				}
				this.settleCompletion(record);
				return "";
			});

		record.promise = promise;
	}

	/** Resolve the record's completion deferred (idempotent). */
	private settleCompletion(record: AgentRecord): void {
		const waiter = this.completionWaiters.get(record.id);
		if (!waiter) return;
		this.completionWaiters.delete(record.id);
		waiter.resolve(record);
	}

	/**
	 * Resolves with the final record once the agent completes — including
	 * queued background agents (which have no `promise` until they start)
	 * and queued agents aborted before starting. Backs the `done` promise of
	 * spawner-tool background dispatch handles (D77).
	 */
	waitForAgent(id: string): Promise<AgentRecord> {
		const record = this.agents.get(id);
		if (!record) {
			return Promise.reject(new Error(`Unknown agent id: ${id}`));
		}
		const waiter = this.completionWaiters.get(id);
		// No waiter left means the record already settled.
		return waiter ? waiter.promise : Promise.resolve(record);
	}

	private drainQueue(): void {
		while (this.queue.length > 0 && this.runningBackground < this.maxConcurrent) {
			const next = this.queue.shift()!;
			const record = this.agents.get(next.id);
			if (!record || record.status !== "queued") continue;
			this.startAgent(next.id, record, next.args);
		}
	}

	getRecord(id: string): AgentRecord | undefined {
		return this.agents.get(id);
	}

	/**
	 * Steer a spawned agent. Delivered immediately when its session exists;
	 * otherwise stored and flushed on session creation. Every accepted
	 * steering message emits exactly one run_steered trace event (steering is
	 * a control action — without the event it would be invisible in traces).
	 */
	steer(id: string, message: string): boolean {
		const record = this.agents.get(id);
		if (!record) return false;
		if (record.status !== "running" && record.status !== "queued") return false;
		if (record.session) {
			record.session.steer(message).catch(() => {});
			this.emitRunSteered(record, message, "delivered");
		} else {
			record.pendingSteers = [...(record.pendingSteers ?? []), message];
			this.emitRunSteered(record, message, "queued");
		}
		return true;
	}

	private emitRunSteered(
		record: AgentRecord,
		message: string,
		delivery: "delivered" | "queued",
	): void {
		if (!this.traceWriter) return;
		const trace = record.traceIds;
		if (!trace) {
			// The run's identity isn't known yet — defer until onRunStarted.
			const list = this.deferredSteerEvents.get(record.id) ?? [];
			list.push({ message, delivery });
			this.deferredSteerEvents.set(record.id, list);
			return;
		}
		this.traceWriter.submit(
			createRunSteeredEvent(
				{
					containerId: trace.containerId,
					runId: trace.runId,
					...(trace.piSessionUuid ? { piSessionUuid: trace.piSessionUuid } : {}),
				},
				record.type,
				message,
				{ delivery },
			),
		);
	}

	private flushDeferredSteerEvents(record: AgentRecord): void {
		const list = this.deferredSteerEvents.get(record.id);
		if (!list?.length) {
			this.deferredSteerEvents.delete(record.id);
			return;
		}
		this.deferredSteerEvents.delete(record.id);
		for (const item of list) {
			this.emitRunSteered(record, item.message, item.delivery);
		}
	}

	listAgents(): AgentRecord[] {
		return [...this.agents.values()].sort(
			(a, b) => b.startedAt - a.startedAt,
		);
	}

	abort(id: string): boolean {
		const record = this.agents.get(id);
		if (!record) return false;

		if (record.status === "queued") {
			this.queue = this.queue.filter((q) => q.id !== id);
			record.status = "stopped";
			record.completedAt = Date.now();
			// A queued record never starts, so its completion settles here.
			this.settleCompletion(record);
			return true;
		}

		if (record.status !== "running") return false;
		record.abortController?.abort();
		record.status = "stopped";
		record.completedAt = Date.now();
		return true;
	}

	hasRunning(): boolean {
		return [...this.agents.values()].some(
			(r) => r.status === "running" || r.status === "queued",
		);
	}

	abortAll(): number {
		let count = 0;
		for (const queued of this.queue) {
			const record = this.agents.get(queued.id);
			if (record) {
				record.status = "stopped";
				record.completedAt = Date.now();
				this.settleCompletion(record);
				count++;
			}
		}
		this.queue = [];
		for (const record of this.agents.values()) {
			if (record.status === "running") {
				record.abortController?.abort();
				record.status = "stopped";
				record.completedAt = Date.now();
				count++;
			}
		}
		return count;
	}

	async waitForAll(): Promise<void> {
		while (true) {
			this.drainQueue();
			const pending = [...this.agents.values()]
				.filter((r) => r.status === "running" || r.status === "queued")
				.map((r) => r.promise)
				.filter(Boolean);
			if (pending.length === 0) break;
			await Promise.allSettled(pending);
		}
	}

	clearCompleted(): void {
		for (const [id, record] of this.agents) {
			if (record.status === "running" || record.status === "queued") continue;
			record.session?.dispose?.();
			this.agents.delete(id);
			this.deferredSteerEvents.delete(id);
		}
	}

	private cleanup(): void {
		const cutoff = Date.now() - 10 * 60_000;
		for (const [id, record] of this.agents) {
			if (record.status === "running" || record.status === "queued") continue;
			if ((record.completedAt ?? 0) >= cutoff) continue;
			record.session?.dispose?.();
			this.agents.delete(id);
			this.deferredSteerEvents.delete(id);
		}
	}

	dispose(): void {
		clearInterval(this.cleanupInterval);
		this.queue = [];
		for (const record of this.agents.values()) {
			record.session?.dispose?.();
			// Settle any outstanding completion waiters so `done` promises
			// held by background dispatch handles never hang.
			this.settleCompletion(record);
		}
		this.agents.clear();
		this.deferredSteerEvents.clear();
		this.completionWaiters.clear();
	}
}
