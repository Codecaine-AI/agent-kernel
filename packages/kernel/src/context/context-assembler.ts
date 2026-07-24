/**
 * builder.ts — Context Builder entry point.
 *
 * Runs an agent's declared loaders through the CP3 catalog in declaration
 * order, emits context_build_started / context_input_resolved× / context_build_completed
 * via the CP2 lifecycle emitter, then calls the resolver's assemble() with the
 * ordered LoadedMap. Loader throws become status:'error' LoadedInput entries;
 * remaining loaders still run. A resolver bug in assemble() propagates loud.
 */

import type { LoaderCatalog } from "./loaders/catalog";
import type { LoaderDeclaration, LoaderResolveContext, LoaderResult } from "./loaders/types";
import { toLoaderResolveContext } from "./create-spawn-context";
import {
	inputRefOf,
	type BuildContextOptions,
	type BuildContextResult,
	type InputsSummaryEntry,
	type LoadedInput,
} from "./types";

function errorResult(err: unknown): LoaderResult {
	return {
		status: "error",
		content: "",
		bytes: 0,
		hash: "",
		error: err instanceof Error ? err.message : String(err),
	};
}

async function resolveOne(
	decl: LoaderDeclaration,
	catalog: LoaderCatalog,
	resolveCtx: LoaderResolveContext,
): Promise<LoaderResult> {
	try {
		const loader = catalog.get(decl.kind);
		return await loader.resolve(decl as never, resolveCtx);
	} catch (err) {
		return errorResult(err);
	}
}

export async function buildContext(
	opts: BuildContextOptions,
): Promise<BuildContextResult> {
	const declaredInputs = opts.resolver.loaders.map((d) => ({
		kind: d.kind,
		ref: inputRefOf(d),
	}));

	opts.emitter?.contextBuildStarted({
		agent_name: opts.spawnContext.agentName,
		declared_inputs: declaredInputs,
	});

	const resolveCtx = toLoaderResolveContext(opts.spawnContext);
	const loadedArray: LoadedInput[] = [];

	for (const decl of opts.resolver.loaders) {
		const result = await resolveOne(decl, opts.catalog, resolveCtx);
		loadedArray.push({
			decl,
			status: result.status,
			content: result.content,
			bytes: result.bytes,
			hash: result.hash,
			error: result.error,
			fromCache: false,
		});
		opts.emitter?.contextInputResolved({
			loader_kind: decl.kind,
			input_ref: inputRefOf(decl),
			status: result.status,
			bytes: result.bytes,
			from_cache: false,
			error: result.error,
			content_hash: result.status === "error" ? undefined : result.hash,
		});
	}

	const rendered = await opts.resolver.assemble(loadedArray, opts.spawnContext);
	// Image hook is independent of the string-typed assemble() path: resolvers
	// that supply spawn images do so here, and the result carries them through
	// to injection untouched. An absent hook or an empty return means the
	// result stays pure-text.
	const images = opts.resolver.assembleImages
		? await opts.resolver.assembleImages(loadedArray, opts.spawnContext)
		: undefined;
	// totalBytes counts the rendered text only (UTF-8). Image payloads are
	// deliberately excluded — see BuildContextResult.totalBytes.
	const totalBytes = Buffer.byteLength(rendered, "utf8");
	const inputsSummary: InputsSummaryEntry[] = loadedArray.map((li) => ({
		loader_kind: li.decl.kind,
		input_ref: inputRefOf(li.decl),
		status: li.status,
		bytes: li.bytes,
	}));

	opts.emitter?.contextBuildCompleted({
		inputs: inputsSummary,
		rendered_context: rendered,
		total_bytes: totalBytes,
	});

	return {
		renderedContext: rendered,
		loaded: loadedArray,
		totalBytes,
		inputsSummary,
		...(images && images.length > 0 ? { contextImages: images } : {}),
	};
}
