import { pathToFileURL } from "node:url";

import type { AgentPrivateTools } from "../../agent-definition";
import type { AgentRegisterFn } from "../parsing/types";

interface StubPi {
	registerTool(tool: { name: string }): void;
}

export async function harvestPrivateToolNamesFromPath(
	indexModulePath: string,
): Promise<string[]> {
	const mod = (await import(pathToFileURL(indexModulePath).href)) as {
		default?: { register?: AgentRegisterFn };
		register?: AgentRegisterFn;
	};
	const reg = mod.default?.register ?? mod.register;
	if (!reg) return [];

	const names: string[] = [];
	const stubPi: StubPi = {
		registerTool(tool) {
			names.push(tool.name);
		},
	};
	await reg(stubPi as unknown as Parameters<AgentRegisterFn>[0]);
	return names;
}

export async function harvestPrivateToolNamesFromRegister(
	register: AgentPrivateTools,
): Promise<string[]> {
	const names: string[] = [];
	const stubPi: StubPi = {
		registerTool(tool) {
			names.push(tool.name);
		},
	};
	await register(stubPi as unknown as Parameters<AgentPrivateTools>[0]);
	return names;
}
