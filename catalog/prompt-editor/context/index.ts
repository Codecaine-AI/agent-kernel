/**
 * Section ② — the prompt-editor's standing context.
 *
 * Three blocks, in the order the model reads them:
 *
 *   <prompt_kit_authoring>  the house authoring reference, loaded from the
 *                           prompt-kit-authoring skill next to this catalog
 *                           (key files only, never the whole tree); served by
 *                           the kernel `file` loader
 *   <target_prompt>         the target agent's current PromptDocument
 *                           rendered with node ids stamped in place, plus the
 *                           base hash proposals build on; produced per-session
 *                           by the session service and delivered on
 *                           `sessionData`
 *   <requests>              the open request queue (R-aliases, targets,
 *                           bodies, threads), re-rendered by the session
 *                           service; delivered on `sessionData`
 *
 * The bundle owns the DECLARATION — which blocks exist, which tags they use,
 * what the model is told they are — while the machinery that produces the
 * dynamic bytes lives with the session service. The service's contract:
 *
 *   sessionData.targetPromptRender  string — node-id-stamped render of the
 *                                   target prompt
 *   sessionData.targetPromptHash    string — canonical hash (pk1-…) of that
 *                                   document
 *   sessionData.requestQueue        string — the rendered queue body, one
 *                                   R-alias entry per open request
 *   variables.targetAgent           string — the target agent's catalog name
 *
 * Any missing key degrades to a labelled placeholder instead of failing the
 * spawn, so the bundle boots (and previews) without a live session.
 */
import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import { basename, join } from "node:path";

/** skills/prompt-kit-authoring, relative to catalog/prompt-editor/context/. */
const SKILL_DIR = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"skills",
	"prompt-kit-authoring",
);

/**
 * The authoring-reference files baked into every session, in reading order:
 * the document model, the working method, the editing route, and the
 * anti-patterns. Deliberately a subset — the rest of the skill tree is
 * routing and creation-path material the editor does not need standing.
 */
export const AUTHORING_REFERENCE_FILES: ReadonlyArray<string> = [
	join(SKILL_DIR, "05-authoring-model.md"),
	join(SKILL_DIR, "08-core-methodology.md"),
	join(SKILL_DIR, "workflows", "20-improve-prompt-ts.md"),
	join(SKILL_DIR, "20-techniques", "40-anti-patterns.md"),
];

/** "05-authoring-model.md" → "authoring-model" — the <doc name="…"> label. */
function docName(path: string): string {
	return basename(path)
		.replace(/\.md$/, "")
		.replace(/^\d+-/, "");
}

const loaders: AgentContextResolver["loaders"] = AUTHORING_REFERENCE_FILES.map(
	(path) => ({ kind: "file", path }),
);

function indent(body: string): string[] {
	return body
		.split("\n")
		.map((line) => (line.length > 0 ? `    ${line}` : line));
}

function block(tag: string, attrs: string, body: string): string {
	const open = attrs.length > 0 ? `<${tag} ${attrs}>` : `<${tag}>`;
	return [open, ...indent(body), `</${tag}>`].join("\n");
}

function sessionString(ctx: SpawnContext, key: string): string | null {
	const value = ctx.sessionData?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function assemble(loaded: LoadedMap, ctx: SpawnContext): string {
	const docs = loaded
		.map((input) => {
			const path =
				typeof input.decl === "object" && "path" in input.decl
					? String(input.decl.path)
					: "";
			const name = docName(path);
			if (input.status !== "ok") {
				return `<doc name="${name}" status="${input.status}"></doc>`;
			}
			return block("doc", `name="${name}"`, input.content);
		})
		.join("\n");

	const targetAgent =
		typeof ctx.variables.targetAgent === "string" &&
		ctx.variables.targetAgent.length > 0
			? ctx.variables.targetAgent
			: "(unset)";
	const targetHash = sessionString(ctx, "targetPromptHash") ?? "(unset)";
	const targetRender =
		sessionString(ctx, "targetPromptRender") ??
		"(target prompt not loaded — the session service sets sessionData.targetPromptRender to the node-id-stamped render)";
	const requestQueue =
		sessionString(ctx, "requestQueue") ??
		"(no open requests — the session service sets sessionData.requestQueue to the rendered queue)";

	return [
		block("prompt_kit_authoring", "", docs),
		block(
			"target_prompt",
			`agent="${targetAgent}" hash="${targetHash}"`,
			targetRender,
		),
		block("requests", "", requestQueue),
	].join("\n\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
