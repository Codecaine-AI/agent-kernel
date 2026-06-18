import { pathToFileURL } from "node:url";

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
