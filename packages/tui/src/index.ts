export {
	defaultGenericCatalogRoot,
	findProjectKernelFile,
	listAgents,
	listAgentsDetailed,
	loadCatalog,
	locateGenericCatalog,
	readCatalogRoots,
	resolveAgent,
	resolveAgentDetailed,
	APP_HOSTED_REASON,
	type AgentListing,
	type AgentResolution,
	type AppHostedBundle,
	type CatalogAgent,
	type GenericCatalogLocation,
	type UnavailableBundle,
	type CatalogLayer,
	type CatalogOptions,
	type CatalogSource,
	type LoadedCatalog,
	type ResolvedCatalogAgent,
} from "./catalog";
export {
	assembleSystemPrompt,
	bootAgent,
	type BootedAgent,
	type BootedSections,
	type BootOptions,
} from "./boot";
export {
	buildSessionBindingMarkers,
	resolveTargetKernelRoot,
	SESSION_BINDING_CUSTOM_TYPE,
	TUI_SESSION_META_CUSTOM_TYPE,
	type BuildMarkersInput,
	type ResolvedKernelTarget,
	type SessionBindingMarkers,
	type SessionBindingPayload,
	type TuiSessionMetaPayload,
} from "./session-binding";
export { bindBundleTools, type BoundBundleTools } from "./tools";
export { registerAgentCommands } from "./commands";
export { default as extension } from "./extension";
