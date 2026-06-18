export { buildRegistry, catalogDirExists } from "./registry";
export type { BuildRegistryOptions } from "./registry";
export { RegistryError } from "./types";
export type { AgentDefinition, AgentRegistry } from "./types";
export {
	__resetAgentRegistryForTests,
	getAgentRegistry,
	initAgentRegistry,
} from "./registry-singleton";
export { validateVariables } from "./validate-variables";
export type { ValidationResult } from "./validate-variables";
export { harvestPrivateToolNamesFromPath } from "./harvest-private-tool-names";
