import { randomUUID } from "node:crypto";

import { runContextStore } from "../run-context";
import type {
	AgentRecord,
	KernelExtensionAPI,
	KernelExtensionContext,
	OnAgentComplete,
	OnAgentStart,
	SpawnOptions,
	SubagentType,
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
	appSessionId?: string;
	appSessionSlug?: string;
	appSessionDir?: string;
	piSessionsDir?: string;
	variables?: Record<string, unknown>;
	parentRunId?: string;
	parentPiSessionUuid?: string;
	containerId?: string;
	phase?: string;
	displayLabel?: string;
	parentToolUseId?: string;
	signal?: AbortSignal;
	onToolActivity?: (activity: { type: "start" | "end"; toolName: string }) => void;
	onTextDelta?: (delta: string) => void;
	onSessionCreated?: (session: AgentSpawnResult["session"]) => void;
	onTurnEnd?: (turnCount: number) => void;
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

		if (options.signal) {
			if (options.signal.aborted) {
				record.abortController?.abort();
			} else {
				options.signal.addEventListener(
					"abort",
					() => record.abortController?.abort(),
					{ once: true },
				);
			}
		}

		const parentRunCtx = runContextStore.getStore();
		const appSessionId =
			options.appSessionId ??
			parentRunCtx?.appSessionId;
		const appSessionSlug =
			options.appSessionSlug ??
			parentRunCtx?.appSessionSlug;
		const appSessionDir =
			options.appSessionDir ??
			parentRunCtx?.appSessionDir;
		const parentPiSessionUuid =
			options.parentPiSessionUuid ?? ctx.sessionManager.getSessionId();
		const adapterOptions: AgentSpawnOptions = {
			workingDir: options.workingDir,
			appSessionId,
			appSessionSlug,
			appSessionDir,
			piSessionsDir: options.piSessionsDir,
			variables: options.variables,
			parentRunId: options.parentRunId,
			parentPiSessionUuid,
			containerId: options.containerId ?? parentRunCtx?.containerId,
			phase: options.phase ?? parentRunCtx?.phase,
			displayLabel: options.displayLabel,
			parentToolUseId: options.toolCallId,
			signal: record.abortController!.signal,
			onToolActivity: (activity) => {
				if (activity.type === "end") record.toolUses++;
				options.onToolActivity?.(activity.toolName);
			},
			onTextDelta: options.onTextDelta,
			onSessionCreated: (session) => {
				record.session = session;
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

				if (options.isBackground) {
					this.runningBackground--;
					this.onComplete?.(record);
					this.drainQueue();
				}
				return responseText;
			})
			.catch((err) => {
				if (record.status !== "stopped") {
					record.status = "error";
				}
				record.error = err instanceof Error ? err.message : String(err);
				record.completedAt ??= Date.now();

				if (options.isBackground) {
					this.runningBackground--;
					this.onComplete?.(record);
					this.drainQueue();
				}
				return "";
			});

		record.promise = promise;
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
		}
	}

	private cleanup(): void {
		const cutoff = Date.now() - 10 * 60_000;
		for (const [id, record] of this.agents) {
			if (record.status === "running" || record.status === "queued") continue;
			if ((record.completedAt ?? 0) >= cutoff) continue;
			record.session?.dispose?.();
			this.agents.delete(id);
		}
	}

	dispose(): void {
		clearInterval(this.cleanupInterval);
		this.queue = [];
		for (const record of this.agents.values()) {
			record.session?.dispose?.();
		}
		this.agents.clear();
	}
}
