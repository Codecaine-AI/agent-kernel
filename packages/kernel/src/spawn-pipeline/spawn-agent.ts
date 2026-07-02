import type {
	AgentSession,
	ExtensionContext,
	ExtensionFactory,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import {
	updateAgentRunInboundEvent,
	updateAgentRunStatus,
	updatePiAgentSessionStatus,
	type KernelDatabase,
	type RunStatus,
	type RunTrigger,
} from "@agent-kernel/db";
import type { RunTraceEventIds } from "@agent-kernel/protocol";

import {
	createKernelEmitter,
	type EmitterSessionManagerLike,
	type KernelEmitter,
} from "../emitter";

import {
	buildContext as v2BuildContext,
	createSpawnContext,
	hasAgentContext,
	injectAgentContext,
	type AgentContextResolver,
	type AppSessionData,
	type LoaderCatalog,
} from "../context";
import { runContextStore, runWithContext, type RunStateManagerLike } from "../run-context";
import type { TraceWriterSink } from "../subagents/types";
import { getDefaultMaxTurns, normalizeMaxTurns } from "./config/turn-limits";
import { createPiSession, type SessionBindingInput } from "./pi-session-factory";
import { resolveLifecycleEmitter } from "./runtime/lifecycle-emitter";
import { buildRunContext } from "./runtime/run-context-builder";
import { makeRuntimeState } from "./runtime/runtime-state";
import { buildSessionManager } from "./session/session-manager-builder";
import { setupPiSessionAndRun } from "./session/pi-session-db-init";
import { triggerRun } from "./session/turn-trigger";
import { subscribeToSession } from "./streaming/session-event-subscriber";
import { emitAgentRunEnd, emitAgentRunStart } from "./trace/agent-run-trace";
import { createRunUsageRecorder, type RunUsageRecorder } from "./trace/usage-rollup";
import { getLastAssistantError } from "./trace/assistant-message-inspection";
import type { DomainRule, ParsedAgent, PiToolResultBlock } from "./types";
import { resolveSystemPrompt } from "./system-prompt-resolver";
import type { KernelLoggerLike } from "../events";

export type { PiToolResultBlock };

export interface KernelSpawnOptions {
	workingDir?: string;
	maxTurns?: number;
	thinkingLevel?: string;
	signal?: AbortSignal;
	variables?: Record<string, unknown>;
	/**
	 * Named variant from the agent manifest's `variants` map — the sanctioned
	 * per-spawn override for model/thinking/maxTurns/runInBackground/
	 * displayLabel. Unknown names fail the spawn (D76/4b).
	 */
	variant?: string;
	/** App-owned per-spawn context snapshot forwarded to context loaders. */
	sessionData?: AppSessionData | null;
	domain?: DomainRule[];
	onToolActivity?: (activity: { type: "start" | "end"; toolName: string }) => void;
	onTextDelta?: (delta: string) => void;
	onSessionCreated?: (session: AgentSession) => void;
	onTurnEnd?: (turnCount: number) => void;
	/**
	 * Fired as soon as the run's identity exists (before the Pi session is
	 * created) — lets callers (e.g. AgentManager) attribute later control
	 * actions such as steering to this run.
	 */
	onRunStarted?: (info: { runId: string; containerId: string }) => void;
	sessionManager?: SessionManager;
	/**
	 * Primary grouping identity — required (directly or inherited from the
	 * parent run context). Derive one with kernel.container({ kind, key }).
	 */
	containerId?: string;
	/**
	 * What opened the run. Defaults to "parent-tool" when parentToolUseId is
	 * present, else "operator".
	 */
	trigger?: RunTrigger;
	/** Session working directory for Pi session storage (was appSessionDir). */
	sessionDir?: string;
	traceWriter?: TraceWriterSink;
	piSessionsDir?: string;
	piAgentDir?: string;
	stateManager?: RunStateManagerLike | null;
	parentRunId?: string;
	parentPiSessionUuid?: string;
	/** Optional actor correlation stamped onto emitted events. */
	userId?: string;
	phase?: string;
	displayLabel?: string;
	parentToolUseId?: string;
	resumeFromToolResult?: {
		toolUseId: string;
		toolName: string;
		content: string;
		contentBlocks?: PiToolResultBlock[];
	};
	reuseExistingSession?: boolean;
}

export interface KernelSpawnAgentResult {
	responseText: string;
	session: AgentSession;
	aborted: boolean;
}

export interface SpawnAgentLoggerLike {
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Internal adapter bundle for the spawn pipeline. Not part of the public
 * API since Phase 4b — `createKernel` assembles it from kernel config and
 * the catalog registry; apps never construct it directly.
 */
export interface CreateSpawnAgentAdapters {
	/**
	 * Resolve the agent's runtime config for one spawn. The kernel applies
	 * manifest variants and model aliases here, so the returned config
	 * carries the RESOLVED model string.
	 */
	loadAgent(name: string, opts: KernelSpawnOptions): ParsedAgent;
	loadAgentResolver(name: string): Promise<AgentContextResolver | null>;
	buildPrivateRegisterFactory(name: string): Promise<ExtensionFactory | null>;
	buildToolFactories(config: ParsedAgent["config"]): ExtensionFactory[];
	createContextCatalog(): LoaderCatalog;
	getDb(): KernelDatabase;
	/** Model price table keyed by resolved model string; powers costEstimate. */
	modelPrices?: Record<string, { inputPerMTok?: number; outputPerMTok?: number }>;
	/**
	 * Optional JSONL binding marker for the new Pi session. The pipeline
	 * always merges containerId + runId into the marker payload so Phase 2
	 * backfill can recover kernel identity from the transcript.
	 */
	createSessionBinding?(opts: KernelSpawnOptions): SessionBindingInput | undefined;
	piLifecycleCustomType?: string;
	logger?: SpawnAgentLoggerLike;
	lifecycleLogger?: KernelLoggerLike;
}

export type KernelSpawnAgent = (
	name: string,
	prompt: string,
	ctx?: ExtensionContext | null,
	opts?: KernelSpawnOptions,
) => Promise<KernelSpawnAgentResult>;

const noopLogger: SpawnAgentLoggerLike = {
	info() {},
	warn() {},
	error() {},
};

export function createSpawnAgent(
	adapters: CreateSpawnAgentAdapters,
): KernelSpawnAgent {
	const log = adapters.logger ?? noopLogger;

	return async function spawnAgent(
		name: string,
		prompt: string,
		ctx?: ExtensionContext | null,
		opts: KernelSpawnOptions = {},
	): Promise<KernelSpawnAgentResult> {
		const cwd = opts.workingDir ?? ctx?.cwd;
		if (!cwd) throw new Error("spawnAgent requires opts.workingDir or ctx.cwd");
		const parentCtx = runContextStore.getStore();
		const containerId = opts.containerId ?? parentCtx?.containerId;
		if (!containerId) {
			throw new Error(
				"spawnAgent requires opts.containerId — derive one with kernel.container({ kind, key })",
			);
		}
		const trigger: RunTrigger =
			opts.trigger ?? (opts.parentToolUseId ? "parent-tool" : "operator");
		const runId = crypto.randomUUID();
		opts.onRunStarted?.({ runId, containerId });
		log.info(`spawning "${name}"`, { cwd, hasParentCtx: Boolean(ctx) });
		const runtime = makeRuntimeState(cwd, containerId, opts.sessionDir);

		const resolved = resolveSystemPrompt({
			parsed: adapters.loadAgent(name, opts),
			callerVariables: opts.variables,
			runtime,
		});

		const resolver = await adapters.loadAgentResolver(name);
		const sessionManager = await buildSessionManager(name, {
			sessionManager: opts.sessionManager,
			containerId,
			sessionDir: opts.sessionDir,
			piSessionsDir: opts.piSessionsDir,
			reuseExistingSession: opts.reuseExistingSession,
			resumeFromToolResult: opts.resumeFromToolResult,
		});
		const privateFactory = await adapters.buildPrivateRegisterFactory(name);
		const toolFactories = [
			...adapters.buildToolFactories(resolved.config),
			...(privateFactory ? [privateFactory] : []),
		];
		const thinkingLevel = opts.thinkingLevel ?? resolved.config.thinking;
		const bindingBase = adapters.createSessionBinding?.(opts);
		const sessionBinding: SessionBindingInput | undefined = bindingBase
			? {
					customType: bindingBase.customType,
					data: { ...(bindingBase.data ?? {}), containerId, runId },
				}
			: undefined;
		const { session, model } = await createPiSession({
			resolved,
			ctx,
			cwd,
			domain: opts.domain,
			thinkingLevel,
			sessionManager,
			toolFactories,
			sessionBinding,
			piLifecycleCustomType: adapters.piLifecycleCustomType,
			piAgentDir: opts.piAgentDir,
			logger: log,
		});
		opts.onSessionCreated?.(session);
		const resolvedModelLabel = model
			? `${(model as any).provider}/${(model as any).id}`
			: resolved.config.model || undefined;

		const traceWriter = opts.traceWriter ?? parentCtx?.traceWriter;
		const ids: RunTraceEventIds = {
			containerId,
			runId,
			piSessionUuid: session.sessionId,
			...(opts.userId !== undefined && { userId: opts.userId }),
		};

		const db = adapters.getDb();
		await setupPiSessionAndRun(db, {
			piSessionUuid: session.sessionId,
			containerId,
			runId,
			agentName: name,
			trigger,
			model: resolvedModelLabel,
			promptHash: resolved.promptHash,
			parentPiSessionUuid: opts.parentPiSessionUuid,
			parentRunId: opts.parentRunId,
			phase: opts.phase,
			displayLabel: opts.displayLabel,
			parentToolUseId: opts.parentToolUseId,
		});

		// In-process emitter (Phase 2): owns user/assistant message, tool call
		// and pi lifecycle emission for this run. The inbound user_message is
		// observed from the live session, so its event id lands on the run row
		// via updateAgentRunInboundEvent once the emitter sees it.
		const usageRecorder: RunUsageRecorder | undefined = traceWriter
			? createRunUsageRecorder(
					db,
					{ runId, piSessionUuid: session.sessionId, containerId },
					log,
				)
			: undefined;
		const kernelEmitter: KernelEmitter | undefined = traceWriter
			? createKernelEmitter({
					traceWriter,
					ids: { ...ids, piSessionUuid: session.sessionId },
					agentName: name,
					model: resolvedModelLabel,
					phase: opts.phase,
					spawnerTools: resolved.config.spawnerTools,
					lifecycleCustomType: adapters.piLifecycleCustomType,
					prices: adapters.modelPrices,
					sessionManager: session.sessionManager as unknown as EmitterSessionManagerLike,
					logger: log,
					onTurnUsage: (usage) => usageRecorder?.recordTurn(usage),
					onInboundEvent: (eventId) => {
						updateAgentRunInboundEvent(db, runId, eventId).catch((e) =>
							log.warn("updateAgentRunInboundEvent failed", {
								error: (e as Error).message,
							}),
						);
					},
				})
			: undefined;
		kernelEmitter?.emitSessionStart();

		const emitter = resolveLifecycleEmitter(name, {
			traceWriter,
			ids,
			logger: adapters.lifecycleLogger,
		});
		emitter?.systemPromptResolved({
			agent_name: name,
			prompt_hash: resolved.promptHash ?? null,
			rendered_prompt: resolved.systemPrompt,
			tools_allowlist: resolved.config.tools ?? [],
			tools_disallowlist: resolved.config.disallowedTools ?? [],
			extensions: resolved.config.extensions ?? true,
			domain_rules_installed: Boolean(opts.domain?.length),
			variables_resolved: (resolved.variables ?? {}) as Record<string, string>,
		});

		if (resolver && !hasAgentContext(session, name)) {
			const spawnCtx = createSpawnContext({
				agentName: name,
				runtime,
				variables: opts.variables,
				cwd,
				sessionData: opts.sessionData,
			});
			const result = await v2BuildContext({
				resolver,
				spawnContext: spawnCtx,
				catalog: adapters.createContextCatalog(),
				emitter,
			});
			injectAgentContext(session, name, result);
		}

		const maxTurns = normalizeMaxTurns(
			opts.maxTurns ?? resolved.config.maxTurns ?? getDefaultMaxTurns(),
		);
		const sub = subscribeToSession(session, opts, maxTurns, kernelEmitter);

		const stateManager = opts.stateManager ?? null;
		const runCtx = buildRunContext(
			name,
			{
				containerId,
				trigger,
				traceWriter,
				parentRunId: opts.parentRunId,
				sessionDir: opts.sessionDir,
				piSessionsDir: opts.piSessionsDir,
				phase: opts.phase,
				userId: opts.userId,
			},
			cwd,
			stateManager,
			runId,
			session.sessionId,
		);
		if (traceWriter) {
			emitAgentRunStart(traceWriter, ids, name, {
				parentRunId: opts.parentRunId,
				phase: opts.phase,
				parentToolUseId: opts.parentToolUseId,
				displayLabel: opts.displayLabel,
			});
		}

		try {
			const run = () => triggerRun(session, prompt, opts);
			await (runCtx ? runWithContext(runCtx, run) : run());
			const turnErr = getLastAssistantError(session);
			if (turnErr) {
				log.warn("spawn finished with assistant stopReason=error", {
					agent: name,
					errorMessage: turnErr.errorMessage,
				});
				throw new Error(turnErr.errorMessage);
			}
			const result = sub.readResult();
			// The final assistant response closes the run; the emitter owns
			// assistant_message emission, so the outbound event id is sourced
			// from the emitter's deterministic id.
			await kernelEmitter?.settle();
			const runUsage = kernelEmitter?.runUsage();
			const outboundEventId = kernelEmitter?.outboundEventId();
			if (traceWriter) {
				emitAgentRunEnd(traceWriter, ids, name, "ok", undefined, runUsage);
			}
			const status: RunStatus = sub.turnLimitReached()
				? "turn-limit"
				: result.aborted || opts.signal?.aborted
					? "aborted"
					: "done";
			const endedAt = new Date().toISOString();
			// Fold run usage totals into the session and container rollups
			// before the status writes settle the run.
			await usageRecorder?.finalize();
			await Promise.all([
				updateAgentRunStatus(db, runId, status, { endedAt, outboundEventId }).catch((e) =>
					log.warn("updateAgentRunStatus failed", { error: (e as Error).message })
				),
				updatePiAgentSessionStatus(db, session.sessionId, "ended", endedAt).catch((e) =>
					log.warn("updatePiAgentSessionStatus failed", { error: (e as Error).message })
				)
			]);
			log.info(`spawn complete for "${name}"`, { aborted: result.aborted });
		} catch (err) {
			log.error(`spawn failed for "${name}"`, {
				error: err instanceof Error ? err.message : String(err),
			});
			await kernelEmitter?.settle().catch(() => {});
			if (traceWriter) {
				emitAgentRunEnd(
					traceWriter,
					ids,
					name,
					"error",
					(err as Error)?.message ?? String(err),
					kernelEmitter?.runUsage(),
				);
			}
			const status: RunStatus = opts.signal?.aborted ? "aborted" : "error";
			const endedAt = new Date().toISOString();
			// Usage observed before the failure still counts toward rollups.
			await usageRecorder?.finalize().catch(() => {});
			await Promise.all([
				updateAgentRunStatus(db, runId, status, { endedAt }).catch((e) =>
					log.warn("updateAgentRunStatus failed", { error: (e as Error).message })
				),
				updatePiAgentSessionStatus(db, session.sessionId, "error", endedAt).catch((e) =>
					log.warn("updatePiAgentSessionStatus failed", { error: (e as Error).message })
				)
			]);
			throw err;
		} finally {
			sub.unsub();
			sub.cleanupAbort();
		}
		return sub.readResult();
	};
}
