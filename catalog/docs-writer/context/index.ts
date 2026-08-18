/**
 * Section ② — standing docs-system knowledge for the docs writer.
 *
 * Two corpus-rendered sources, mirroring docs-lab-editor: structure
 * standards and the style guide load as doc.json bundles from the sibling
 * docs-system repo and render through the sanctioned agent projection, so
 * they stay current by construction (the retired packages/framework
 * markdown copies are gone). Tool mechanics live in the bundle's tools.ts
 * definitions, not here.
 *
 * Deep docs-model subpath imports on purpose: the barrel breaks under pi
 * (@sinclair/typebox Type.Recursive) — same rule as tools/runtime.ts.
 *
 * There is deliberately no outer <context> envelope: the kernel supplies it.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineContext } from "@agent-kernel/kernel/agent-definition";
import type {
	AgentContextResolver,
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";
import { validateDocDocument } from "@codecaine-ai/docs-model/doc-schema";
import { projectToMarkdown } from "@codecaine-ai/docs-model/project-markdown";

/**
 * Anchor paths to this bundle so host:"any" evaluation works under Node and
 * from any process working directory.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL_ROOT = resolve(HERE, "..", "..", "..");
const CORE_ROOT = resolve(KERNEL_ROOT, "..");
const DOCS_ROOT = join(CORE_ROOT, "docs-system", "docs");

/**
 * The corpus bundles rendered into <docs_structure_standards>, in reading
 * order. Standards live in the docs-system corpus.
 */
export const STANDARDS_BUNDLES: ReadonlyArray<string> = [
	"10-system-design/10-doc-standards/10-structure",
	"10-system-design/10-doc-standards/20-numbering",
	"10-system-design/10-doc-standards/30-cross-doc-linking",
	"10-system-design/10-doc-standards/40-code-linking",
	"10-system-design/10-doc-standards/50-in-code-docs",
	"10-system-design/10-doc-standards/60-implementation-layer",
];

/** The corpus bundles rendered into <docs_style_guide>, in reading order. */
export const STYLE_GUIDE_BUNDLES: ReadonlyArray<string> = [
	"99-appendix/10-style-guide/10-writing-style",
	"99-appendix/10-style-guide/20-structure",
];

const bundleFile = (bundle: string): string =>
	join(DOCS_ROOT, bundle, "doc.json");

const loaders: AgentContextResolver["loaders"] = [
	...STANDARDS_BUNDLES,
	...STYLE_GUIDE_BUNDLES,
].map((bundle) => ({
	kind: "file" as const,
	path: bundleFile(bundle),
}));

function loadedPath(input: LoadedMap[number]): string {
	return typeof input.decl === "object" && "path" in input.decl
		? String(input.decl.path)
		: "";
}

const INDENT = "  ";

function indent(body: string): string {
	return body
		.split("\n")
		.map((line) => (line.length > 0 ? `${INDENT}${line}` : line))
		.join("\n");
}

/** Wraps body in a tag, indenting it one level; nested calls accumulate. */
function block(tag: string, attrs: string, body: string): string {
	const open = attrs.length > 0 ? `<${tag} ${attrs}>` : `<${tag}>`;
	return [open, indent(body), `</${tag}>`].join("\n");
}

function renderCorpusDoc(bundle: string, raw: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return `<doc path="${bundle}" status="unparseable"></doc>`;
	}
	const validated = validateDocDocument(parsed);
	if (!validated.ok) {
		return `<doc path="${bundle}" status="invalid"></doc>`;
	}
	const title = validated.document.title ?? bundle;
	return block(
		"doc",
		`path="${bundle}" title="${title}"`,
		projectToMarkdown(validated.document),
	);
}

// Standing knowledge is session-invariant; the session aim belongs to state.
function assemble(loaded: LoadedMap, _ctx: SpawnContext): string {
	const loadedByPath = new Map(loaded.map((input) => [loadedPath(input), input]));

	const renderBundles = (bundles: ReadonlyArray<string>): string =>
		bundles
			.map((bundle) => {
				const input = loadedByPath.get(bundleFile(bundle));
				if (input === undefined || input.status !== "ok") {
					return `<doc path="${bundle}" status="${input?.status ?? "missing"}"></doc>`;
				}
				return renderCorpusDoc(bundle, input.content);
			})
			.join("\n");

	return [
		block(
			"docs_structure_standards",
			'source="docs-system corpus · 10-system-design/10-doc-standards"',
			renderBundles(STANDARDS_BUNDLES),
		),
		block(
			"docs_style_guide",
			'source="docs-system corpus · 99-appendix/10-style-guide"',
			renderBundles(STYLE_GUIDE_BUNDLES),
		),
	].join("\n");
}

export const context = defineContext({ loaders, assemble });
export default context;
