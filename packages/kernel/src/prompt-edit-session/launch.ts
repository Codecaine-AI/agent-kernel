/**
 * prompt-edit-session/launch — one call from "annotations on the target's
 * sidecar" to "session ready to spawn the prompt-editor agent":
 *
 *   registry def (prompt + hash + declared variables)
 *     → open agent-request annotations (Track A ops)
 *     → OPTIONAL scope filter (`requestIds`) — run-now is one id, apply is the
 *       queued set, omitted is every open request
 *     → request queue (from-annotations adapter, R-aliases in sidecar order)
 *     → createPromptEditSession (stale-base guard wired to the registry)
 *     → { session, sessionData, tools, scope, spawn }
 *
 * `relaunchPromptEditSession` rebuilds that payload for a FOLLOW-UP turn on the
 * same session (the reply→re-run path); see its own docs.
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
	 * REQUEST SCOPE — the explicit set of annotation ids this session works.
	 * Only these become requests; every other annotation on the sidecar is
	 * skipped "out-of-scope" and never reaches the agent's `<requests>` block
	 * (the prompt-editor bundle renders `sessionData.requestQueue` verbatim, so
	 * scoping here IS the scoping the model sees).
	 *
	 *   run now  → one id
	 *   apply    → the queued set
	 *   omitted  → every open agent-request (the pre-scope behavior)
	 *
	 * Aliases are assigned over the SCOPED queue, so a run-now session's single
	 * request is always R1. Correlate back to the lab through `annotationId`,
	 * which rides on every entry.
	 */
	requestIds?: readonly string[];
	/**
	 * Requests appended AFTER the annotation-derived ones — aliases continue
	 * (annotations claim R1… in sidecar creation order first). Explicit caller
	 * input: NOT filtered by `requestIds`.
	 */
	extraRequests?: PromptEditRequestInput[];
	/** Operator instruction: stored on the session and used as the kickoff prompt. */
	instruction?: string;
	sessionId?: string;
}

export interface LaunchedPromptEditSession {
	ok: true;
	session: PromptEditSession;
	/** The four prompt-edit-session keys supplied to the prompt-editor state
	 * contract. */
	sessionData: PromptEditSessionData;
	/** `promptEditSessionTools(session)` — AgentPrivateTools-shaped binder. */
	tools: (pi: ExtensionAPI) => void;
	/** Annotations that did not become requests, with reasons. */
	skipped: SkippedAnnotation[];
	/** The annotation ids this session was scoped to, or null when unscoped
	 * (every open agent-request). */
	scope: readonly string[] | null;
	/** Everything kernel.spawnAgent needs, minus the tools binding above. */
	spawn: {
		agentName: typeof PROMPT_EDITOR_AGENT_NAME;
		prompt: string;
		sessionData: PromptEditSessionData;
	};
}

export type LaunchPromptEditSessionFailure =
	| { ok: false; reason: "unknown-agent"; targetAgent: string }
	| { ok: false; reason: "annotations-invalid"; errors: string[] }
	| {
			/** A scope was supplied and nothing in it is an actionable request
			 * (already resolved, dangling, or gone). Launching anyway would spawn
			 * an agent with an empty queue, so the launch refuses and hands back
			 * the per-id reasons for the UI to explain. */
			ok: false;
			reason: "empty-scope";
			requestIds: readonly string[];
			skipped: SkippedAnnotation[];
	  };

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
		{
			dangling: listed.dangling,
			...(options.requestIds !== undefined
				? { scopeIds: options.requestIds }
				: {}),
		},
	);
	const requests = [...mapped.requests, ...(options.extraRequests ?? [])];
	if (options.requestIds !== undefined && requests.length === 0) {
		return {
			ok: false,
			reason: "empty-scope",
			requestIds: options.requestIds,
			skipped: mapped.skipped,
		};
	}

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
		scope: options.requestIds ?? null,
		spawn: {
			agentName: PROMPT_EDITOR_AGENT_NAME,
			prompt: options.instruction ?? DEFAULT_PROMPT_EDIT_KICKOFF,
			sessionData,
		},
	};
}

/**
 * Rebuild a launch payload for ANOTHER agent turn on an existing session — the
 * follow-up spawn behind "reply on a thread re-runs the request".
 *
 * The session object is reused as-is, so the new turn's tools drive the same
 * queue, working document and staged proposals: a re-proposal on the same alias
 * REPLACES the staged one (session.propose's `replacing` path), which is
 * exactly the "old diff is stripped, a revised one is staged in its place"
 * behavior the lab shows. Everything else is recomputed off live session state
 * — `sessionData` is a pure function of it, and the spawn pipeline snapshots
 * sessionData per spawn, so the new turn sees the reply in its `<requests>`
 * block and the working document in `targetPromptRender`.
 */
export function relaunchPromptEditSession(
	previous: LaunchedPromptEditSession,
	prompt: string,
): LaunchedPromptEditSession {
	const sessionData = sessionDataForPromptEditSession(previous.session);
	return {
		...previous,
		sessionData,
		tools: promptEditSessionTools(previous.session),
		spawn: {
			agentName: PROMPT_EDITOR_AGENT_NAME,
			prompt,
			sessionData,
		},
	};
}

/** Kickoff prompt for a re-run turn triggered by human replies on threads. */
export function promptEditRerunKickoff(aliases: readonly string[]): string {
	const list = aliases.join(", ");
	return (
		`The human replied on ${list}. Read the updated <requests> queue, take the ` +
		`reply into account, and re-propose the transaction for ${list} ` +
		"(proposing again on a request replaces its staged proposal). Resolve it " +
		"when the reply is satisfied."
	);
}
