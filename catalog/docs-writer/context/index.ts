/**
 * Section ② — the docs-writer's STANDING KNOWLEDGE, and nothing else.
 *
 * `assemble()` bakes the docs-system reference into named blocks: the
 * framework skill, structure standards, intent-based cookbook, and writing
 * style. Each block is served by kernel `file` loaders and rendered as its
 * own XML tag. Paths are anchored to this file and routed through the Core
 * meta-workspace so the sibling docs-system repo resolves from any working
 * directory.
 *
 * There is deliberately NO envelope here. The kernel's L2 context set wraps
 * section ② in its single <context> message itself — these blocks land as
 * entries inside it, and wrapping again would double-envelope the request.
 *
 * The session's aim (which doc is being worked, task notes) is section ③ and
 * belongs to the state sidecar (../state/index.ts). This module never reads
 * `sessionData`.
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
 * Resolve through agent-kernel into the Core meta-workspace and its sibling
 * docs-system repo. import.meta.url, not the bun-only import.meta.dir: the
 * registry evaluates host:"any" sidecars under Node via jiti.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL_ROOT = resolve(HERE, "..", "..", "..");
const CORE_ROOT = resolve(KERNEL_ROOT, "..");
const DOCS_SYSTEM_ROOT = join(CORE_ROOT, "docs-system");

const frameworkFile = (...segments: string[]): string =>
	join(DOCS_SYSTEM_ROOT, "packages", "framework", ...segments);

/** The standing context blocks, in their rendered reading order. */
export const CONTEXT_BLOCKS: ReadonlyArray<ContextBlock> = [
	{
		tag: "docs_framework_skill",
		files: [frameworkFile("SKILL.md")],
	},
	{
		tag: "docs_structure_standards",
		files: [
			frameworkFile("20-standards", "00-overview.md"),
			frameworkFile("20-standards", "10-hierarchy-layers.md"),
			frameworkFile("20-standards", "20-directory-rules.md"),
			frameworkFile("20-standards", "25-frontmatter-schema.md"),
			frameworkFile("20-standards", "30-numbering-system.md"),
			frameworkFile("20-standards", "40-doc-linking.md"),
			frameworkFile("20-standards", "50-code-linking.md"),
		],
	},
	{
		tag: "docs_cookbook",
		files: [
			frameworkFile("10-cookbook", "10-navigate.md"),
			frameworkFile("10-cookbook", "20-produce.md"),
			frameworkFile("10-cookbook", "30-maintain.md"),
		],
	},
	{
		tag: "docs_writing_style",
		files: [join(DOCS_SYSTEM_ROOT, "writingstyle.md")],
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
