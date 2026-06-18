import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext
} from "@agent-kernel/kernel/context";

export const loaders: AgentContextResolver["loaders"] = [
	{
		kind: "text",
		label: "demo mode",
		content:
			"This local demo is deterministic. It shows the harness shape without calling a live model."
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
		scope: "prior reports",
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
