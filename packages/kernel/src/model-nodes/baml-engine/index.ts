/**
 * `@agent-kernel/kernel/baml-engine`: the BAML `CallEngine` (plan §4.2).
 *
 * The harness injects its own `import * as baml from "@boundaryml/baml"` and
 * its generated client `b`; this module only reaches them through the
 * structural types in `baml-runtime-types.ts`.
 */
import { KernelNodeError, type CallEngine, type CallManifest, type FnName } from "../types";
import type { BamlRuntimeLike } from "./baml-runtime-types";

export * from "./baml-runtime-types";

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

export function bamlEngine<C extends object>(cfg: BamlEngineConfig<C>): CallEngine<C> {
	void cfg;
	throw new KernelNodeError("no-engine", "bamlEngine is not implemented yet");
}
