/**
 * index.ts — Public surface of the Context Builder sub-module.
 *
 * Re-exports the v2 resolver contract (types + SpawnContext factory + builder
 * + accumulation guard) plus a single createDefaultCatalog() entry point that
 * materializes a LoaderCatalog pre-registered with all six CP3 loaders.
 *
 * Agents depend on `./agent-kernel/context-builder` (this barrel) — never on
 * ./loaders directly — so CP5/6 additions land in one place.
 */

export * from "./types";
export * from "./create-spawn-context";
export * from "./context-assembler";
export * from "./accumulation-guard";
export * from "./section-renderers";

export { createDefaultCatalog } from "./loaders";
export type { LoaderCatalog } from "./loaders/catalog";
export type {
	LoaderDeclaration,
	LoaderResolveContext,
	LoaderResult,
	Loader,
	FileLoaderDeclaration,
	DirectoryLoaderDeclaration,
	SkillLoaderDeclaration,
	KernelLoaderDeclaration,
	CustomLoaderDeclaration,
	CommandLoaderDeclaration,
	TextLoaderDeclaration,
} from "./loaders/types";
