/**
 * Section ② — the context-editor's STANDING KNOWLEDGE, and nothing else.
 *
 * `assemble()` bakes the bundle-authoring reference into named blocks: the
 * agent-kernel authoring docs (bundle anatomy, the ② and ③ sidecar
 * contracts, validation) plus the kernel-agent-authoring skill it operates
 * under. Each block is served by kernel `file` loaders and rendered as its
 * own XML tag. Paths are anchored to this file so the bundle assembles from
 * any working directory.
 *
 * There is deliberately NO envelope here. The kernel's L2 context set wraps
 * section ② in its single <context> message itself — these blocks land as
 * entries inside it, and wrapping again would double-envelope the request.
 *
 * The session's aim (which bundle is being edited, running notes) is section
 * ③ and belongs to the state sidecar (../state/index.ts). This module never
 * reads `sessionData`.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";

export interface ContextBlock {
	/** XML tag emitted for this section ② block. */
	readonly tag: string;
	/** Source files joined inside the tag, in reading order. */
	readonly files: ReadonlyArray<string>;
}

/**
 * agent-kernel repo root (catalog/context-editor/context → up three).
 * import.meta.url, not the bun-only import.meta.dir: pi loads bundles under
 * Node via jiti, where `dir` is undefined.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const authoringDoc = (filename: string): string =>
	join(REPO_ROOT, "docs", "30-authoring", filename);

/** The standing context blocks, in their rendered reading order. */
export const CONTEXT_BLOCKS: ReadonlyArray<ContextBlock> = [
	{
		tag: "bundle_authoring_model",
		files: [authoringDoc("00-overview.md")],
	},
	{
		tag: "context_sidecar_guide",
		files: [authoringDoc("10-context-sidecar.md")],
	},
	{
		tag: "state_sidecar_guide",
		files: [authoringDoc("20-state-sidecar.md")],
	},
	{
		tag: "validation_guide",
		files: [authoringDoc("40-validation.md")],
	},
	{
		tag: "kernel_agent_authoring_skill",
		files: [join(REPO_ROOT, "skills", "kernel-agent-authoring", "SKILL.md")],
	},
];

/** All source files in kernel-loader order. */
export const CONTEXT_FILES: ReadonlyArray<string> = CONTEXT_BLOCKS.flatMap(
	(entry) => entry.files,
);

const loaders: AgentContextResolver["loaders"] = CONTEXT_FILES.map((path) => ({
	kind: "file",
	path,
}));

function loadedPath(input: LoadedMap[number]): string {
	return typeof input.decl === "object" && "path" in input.decl
		? String(input.decl.path)
		: "";
}

function block(tag: string, body: string): string {
	return [`<${tag}>`, body, `</${tag}>`].join("\n");
}

// `_ctx` is the contract's second parameter, deliberately unread: section ②
// is session-invariant standing knowledge. Session state rides section ③.
function assemble(loaded: LoadedMap, _ctx: SpawnContext): string {
	const loadedByPath = new Map(loaded.map((input) => [loadedPath(input), input]));

	return CONTEXT_BLOCKS.map((entry) => {
		const inputs = entry.files.map((path) => loadedByPath.get(path));
		const unavailableIndex = inputs.findIndex(
			(input) => input === undefined || input.status !== "ok",
		);
		if (unavailableIndex === -1) {
			const body = inputs.map((input) => input?.content ?? "").join("\n\n");
			return block(entry.tag, body);
		}

		const unavailable = inputs[unavailableIndex];
		const status = unavailable?.status ?? "missing";
		return `<${entry.tag} status="${status}"></${entry.tag}>`;
	}).join("\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
