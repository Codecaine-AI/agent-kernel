import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type {
	AgentFrontmatter,
	DomainRule,
	ParsedAgent,
	VariableDeclaration,
} from "../../spawn-pipeline/types";
export type { RuntimeState } from "../../context";

export type AgentRegisterFn = (
	pi: ExtensionAPI,
) => void | Promise<void>;

export interface AgentModule {
	register: AgentRegisterFn;
}
