/**
 * BAML native logging (plan §4.2 rule 4, §4.7).
 *
 * BAML prints the rendered prompt and the reply to stderr at its default
 * level, and the full prompt on a failed call at any level less strict than
 * `error`, before any redaction. So every invoke, render and parse passes
 * `bamlCallEnv()` (the generated client merges per-call env over
 * `process.env`, so it wins over the ambient value), and the engine tightens
 * the ambient setting once at construction. `setLogLevel` is never called:
 * it prints to stdout.
 */

export const BAML_LOG_LEVEL = "error";

/** Ambient values kept as they are: already `error`, or logging switched off. */
const KEPT_AMBIENT_LEVELS: ReadonlySet<string> = new Set([BAML_LOG_LEVEL, "off"]);

/** A fresh per-call env for BAML's options bag. */
export function bamlCallEnv(): Record<string, string> {
	return { BAML_LOG: BAML_LOG_LEVEL };
}

export const BAML_LOG_NORMALIZED_NOTICE =
	"[agent-kernel] baml-engine set BAML_LOG to error: less strict BAML log levels print prompts";

/**
 * Sets `env.BAML_LOG` to `error` when it is unset or any other value than
 * `error` or `off` (less strict levels and unrecognized values alike), and
 * reports that once through `notice`, naming the variable only. Returns
 * whether it changed the value.
 */
export function normalizeAmbientBamlLog(
	env: Record<string, string | undefined> = process.env,
	notice: (message: string) => void = (message) => console.warn(message),
): boolean {
	const current = env.BAML_LOG;
	if (current !== undefined && KEPT_AMBIENT_LEVELS.has(current)) return false;
	env.BAML_LOG = BAML_LOG_LEVEL;
	notice(BAML_LOG_NORMALIZED_NOTICE);
	return true;
}
