import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext
} from "@agent-kernel/kernel/context";
import { defineContext } from "@agent-kernel/kernel/agent-definition";

const loaders: AgentContextResolver["loaders"] = [
	{
		kind: "text",
		label: "scout assignment",
		content: "The coordinator assigns one narrow research angle to each scout."
	},
	{
		kind: "file",
		path: "research-memory/brief.md"
	},
	{
		kind: "directory",
		pattern: "research-memory/sources/**/*.md",
		extensions: [".md"]
	},
	{
		kind: "working-memory",
		scope: "scout reports",
		path: "research-memory/scout-reports"
	}
];

function assemble(loaded: LoadedMap, ctx: SpawnContext): string {
	return [
		"<source_scout_context>",
		`<focus>${ctx.variables.focus ?? ""}</focus>`,
		...loaded.map((input) => {
			return [
				`<input kind="${input.decl.kind}" status="${input.status}">`,
				input.content,
				"</input>"
			].join("\n");
		}),
		"</source_scout_context>"
	].join("\n\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
