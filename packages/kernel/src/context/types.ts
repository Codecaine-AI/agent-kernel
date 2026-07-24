/**
 * types.ts — Shared type surface for the Context Builder layer.
 *
 * Owns the v2 agent context resolver contract: agents export
 * { loaders, assemble }; the builder walks the declared loaders through the
 * CP3 catalog, then hands the ordered LoadedMap to assemble() together with a
 * SpawnContext describing the caller / runtime / paths.
 */

import type { LoaderCatalog } from "./loaders/catalog";
import type { LoaderDeclaration } from "./loaders/types";

export interface RuntimeState {
	cwd: string;
	/** Primary grouping identity for the spawn (container kind + key tree). */
	containerId?: string;
	platform?: string;
	topic?: string;
	phase?: string;
	status?: string;
	/** Session working directory (app-provided file layout root). */
	sessionDir?: string;
	priorSessions?: string[];
}

export interface ContextLifecycleEmitter {
	contextBuildStarted(input: {
		agent_name: string;
		declared_inputs: { kind: string; ref: string }[];
	}): void;
	contextInputResolved(input: {
		loader_kind: string;
		input_ref: string;
		status: "ok" | "empty" | "error";
		bytes: number;
		from_cache: boolean;
		error?: string;
		content_hash?: string;
	}): void;
	contextBuildCompleted(input: {
		inputs: InputsSummaryEntry[];
		rendered_context: string;
		total_bytes: number;
	}): void;
}

export interface AppSessionData {
	/** App-owned session/workflow snapshot. Kernel loaders treat it opaquely. */
	[key: string]: any;
	/** Synthetic render endpoint state root; app loaders may consume it directly. */
	_syntheticState?: Record<string, unknown>;
}

export interface SpawnContextCaller {
	kind: "user" | "agent" | "system";
	id: string;
}

export interface SpawnContextPaths {
	workingDir: string;
	activeSessionDir: string;
	priorSessionsDir?: string;
}

/**
 * Per-spawn context handed to loaders (via projection) and assemble().
 */
export interface SpawnContext {
	agentName: string;
	variables: Record<string, unknown>;
	caller: SpawnContextCaller;
	runtime: RuntimeState;
	paths: SpawnContextPaths;
	/**
	 * Pre-fetched session snapshot for resolvers that would otherwise call
	 * app-specific DB reads. Production spawn-agent leaves this unset; the
	 * testing render endpoint sets it to avoid duplicate DB reads
	 * (real-session mode) or to bypass DB entirely (synthetic-session mode).
	 *
	 * `_syntheticState` is the raw state.json for synthetic sessions — loaders
	 * can use it directly as the state root instead of querying the DB.
	 */
	sessionData?: AppSessionData | null;
}

export interface LoadedInput {
	decl: LoaderDeclaration;
	status: "ok" | "empty" | "error";
	content: string;
	bytes: number;
	hash: string;
	error?: string;
	fromCache: boolean;
}

export type LoadedMap = ReadonlyArray<LoadedInput>;

/**
 * Image block carried alongside spawn-time context. `data` is the
 * base64-encoded image payload; `mimeType` is its media type (e.g.
 * "image/png"). Shape matches the pi ImageContent block minus the `type`
 * discriminant, which the injection layer adds.
 */
export interface ContextImage {
	data: string;
	mimeType: string;
}

export interface AgentContextResolver {
	loaders: LoaderDeclaration[];
	assemble(loaded: LoadedMap, ctx: SpawnContext): string | Promise<string>;
	/**
	 * Optional image hook, separate from the string-typed loader/assemble
	 * path. Runs after assemble(); returned images ride along with the
	 * rendered text as image blocks in the injected context entry. Resolvers
	 * without the hook keep pure-text behavior.
	 */
	assembleImages?(
		loaded: LoadedMap,
		ctx: SpawnContext,
	): ReadonlyArray<ContextImage> | Promise<ReadonlyArray<ContextImage>>;
}

export interface BuildContextOptions {
	resolver: AgentContextResolver;
	spawnContext: SpawnContext;
	catalog: LoaderCatalog;
	emitter: ContextLifecycleEmitter | null;
}

export interface InputsSummaryEntry {
	loader_kind: string;
	input_ref: string;
	status: "ok" | "empty" | "error";
	bytes: number;
}

export interface BuildContextResult {
	renderedContext: string;
	loaded: LoadedMap;
	/**
	 * UTF-8 byte length of renderedContext only. Image payloads are excluded;
	 * each image's base64 length is readable off contextImages[n].data.length.
	 */
	totalBytes: number;
	inputsSummary: InputsSummaryEntry[];
	/** Present only when the resolver's image hook returned at least one image. */
	contextImages?: ReadonlyArray<ContextImage>;
}

/**
 * Stable stringification of a LoaderDeclaration for emitter payloads + tests.
 * Pure — no side effects. Same ref string from the builder and the assembler.
 */
export function inputRefOf(decl: LoaderDeclaration): string {
	const record = decl as unknown as Record<string, unknown>;
	switch (decl.kind) {
		case "file":
			return stringValue(record.path) ?? decl.kind;
		case "directory":
			return stringValue(record.pattern) ?? decl.kind;
		case "skill":
			return stringValue(record.name) ?? decl.kind;
		case "command":
			return `${stringValue(record.command) ?? decl.kind} ${stringArray(record.args).join(" ")}`.trim();
		case "text":
			return stringValue(record.label) ?? "(inline)";
	}

	return customInputRefOf(decl);
}

function customInputRefOf(decl: LoaderDeclaration): string {
	const record = decl as unknown as Record<string, unknown>;
	for (const key of ["ref", "id", "name", "path", "selector", "label"]) {
		const value = record[key];
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			return String(value);
		}
	}
	return decl.kind;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}
