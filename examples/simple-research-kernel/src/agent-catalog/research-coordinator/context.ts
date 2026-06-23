import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext
} from "@agent-kernel/kernel/context";

export const loaders: AgentContextResolver["loaders"] = [
	{
		kind: "text",
		label: "runtime mode",
		content:
			"This local demo runs the live Pi model/tool loop over local working memory. It does not perform web research unless a host app adds a web tool."
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
		scope: "current session reports",
		path: "research-memory/reports"
	}
];

export function assemble(loaded: LoadedMap, ctx: SpawnContext): string {
	return [
		"<research_coordinator_context>",
		`<request>${ctx.variables.user_prompt ?? ""}</request>`,
		...loaded.map((input) => {
			return [
				`<input kind="${input.decl.kind}" status="${input.status}" bytes="${input.bytes}">`,
				input.content,
				"</input>"
			].join("\n");
		}),
		"</research_coordinator_context>"
	].join("\n\n");
}
