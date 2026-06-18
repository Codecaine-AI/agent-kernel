/**
 * index.ts — Public surface for the loader catalog.
 *
 * Re-exports kernel loader kinds and offers createDefaultCatalog() — a one-call
 * factory that returns a fresh LoaderCatalog pre-registered with the portable
 * base loaders. App-specific loaders register from the app layer.
 *
 * Default-catalog wiring lives here (not in catalog.ts) so catalog.ts stays
 * loader-free and no loader can create an import cycle through the registry.
 */

export * from "./types";
export {
	createLoaderCatalog,
	hashContent,
	UnknownLoaderKindError,
} from "./catalog";
export type { LoaderCatalog } from "./catalog";
export { textLoader } from "./text";
export { fileLoader } from "./file";
export { directoryLoader } from "./directory";
export { createSkillLoader, type SkillRegistryLike } from "./skill";
export { commandLoader } from "./command";

import { createLoaderCatalog, type LoaderCatalog } from "./catalog";
import { commandLoader } from "./command";
import { directoryLoader } from "./directory";
import { fileLoader } from "./file";
import { createSkillLoader, type SkillRegistryLike } from "./skill";
import { textLoader } from "./text";

export interface CreateDefaultCatalogOptions {
	skillRegistry?: SkillRegistryLike;
}

export function createDefaultCatalog(opts: CreateDefaultCatalogOptions = {}): LoaderCatalog {
	const catalog = createLoaderCatalog();
	catalog.register(textLoader);
	catalog.register(fileLoader);
	catalog.register(directoryLoader);
	if (opts.skillRegistry) catalog.register(createSkillLoader(opts.skillRegistry));
	catalog.register(commandLoader);
	return catalog;
}
