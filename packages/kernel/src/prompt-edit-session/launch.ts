/**
 * prompt-edit-session/launch — one call from "annotations on the target's
 * sidecar" to "session ready to spawn the prompt-editor agent":
 *
 *   registry def (prompt + hash + declared variables)
 *     → open agent-request annotations (Track A ops)
 *     → request queue (from-annotations adapter, R-aliases in sidecar order)
 *     → createPromptEditSession (stale-base guard wired to the registry)
 *     → { session, sessionData, tools, spawn }
 *
 * The host's spawn line, end to end (kernel runtime):
 *
 *   const launch = await launchPromptEditSession({
 *     registry: await kernel.registry(),
 *     annotationOps: kernel.catalogApiService(),
 *     targetAgent: "source-scout",
 *   });
 *   if (launch.ok) {
 *     await kernel.spawnAgent(launch.spawn.agentName, launch.spawn.prompt, null, {
 *       variables: launch.spawn.variables,
 *       sessionData: launch.spawn.sessionData,
 *     });
 *   }
 *
 * The one piece the runner does not assemble for you: binding `launch.tools`
 * onto that spawn's pi session. The kernel's hook for per-spawn tools is the
 * `sharedTools` config on createKernel (`sharedTools: (agentConfig) => […]`) —
 * hand it `launch.tools` gated on
 * `agentConfig.name === PROMPT_EDITOR_AGENT_NAME`; alternatively the bundle's
 * own tools sidecar can bind a host-resolved current session. Pure assembly
 * lives here; that one line stays with the host.
 */
import type {
	DanglingTarget,
	PromptAnnotation,
} from "@codecaine-ai/prompt-kit/annotations";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { AgentRegistry } from "../agent-registry";
import { listAnnotations } from "../agent-registry/annotation-sidecar";
import type { KernelCatalogAnnotationOps } from "../catalog-annotations";
import { promptEditSessionTools, registryPromptHashLookup } from "./bind-tools";
import {
	promptEditRequestsFromAnnotations,
	type SkippedAnnotation,
} from "./from-annotations";
import { createPromptEditSession, type PromptEditSession } from "./session";
import {
	sessionDataForPromptEditSession,
	type PromptEditSessionData,
} from "./session-data";
import { PROMPT_EDITOR_AGENT_NAME } from "./types";
import type { PromptEditRequestInput } from "./types";

export interface LaunchPromptEditSessionOptions {
	/** The kernel's agent registry (`await kernel.registry()` / buildRegistry). */
	registry: Pick<AgentRegistry, "tryGet">;
	/** Catalog name of the agent whose prompt is being edited. */
	targetAgent: string;
	/**
	 * Track A's annotation ops as the kernel catalog service exposes them
	 * (disk-fresh: each call syncs the prompt and may hot-swap the registry
	 * entry — the launcher re-reads the def afterwards so the session bases on
	 * the same document the sidecar validated). Omitted: the sidecar is read
	 * directly from the target's bundle dir against the registry-cached prompt.
	 */
	annotationOps?: Pick<KernelCatalogAnnotationOps, "listAnnotations">;
	/**
	 * Requests appended AFTER the annotation-derived ones — aliases continue
	 * (annotations claim R1… in sidecar creation order first).
	 */
	extraRequests?: PromptEditRequestInput[];
	/** Operator instruction: stored on the session and used as the kickoff prompt. */
	instruction?: string;
	sessionId?: string;
}

export interface LaunchedPromptEditSession {
	ok: true;
	session: PromptEditSession;
	/** Exactly the prompt-editor context contract's three keys. */
	sessionData: PromptEditSessionData;
	/** `promptEditSessionTools(session)` — AgentPrivateTools-shaped binder. */
	tools: (pi: ExtensionAPI) => void;
	/** Annotations that did not become requests, with reasons. */
	skipped: SkippedAnnotation[];
	/** Everything kernel.spawnAgent needs, minus the tools binding above. */
	spawn: {
		agentName: typeof PROMPT_EDITOR_AGENT_NAME;
		prompt: string;
		variables: { targetAgent: string };
		sessionData: PromptEditSessionData;
	};
}

export type LaunchPromptEditSessionFailure =
	| { ok: false; reason: "unknown-agent"; targetAgent: string }
	| { ok: false; reason: "annotations-invalid"; errors: string[] };

export type LaunchPromptEditSessionResult =
	| LaunchedPromptEditSession
	| LaunchPromptEditSessionFailure;

export const DEFAULT_PROMPT_EDIT_KICKOFF =
	"Work the request queue on the target prompt: read the annotated prompt, " +
	"propose one transaction per request, and resolve every request.";

export async function launchPromptEditSession(
	options: LaunchPromptEditSessionOptions,
): Promise<LaunchPromptEditSessionResult> {
	const { registry, targetAgent } = options;
	let def = registry.tryGet(targetAgent);
	if (!def) return { ok: false, reason: "unknown-agent", targetAgent };

	let listed: {
		annotations: { annotations: readonly PromptAnnotation[] };
		dangling: readonly DanglingTarget[];
	};
	if (options.annotationOps) {
		const result = await options.annotationOps.listAnnotations(targetAgent);
		if (result === null) {
			return { ok: false, reason: "unknown-agent", targetAgent };
		}
		if (!result.ok) {
			return { ok: false, reason: "annotations-invalid", errors: result.errors };
		}
		listed = result;
		// The ops synced the prompt from disk (and may have hot-swapped the
		// registry entry) — re-read so document/hash match what was validated.
		def = registry.tryGet(targetAgent) ?? def;
	} else {
		const result = await listAnnotations(
			def.bundleLayout.dir,
			def.promptDocument,
		);
		if (!result.ok) {
			return { ok: false, reason: "annotations-invalid", errors: result.errors };
		}
		listed = result;
	}

	const mapped = promptEditRequestsFromAnnotations(
		listed.annotations.annotations,
		def.promptDocument,
		{ dangling: listed.dangling },
	);
	const requests = [...mapped.requests, ...(options.extraRequests ?? [])];

	const session = createPromptEditSession({
		targetAgent,
		document: def.promptDocument,
		baseHash: def.promptHash,
		requests,
		instruction: options.instruction,
		declaredVariables: Object.keys(def.manifest.variables),
		getCurrentPromptHash: registryPromptHashLookup(registry, targetAgent),
		sessionId: options.sessionId,
	});
	const sessionData = sessionDataForPromptEditSession(session);

	return {
		ok: true,
		session,
		sessionData,
		tools: promptEditSessionTools(session),
		skipped: mapped.skipped,
		spawn: {
			agentName: PROMPT_EDITOR_AGENT_NAME,
			prompt: options.instruction ?? DEFAULT_PROMPT_EDIT_KICKOFF,
			variables: { targetAgent },
			sessionData,
		},
	};
}
