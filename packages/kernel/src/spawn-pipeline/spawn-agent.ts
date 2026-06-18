import type {
	AgentSession,
	ExtensionContext,
	ExtensionFactory,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { updateAgentRunStatus } from "@agent-kernel/db/actions";

import {
	buildContext as v2BuildContext,
	hasAgentContext,
	injectAgentContext,
	type AgentContextResolver,
	type CreateSpawnContextParams,
	type LoaderCatalog,
	type SpawnContext,
} from "../context";
import { runContextStore, runWithContext, type RunStateManagerLike } from "../run-context";
import type { TraceWriterSink } from "../subagents/types";
import { getDefaultMaxTurns, normalizeMaxTurns } from "./config/turn-limits";
import { createPiSession, type AppSessionBindingInput } from "./pi-session-factory";
import { resolveLifecycleEmitter } from "./runtime/lifecycle-emitter";
import { buildRunContext } from "./runtime/run-context-builder";
import { makeRuntimeState } from "./runtime/runtime-state";
import { buildSessionManager } from "./session/session-manager-builder";
import { setupPiSessionAndRun } from "./session/pi-session-db-init";
import { triggerRun } from "./session/turn-trigger";
import { subscribeToSession } from "./streaming/session-event-subscriber";
import { emitAgentRunEnd, emitAgentRunStart } from "./trace/agent-run-trace";
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
	domain?: DomainRule[];
	onToolActivity?: (activity: { type: "start" | "end"; toolName: string }) => void;
	onTextDelta?: (delta: string) => void;
	onSessionCreated?: (session: AgentSession) => void;
	onTurnEnd?: (turnCount: number) => void;
	sessionManager?: SessionManager;
	appSessionId?: string;
	appSessionSlug?: string;
	appSessionDir?: string;
	traceWriter?: TraceWriterSink;
	piSessionsDir?: string;
	piAgentDir?: string;
	stateManager?: RunStateManagerLike | null;
	parentRunId?: string;
	parentPiSessionUuid?: string;
	containerId?: string;
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

export interface CreateSpawnAgentAdapters {
	loadAgent(name: string): ParsedAgent;
	loadAgentResolver(name: string): Promise<AgentContextResolver | null>;
	buildPrivateRegisterFactory(name: string): Promise<ExtensionFactory | null>;
	buildToolFactories(frontmatter: ParsedAgent["frontmatter"]): ExtensionFactory[];
	createContextCatalog(): LoaderCatalog;
	createSpawnContext(params: CreateSpawnContextParams): SpawnContext;
	getDb(): any;
	createAppSessionBinding?(opts: KernelSpawnOptions): AppSessionBindingInput | undefined;
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
		if (!opts.appSessionId) {
			throw new Error("spawnAgent requires opts.appSessionId for DB-backed run tracking");
		}
		log.info(`spawning "${name}"`, { cwd, hasParentCtx: Boolean(ctx) });
		const runtime = makeRuntimeState(cwd, opts.appSessionId);

		const resolved = resolveSystemPrompt({
			parsed: adapters.loadAgent(name),
			callerVariables: opts.variables,
			runtime,
		});

		const resolver = await adapters.loadAgentResolver(name);
		const sessionManager = await buildSessionManager(name, {
			sessionManager: opts.sessionManager,
			appSessionId: opts.appSessionId,
			appSessionDir: opts.appSessionDir,
			piSessionsDir: opts.piSessionsDir,
			reuseExistingSession: opts.reuseExistingSession,
			resumeFromToolResult: opts.resumeFromToolResult,
		});
		const privateFactory = await adapters.buildPrivateRegisterFactory(name);
		const toolFactories = [
			...adapters.buildToolFactories(resolved.frontmatter),
			...(privateFactory ? [privateFactory] : []),
		];
		const thinkingLevel = opts.thinkingLevel ?? resolved.frontmatter.thinking;
		const { session } = await createPiSession({
			resolved,
			ctx,
			cwd,
			domain: opts.domain,
			thinkingLevel,
			sessionManager,
			toolFactories,
			appSessionBinding: adapters.createAppSessionBinding?.(opts),
			piLifecycleCustomType: adapters.piLifecycleCustomType,
			piAgentDir: opts.piAgentDir,
			logger: log,
		});
		opts.onSessionCreated?.(session);

		const db = adapters.getDb();
		const { runId } = await setupPiSessionAndRun(db!, {
			piSessionUuid: session.sessionId,
			appSessionId: opts.appSessionId,
			agentName: name,
			parentPiSessionUuid: opts.parentPiSessionUuid,
			containerId: opts.containerId,
			phase: opts.phase,
			displayLabel: opts.displayLabel,
			parentToolUseId: opts.parentToolUseId,
		});

		const emitter = resolveLifecycleEmitter(
			name,
			opts.traceWriter,
			opts.appSessionId,
			session.sessionId,
			adapters.lifecycleLogger,
		);
		emitter?.systemPromptResolved({
			agent_name: name,
			rendered_prompt: resolved.systemPrompt,
			tools_allowlist: resolved.frontmatter.tools ?? [],
			tools_disallowlist: resolved.frontmatter.disallowed_tools ?? [],
			extensions: resolved.frontmatter.extensions ?? true,
			domain_rules_installed: Boolean(opts.domain?.length),
			variables_resolved: (resolved.variables ?? {}) as Record<string, string>,
		});

		if (resolver && !hasAgentContext(session, name)) {
			const spawnCtx = adapters.createSpawnContext({
				agentName: name,
				runtime,
				variables: opts.variables,
				cwd,
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
			opts.maxTurns ?? resolved.frontmatter.max_turns ?? getDefaultMaxTurns(),
		);
		const sub = subscribeToSession(session, opts, maxTurns);

		const stateManager = opts.stateManager ?? null;
		const runCtx = buildRunContext(
			name,
			{
				appSessionId: opts.appSessionId,
				appSessionSlug: opts.appSessionSlug,
				traceWriter: opts.traceWriter,
				parentRunId: opts.parentRunId,
				appSessionDir: opts.appSessionDir,
				piSessionsDir: opts.piSessionsDir,
				containerId: opts.containerId,
				phase: opts.phase,
			},
			cwd,
			stateManager,
			runId,
			session.sessionId,
		);
		const traceWriter = opts.traceWriter ?? runContextStore.getStore()?.traceWriter;
		const appSessionId =
			opts.appSessionId ??
			runContextStore.getStore()?.appSessionId;
		if (traceWriter && appSessionId) {
			emitAgentRunStart(
				traceWriter,
				appSessionId,
				name,
				runId,
				opts.parentRunId,
				session.sessionId,
				opts.containerId,
				opts.phase,
				opts.parentToolUseId,
				opts.displayLabel,
			);
		}

		try {
			const run = () => triggerRun(session, prompt, opts);
			await (runCtx ? runWithContext(runCtx, run) : run());
			const turnErr = getLastAssistantError(session);
			const endStatus: "ok" | "error" = turnErr ? "error" : "ok";
			if (turnErr) {
				log.warn("spawn finished with assistant stopReason=error", {
					agent: name,
					errorMessage: turnErr.errorMessage,
				});
			}
			if (traceWriter && appSessionId) {
				emitAgentRunEnd(
					traceWriter,
					appSessionId,
					name,
					runId,
					endStatus,
					turnErr?.errorMessage,
					session.sessionId,
				);
			}
			await updateAgentRunStatus(db!, runId, endStatus === "ok" ? "completed" : "error", {
				completedAt: new Date().toISOString(),
			}).catch((e) => log.warn("updateAgentRunStatus failed", { error: (e as Error).message }));
			log.info(`spawn complete for "${name}"`, { aborted: false });
		} catch (err) {
			log.error(`spawn failed for "${name}"`, {
				error: err instanceof Error ? err.message : String(err),
			});
			if (traceWriter && appSessionId) {
				emitAgentRunEnd(
					traceWriter,
					appSessionId,
					name,
					runId,
					"error",
					(err as Error)?.message ?? String(err),
					session.sessionId,
				);
			}
			await updateAgentRunStatus(db!, runId, "error", {
				completedAt: new Date().toISOString(),
			}).catch((e) => log.warn("updateAgentRunStatus failed", { error: (e as Error).message }));
			throw err;
		} finally {
			sub.unsub();
			sub.cleanupAbort();
		}
		return sub.readResult();
	};
}
