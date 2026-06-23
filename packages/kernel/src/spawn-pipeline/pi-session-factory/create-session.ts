import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { getModel, type Model } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	createAgentSession,
	type AgentSession,
	type ExtensionContext,
	type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

import { checkDomainAccess, mapToolToOperation } from "../hooks";
import type { AgentFrontmatter, DomainRule } from "../types";
import type { ResolvedAgent } from "../system-prompt-resolver";
import { resolveModel as fuzzyResolveModel } from "./model-resolver";
import { attachPiLifecycleLogger } from "./pi-lifecycle-logger";
import { applyToolScoping } from "./tool-scoping";

export interface PiSessionFactoryLoggerLike {
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
}

export interface AppSessionBindingInput {
	customType: string;
	data: unknown;
}

export interface CreatePiSessionInput {
	resolved: ResolvedAgent;
	ctx?: ExtensionContext | null;
	cwd: string;
	domain?: DomainRule[];
	thinkingLevel?: string;
	sessionManager?: SessionManager;
	toolFactories?: ExtensionFactory[];
	appSessionBinding?: AppSessionBindingInput;
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
	const agentName = resolved.frontmatter.name;
	log.info(`creating session for "${agentName}"`, {
		cwd,
		hasParentCtx: Boolean(ctx),
		frontmatterModel: resolved.frontmatter.model || "(none)",
	});

	const extensionFactories: ExtensionFactory[] = [
		...(input.toolFactories ?? []),
		...(domain?.length ? [buildDomainGuardFactory(domain, cwd)] : []),
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

	const authStorage = AuthStorage.create(join(piAgentDir, "auth.json"));
	const modelRegistry =
		ctx?.modelRegistry ?? ModelRegistry.create(authStorage, join(piAgentDir, "models.json"));

	let model: Model<any> | undefined;
	const fm: AgentFrontmatter = resolved.frontmatter;
	if (fm.model) {
		const resolvedModel = fuzzyResolveModel(fm.model, modelRegistry);
		if (typeof resolvedModel === "string") {
			log.warn(`model fuzzy resolve failed for "${agentName}": ${resolvedModel}`);
			model = ctx?.model;
		} else {
			model = resolvedModel;
		}
		if (!model) {
			model = resolveModelFromString(fm.model);
			if (!model) {
				log.warn(`model "${fm.model}" not found in built-in catalog for "${agentName}"`);
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
		authStorage,
		modelRegistry,
		...(model ? { model } : {}),
		resourceLoader: loader,
	};
	if (thinkingLevel) sessionOpts.thinkingLevel = thinkingLevel;

	const { session } = await createAgentSession(
		sessionOpts as Parameters<typeof createAgentSession>[0],
	);

	if (input.appSessionBinding) {
		(session.sessionManager as unknown as {
			appendCustomEntry(customType: string, data?: unknown): string;
		}).appendCustomEntry(
			input.appSessionBinding.customType,
			input.appSessionBinding.data,
		);
		log.info(`emitted app session binding for "${agentName}"`, {
			customType: input.appSessionBinding.customType,
		});
	}

	attachPiLifecycleLogger(session, input.piLifecycleCustomType);

	applyToolScoping(session, fm);
	log.info(`session created for "${agentName}"`, {
		activeTools: session.getActiveToolNames().length,
	});

	return { session, model };
}

export const _test_applyToolScoping = applyToolScoping;
export const _test_buildDomainGuardFactory = buildDomainGuardFactory;
export const _test_resolveModelFromString = resolveModelFromString;
