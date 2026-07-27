import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { getModel, type Model } from "@earendil-works/pi-ai/compat";
import {
	DefaultResourceLoader,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	createAgentSession,
	type AgentSession,
	type ExtensionContext,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import { checkDomainAccess, mapToolToOperation } from "../hooks";
import type { StateExtensionHandle } from "../../state";
import type { AgentConfig, DomainRule } from "../types";
import type { ResolvedAgent } from "../system-prompt-resolver";
import { resolveModel as fuzzyResolveModel } from "./model-resolver";
import { attachPiLifecycleLogger } from "./pi-lifecycle-logger";
import { applyToolScoping } from "./tool-scoping";

export interface PiSessionFactoryLoggerLike {
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
}

/**
 * JSONL session-binding marker appended as the session's first custom entry.
 * The spawn pipeline merges containerId + runId into `data` so Phase 2
 * backfill can resolve kernel identity from the transcript alone.
 */
export interface SessionBindingInput {
	customType: string;
	data?: Record<string, unknown>;
}

export interface CreatePiSessionInput {
	resolved: ResolvedAgent;
	ctx?: ExtensionContext | null;
	cwd: string;
	domain?: DomainRule[];
	thinkingLevel?: string;
	sessionManager?: SessionManager;
	toolFactories?: ExtensionFactory[];
	/**
	 * The agent's state extension (seed/update/render + three-section request
	 * builder). Present ONLY when the bundle ships a state.ts sidecar or a
	 * window config; absent means complete pass-through — nothing registers and
	 * the session behaves exactly as before.
	 */
	stateExtension?: StateExtensionHandle<any> | null;
	sessionBinding?: SessionBindingInput;
	piLifecycleCustomType?: string;
	piAgentDir?: string;
	logger?: PiSessionFactoryLoggerLike;
}

export interface CreatePiSessionResult {
	session: AgentSession;
	model: Model<any> | undefined;
}

export function buildDomainGuardFactory(
	domain: DomainRule[],
	cwd: string,
): ExtensionFactory {
	return (pi) => {
		pi.on("tool_call", (event) => {
			const operation = mapToolToOperation(event.toolName);
			if (!operation) return;

			const filePath = String((event.input as { path?: string }).path || "");
			if (!filePath) return;

			const result = checkDomainAccess(domain, filePath, operation, cwd);
			if (!result.allowed) {
				return { block: true, reason: result.reason };
			}
		});
	};
}

export function resolveModelFromString(modelStr: string): Model<any> | undefined {
	const slashIdx = modelStr.indexOf("/");
	if (slashIdx === -1) return undefined;
	const provider = modelStr.slice(0, slashIdx);
	const modelId = modelStr.slice(slashIdx + 1);
	return getModel(provider as any, modelId as any) ?? undefined;
}

const noopLogger: PiSessionFactoryLoggerLike = {
	info() {},
	warn() {},
};

export async function createPiSession(
	input: CreatePiSessionInput,
): Promise<CreatePiSessionResult> {
	const { resolved, ctx, cwd, domain, thinkingLevel } = input;
	const log = input.logger ?? noopLogger;
	const agentName = resolved.config.name;
	log.info(`creating session for "${agentName}"`, {
		cwd,
		hasParentCtx: Boolean(ctx),
		configModel: resolved.config.model || "(none)",
	});

	const extensionFactories: ExtensionFactory[] = [
		...(input.toolFactories ?? []),
		...(domain?.length ? [buildDomainGuardFactory(domain, cwd)] : []),
		...(input.stateExtension ? [input.stateExtension.factory] : []),
	];
	if (!input.piAgentDir) {
		throw new Error("createPiSession requires input.piAgentDir");
	}
	const piAgentDir = input.piAgentDir;

	mkdirSync(piAgentDir, { recursive: true });
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});

	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: piAgentDir,
		settingsManager,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noExtensions: true,
		systemPromptOverride: () => resolved.systemPrompt,
		extensionFactories,
	});
	await loader.reload();

	// Pi 0.82: AuthStorage + ModelRegistry.create() were replaced by ModelRuntime,
	// which owns provider auth and the model catalog. ModelRegistry is still the
	// synchronous read surface the fuzzy resolver needs (ModelRuntime's own
	// getAvailable() is async), so we wrap the runtime in one.
	const modelRuntime = await ModelRuntime.create({
		authPath: join(piAgentDir, "auth.json"),
		modelsPath: join(piAgentDir, "models.json"),
	});
	const modelRegistry = ctx?.modelRegistry ?? new ModelRegistry(modelRuntime);

	let model: Model<any> | undefined;
	const config: AgentConfig = resolved.config;
	if (config.model) {
		const resolvedModel = fuzzyResolveModel(config.model, modelRegistry);
		if (typeof resolvedModel === "string") {
			log.warn(`model fuzzy resolve failed for "${agentName}": ${resolvedModel}`);
			model = ctx?.model;
		} else {
			model = resolvedModel;
		}
		if (!model) {
			model = resolveModelFromString(config.model);
			if (!model) {
				log.warn(`model "${config.model}" not found in built-in catalog for "${agentName}"`);
			}
		}
	}
	if (!model) model = ctx?.model;

	const modelDesc = model ? `${(model as any).provider}/${(model as any).id}` : "pi-default";
	log.info(`model resolved for "${agentName}": ${modelDesc}`);

	const sessionOpts: Record<string, unknown> = {
		cwd,
		agentDir: piAgentDir,
		sessionManager: input.sessionManager ?? SessionManager.create(cwd),
		settingsManager,
		modelRuntime,
		...(model ? { model } : {}),
		resourceLoader: loader,
	};
	if (thinkingLevel) sessionOpts.thinkingLevel = thinkingLevel;

	const { session } = await createAgentSession(
		sessionOpts as Parameters<typeof createAgentSession>[0],
	);

	// The state extension reads the live transcript through this handle: its
	// hooks only fire after creation, so binding here is early enough.
	input.stateExtension?.bindSession(session as unknown as { messages: any[] });

	if (input.sessionBinding) {
		(session.sessionManager as unknown as {
			appendCustomEntry(customType: string, data?: unknown): string;
		}).appendCustomEntry(
			input.sessionBinding.customType,
			input.sessionBinding.data,
		);
		log.info(`emitted session binding for "${agentName}"`, {
			customType: input.sessionBinding.customType,
		});
	}

	attachPiLifecycleLogger(session, input.piLifecycleCustomType);

	applyToolScoping(session, config);
	log.info(`session created for "${agentName}"`, {
		activeTools: session.getActiveToolNames().length,
	});

	return { session, model };
}

export const _test_applyToolScoping = applyToolScoping;
export const _test_buildDomainGuardFactory = buildDomainGuardFactory;
export const _test_resolveModelFromString = resolveModelFromString;
