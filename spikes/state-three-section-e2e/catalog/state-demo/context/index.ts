/**
 * context/index.ts — section ② for the e2e demo agent (folder-form bundle).
 *
 * Text loaders only: no filesystem, no network, so the built context is
 * byte-identical on every run and the L2 set behind section ② is never empty.
 */
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";

const loaders: AgentContextResolver["loaders"] = [
	{
		kind: "text",
		label: "capabilities",
		content: "probe · answer — the probe tool echoes its note back verbatim.",
	},
	{
		kind: "text",
		label: "house style",
		content:
			'Quote marks ("), ampersands (&), angle brackets (<state>), unicode arrows (→) and × all appear here on purpose.',
	},
];

function assemble(loaded: LoadedMap, ctx: SpawnContext): string {
	return [
		"<state_demo_context>",
		`<agent>${ctx.agentName}</agent>`,
		...loaded.map((input) =>
			[
				`<input kind="${input.decl.kind}" status="${input.status}">`,
				input.content,
				"</input>",
			].join("\n"),
		),
		"</state_demo_context>",
	].join("\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
