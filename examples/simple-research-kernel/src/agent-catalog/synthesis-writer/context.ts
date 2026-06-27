import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext
} from "@agent-kernel/kernel/context";
import { defineContext } from "@agent-kernel/kernel/agent-definition";

const loaders: AgentContextResolver["loaders"] = [
	{
		kind: "file",
		path: "research-memory/brief.md"
	},
	{
		kind: "working-memory",
		scope: "scout reports",
		path: "research-memory/scout-reports"
	},
	{
		kind: "directory",
		pattern: "research-memory/sources/**/*.md",
		extensions: [".md"]
	}
];

function assemble(loaded: LoadedMap, ctx: SpawnContext): string {
	return [
		"<synthesis_writer_context>",
		`<focus>${ctx.variables.focus ?? ""}</focus>`,
		...loaded.map((input) => {
			return [
				`<input kind="${input.decl.kind}" status="${input.status}" bytes="${input.bytes}">`,
				input.content,
				"</input>"
			].join("\n");
		}),
		"</synthesis_writer_context>"
	].join("\n\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
