/**
 * `@agent-kernel/kernel/baml-engine`: the BAML `CallEngine` (plan §4.2).
 *
 * The harness injects its own `import * as baml from "@boundaryml/baml"` and
 * its generated client `b`; this module only reaches them through the
 * structural types in `baml-runtime-types.ts`, so it never loads BAML itself.
 * Two transports per function:
 *   - `baml-http` (default): BAML renders, sends and parses (`native.ts`).
 *   - `pi`: BAML renders and parses, the kernel's Pi transport sends (`via-pi.ts`).
 */
import { KernelNodeError, type CallEngine, type CallEngineOutcome, type CallManifest, type FnName } from "../types";
import type { BamlRuntimeLike } from "./baml-runtime-types";
import { bamlPromptHash, callableAt, generatedFunctionNames } from "./client";
import { normalizeAmbientBamlLog } from "./log-level";
import { invokeNative } from "./native";
import { redactOutcome, type EngineInvoke } from "./outcome";
import { invokeViaPi } from "./via-pi";

export * from "./baml-runtime-types";
export { bamlCallEnv, BAML_LOG_LEVEL } from "./log-level";
export { BAML_PROVIDER_BY_PI_API, KERNEL_CALL_CLIENT } from "./native";
export { KERNEL_RENDER_CLIENT, RENDER_API_KEY, RENDER_BASE_URL } from "./via-pi";

export interface BamlEngineConfig<C extends object> {
	/** The generated `b`, unchanged type. */
	client: C;
	/** The harness's own `import * as baml from "@boundaryml/baml"`. */
	baml: BamlRuntimeLike;
	/** getBamlFiles() */
	sources: Record<string, string>;
	manifests: Partial<Record<FnName<C>, CallManifest>>;
	/** Declared in the harness's clients.baml. */
	retryPolicy?: string;
	/** Default "baml-http". */
	transport?: "baml-http" | "pi";
	transportByFunction?: Partial<Record<FnName<C>, "baml-http" | "pi">>;
}

/**
 * Builds the engine. Throws `KernelNodeError("unknown-function")` when a
 * manifest or transport override names something that is not a generated
 * function, and tightens an ambient `BAML_LOG` to `error` (§4.2 rule 4).
 * `invoke` never rejects for engine failures; it rejects only for a name
 * that is not a generated function.
 */
export function bamlEngine<C extends object>(cfg: BamlEngineConfig<C>): CallEngine<C> {
	const names = generatedFunctionNames(cfg.client) as FnName<C>[];
	const known = new Set<string>(names);
	for (const [label, keys] of [
		["manifest", Object.keys(cfg.manifests)],
		["transport override", Object.keys(cfg.transportByFunction ?? {})],
	] as const) {
		for (const key of keys) {
			if (!known.has(key)) {
				throw new KernelNodeError("unknown-function", `${label} "${key}" is not a generated BAML function`);
			}
		}
	}
	const promptHash = bamlPromptHash(cfg.sources);
	normalizeAmbientBamlLog();

	const transportFor = (name: FnName<C>): "baml-http" | "pi" =>
		cfg.transportByFunction?.[name] ?? cfg.transport ?? "baml-http";

	return {
		engine: "baml",
		transportFor,
		functionNames: () => [...names],
		manifest: (name) => cfg.manifests[name],
		promptHash: () => promptHash,
		async invoke(req) {
			if (!known.has(req.name)) {
				throw new KernelNodeError("unknown-function", `"${req.name}" is not a generated BAML function`);
			}
			const args = req.args as unknown;
			if (!Array.isArray(args)) throw new KernelNodeError("invalid-request", "call args must be an array");
			const request: EngineInvoke = {
				name: req.name,
				args,
				route: req.route,
				transport: req.transport,
				...(req.signal !== undefined && { signal: req.signal }),
				timeoutMs: req.timeoutMs,
				tags: req.tags,
				secrets: req.secrets,
			};
			const run =
				transportFor(req.name) === "pi"
					? await invokeViaPi(
							cfg.baml,
							callableAt((cfg.client as Record<string, unknown>).request, req.name),
							callableAt((cfg.client as Record<string, unknown>).parse, req.name),
							request,
						)
					: await invokeNative(cfg.baml, callableAt(cfg.client, req.name), request, cfg.retryPolicy);
			return redactOutcome(run) as CallEngineOutcome<C, typeof req.name>;
		},
	};
}
