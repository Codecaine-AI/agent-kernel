/**
 * The untyped invoke request and outcome both engine paths work on; the
 * typed `CallEngine` surface in `index.ts` casts at its boundary.
 */
import { collectSecrets, findShortCredential, mergeSecrets, redactDeep } from "../redact";
import type { CallFailure, EngineAttempt, PiTransport, ResolvedRoute } from "../types";

export interface EngineInvoke {
	name: string;
	args: readonly unknown[];
	route: ResolvedRoute;
	transport: PiTransport;
	signal?: AbortSignal;
	timeoutMs: number;
	tags: Record<string, string>;
	secrets: readonly string[];
}

export type EngineOutcome = { attempts: EngineAttempt[]; rawText: string | null } & (
	| { ok: true; value: unknown }
	| { ok: false; failure: CallFailure }
);

/** An outcome before redaction, with every secret it must be scrubbed of. */
export interface EngineRun {
	outcome: EngineOutcome;
	secrets: readonly string[];
}

/**
 * Redaction before returning (plan §4.2 rule 7, §4.7): every collected
 * secret value is replaced in the value, the attempts (bodies, URLs, SSE
 * frames), the raw text and the failure. The kernel redacts again before
 * persisting.
 */
export function redactOutcome(run: EngineRun): EngineOutcome {
	return redactDeep(run.outcome, mergeSecrets(run.secrets));
}

/**
 * The route's own credentials, scrubbed even when the caller's secret set
 * misses one. Empty when the route carries a 1–7 character credential: such
 * a route is refused, and scrubbing a short value would mangle ordinary text.
 */
export function routeSecrets(route: ResolvedRoute): string[] {
	if (findShortCredential(route.headers, [route.apiKey]) !== undefined) return [];
	return collectSecrets(route.headers, [route.apiKey]);
}
