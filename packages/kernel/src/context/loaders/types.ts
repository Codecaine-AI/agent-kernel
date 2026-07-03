/**
 * types.ts — Loader contract surface for the v1 context-builder loader catalog.
 *
 * Each LoaderDeclaration variant names a loader kind plus the parameters that
 * kind consumes. A Loader resolves one declaration to a LoaderResult; the
 * Context Builder (CP4) walks an agent's declared context manifest, dispatches
 * each declaration to the catalog, and composes the returned content strings.
 *
 * LoaderResolveContext is intentionally narrow — cwd + activeSessionDir is the
 * minimum CP3's six loaders need. CP4 can widen it (or pass a superset) without
 * breaking this module.
 */

export interface FileLoaderDeclaration {
	kind: "file";
	path: string;
}

export interface DirectoryLoaderDeclaration {
	kind: "directory";
	pattern: string;
	extensions?: string[];
}

export type SkillLoaderMode = "force" | "dynamic";

// `mode` omitted ⇒ treated as "dynamic" (progressive disclosure default).
export interface SkillLoaderDeclaration {
	kind: "skill";
	name: string;
	mode?: SkillLoaderMode;
}

export interface CommandLoaderDeclaration {
	kind: "command";
	command: string;
	args?: string[];
	timeoutMs?: number;
}

export interface TextLoaderDeclaration {
	kind: "text";
	content: string;
	label?: string;
}

export type KernelLoaderDeclaration =
	| FileLoaderDeclaration
	| DirectoryLoaderDeclaration
	| SkillLoaderDeclaration
	| CommandLoaderDeclaration
	| TextLoaderDeclaration;

export interface CustomLoaderDeclaration {
	kind: string;
	[key: string]: unknown;
}

export type LoaderDeclaration =
	| KernelLoaderDeclaration
	| CustomLoaderDeclaration;

export type LoaderOfKind<K extends LoaderDeclaration["kind"]> = Extract<
	LoaderDeclaration,
	{ kind: K }
>;

export interface LoaderResolveContext {
	cwd: string;
	activeSessionDir?: string;
	/** Primary grouping identity (container) for app-defined loaders. */
	containerId?: string;
	/** Pre-fetched session data — synthetic sessions set _syntheticState to bypass DB. */
	sessionData?: Record<string, any> & { _syntheticState?: Record<string, unknown> };
}

export interface LoaderResult {
	status: "ok" | "empty" | "error";
	content: string;
	bytes: number;
	hash: string;
	error?: string;
}

export interface Loader<D extends LoaderDeclaration = LoaderDeclaration> {
	kind: D["kind"];
	resolve(decl: D, ctx: LoaderResolveContext): Promise<LoaderResult>;
}
