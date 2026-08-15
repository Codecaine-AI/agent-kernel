/**
 * docs-writer bundle tools — the typed write surface over a docs-system
 * corpus. Self-contained (host: "any"): node:fs + @codecaine-ai/docs-model /
 * docs-cli only, no app runtime, Node-portable (no bun-only APIs — the
 * registry evaluates this under pi's Node runtime).
 *
 * The agent reads the repo freely with pi's built-ins; corpus MUTATIONS go
 * only through these tools (the manifest disallows built-in write/edit, and
 * the TUI blocks them at tool_call). docs_write validates against
 * doc-schema before anything touches disk — invalid documents are rejected,
 * not written.
 *
 * Known limitation: docs_write is full-document — updating an existing doc
 * regenerates block ids (annotations anchored to old ids detach). The
 * document id itself is preserved. Surgical applyOps-based updates are the
 * designed successor once id-stable editing matters.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { mdxToDoc } from "@codecaine-ai/docs-cli/migrate/mdx-to-doc";
// Deep subpath imports only — the docs-model BARREL re-exports components/,
// which calls @sinclair/typebox Type.Recursive at module load and breaks
// under pi's runtime (typebox flavor mismatch: "Type.Recursive is not a
// function"). doc-schema and delta-markdown are typebox-free.
import { deltaToMarkdownInline } from "@codecaine-ai/docs-model/delta-markdown";
import {
	serializeDocDocument,
	validateDocDocument,
	type DocBlock,
	type DocDocument,
} from "@codecaine-ai/docs-model/doc-schema";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SKIP_DIRS = new Set(["node_modules", ".git", "reference", "dist", "build"]);

interface ToolTextResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

function textResult(text: string, details: Record<string, unknown> = {}): ToolTextResult {
	return { content: [{ type: "text", text }], details };
}

function errorResult(text: string, details: Record<string, unknown> = {}): ToolTextResult {
	return textResult(`ERROR: ${text}`, { ...details, error: true });
}

/** Walk up from startDir to a directory containing docs/; null when none. */
export function findDocsRoot(startDir: string): string | null {
	let dir = resolve(startDir);
	for (;;) {
		const candidate = join(dir, "docs");
		if (existsSync(join(candidate))) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function resolveRoot(root: string | undefined): string | { error: string } {
	const found = root ? resolve(process.cwd(), root) : findDocsRoot(process.cwd());
	if (!found || !existsSync(found)) {
		return {
			error: root
				? `docs root not found: ${root}`
				: "no docs/ tree found from the working directory up; pass `root` explicitly",
		};
	}
	return found;
}

/** Normalize a doc path to its folder, and refuse escapes from the root. */
function resolveDocDir(root: string, docPath: string): string | { error: string } {
	const cleaned = docPath.replace(/\/?doc\.json$/, "").replace(/\/+$/, "");
	const abs = resolve(root, cleaned);
	const rel = relative(root, abs);
	if (rel.startsWith("..") || resolve(abs) === resolve(root, "..")) {
		return { error: `doc path escapes the docs root: ${docPath}` };
	}
	return abs;
}

export function listDocs(root: string): Array<{ path: string; title: string; blocks: number }> {
	const found: Array<{ path: string; title: string; blocks: number }> = [];
	const walk = (dir: string) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
			const child = join(dir, entry.name);
			const docFile = join(child, "doc.json");
			if (existsSync(docFile)) {
				try {
					const parsed = JSON.parse(readFileSync(docFile, "utf8")) as DocDocument;
					found.push({
						path: relative(root, child),
						title: parsed.title ?? "(untitled)",
						blocks: Object.keys(parsed.blocks ?? {}).length,
					});
				} catch {
					found.push({ path: relative(root, child), title: "(unreadable doc.json)", blocks: 0 });
				}
			}
			walk(child);
		}
	};
	walk(root);
	return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Minimal doc → markdown projection over the typebox-free primitives.
 * Covers the core text types mdxToDoc produces; structured/diagram component
 * blocks render as placeholders (docs-model's full projectToMarkdown renders
 * their agent views, but its import chain is not loadable under pi — see the
 * import comment above).
 */
export function renderDocMarkdown(doc: DocDocument): string {
	const lines: string[] = [];
	const walk = (blockId: string, depth: number) => {
		const block: DocBlock | undefined = doc.blocks[blockId];
		if (!block) return;
		const text = deltaToMarkdownInline(block.text);
		switch (block.type) {
			case "heading": {
				const level = Number(block.props.level) || 1;
				lines.push(`${"#".repeat(Math.min(6, Math.max(1, level)))} ${text}`, "");
				break;
			}
			case "paragraph":
				lines.push(text, "");
				break;
			case "list-item":
				lines.push(`${"  ".repeat(Math.max(0, depth))}- ${text}`);
				break;
			case "quote":
			case "callout":
				lines.push(`> ${text}`, "");
				break;
			case "code": {
				const lang = typeof block.props.language === "string" ? block.props.language : "";
				lines.push(`\`\`\`${lang}`, text, "```", "");
				break;
			}
			case "divider":
				lines.push("---", "");
				break;
			default:
				lines.push(`> [${block.type} block${text ? `: ${text}` : ""}]`, "");
		}
		const childDepth = block.type === "list-item" ? depth + 1 : 0;
		for (const child of block.children) walk(child, childDepth);
	};
	const root = doc.blocks[doc.root];
	for (const child of root?.children ?? []) walk(child, 0);
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function readValidated(docFile: string): DocDocument | { error: string } {
	if (!existsSync(docFile)) return { error: `no doc.json at ${docFile}` };
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(docFile, "utf8"));
	} catch (err) {
		return { error: `unparseable doc.json: ${err instanceof Error ? err.message : String(err)}` };
	}
	const result = validateDocDocument(parsed);
	if (!result.ok) {
		return {
			error: `invalid doc.json:\n${result.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`,
		};
	}
	return result.document;
}

export function registerDocsTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "docs_tree",
		label: "Docs tree",
		description:
			"List the repo's docs-system corpus: every doc node with its path, title, and block count. Start here to orient.",
		promptSnippet: "List the docs corpus before proposing or writing.",
		parameters: Type.Object({
			root: Type.Optional(Type.String({ description: "docs root; default: nearest docs/ up-tree" })),
		}),
		executionMode: "sequential",
		execute: async (_id, params) => {
			const root = resolveRoot(params.root);
			if (typeof root !== "string") return errorResult(root.error);
			const docs = listDocs(root);
			if (docs.length === 0) return textResult(`docs root ${root} contains no doc.json nodes yet`);
			const lines = docs.map((d) => `${d.path} — ${d.title} (${d.blocks} blocks)`);
			return textResult(`docs root: ${root}\n${lines.join("\n")}`, { root, count: docs.length });
		},
	});

	pi.registerTool({
		name: "docs_read",
		label: "Read doc",
		description:
			"Read one doc node rendered as markdown (the sanctioned read path — never read doc.json internals directly).",
		promptSnippet: "Read target and neighboring docs as rendered markdown.",
		parameters: Type.Object({
			path: Type.String({ description: "doc node path relative to the docs root" }),
			root: Type.Optional(Type.String()),
		}),
		executionMode: "sequential",
		execute: async (_id, params) => {
			const root = resolveRoot(params.root);
			if (typeof root !== "string") return errorResult(root.error);
			const dir = resolveDocDir(root, params.path);
			if (typeof dir !== "string") return errorResult(dir.error);
			const doc = readValidated(join(dir, "doc.json"));
			if ("error" in doc) return errorResult(doc.error);
			return textResult(renderDocMarkdown(doc), {
				path: relative(root, dir),
				title: doc.title ?? null,
				blocks: Object.keys(doc.blocks).length,
			});
		},
	});

	pi.registerTool({
		name: "docs_write",
		label: "Write doc",
		description:
			"Create or fully replace one doc node from markdown. The markdown is converted to the doc.json block format and schema-validated; invalid documents are rejected without writing. Updating an existing node preserves its document id but regenerates block ids.",
		promptSnippet: "Write corpus changes exclusively through docs_write.",
		parameters: Type.Object({
			path: Type.String({ description: "doc node path relative to the docs root" }),
			markdown: Type.String({
				description: "full document as markdown (optional flat frontmatter, then body)",
			}),
			root: Type.Optional(Type.String()),
		}),
		executionMode: "sequential",
		execute: async (_id, params) => {
			const root = resolveRoot(params.root);
			if (typeof root !== "string") return errorResult(root.error);
			const dir = resolveDocDir(root, params.path);
			if (typeof dir !== "string") return errorResult(dir.error);
			const docFile = join(dir, "doc.json");

			const relPath = relative(root, dir);
			const converted = mdxToDoc(params.markdown, relPath);
			const existing = existsSync(docFile) ? readValidated(docFile) : null;
			if (existing && !("error" in existing)) {
				// Full-write keeps the document identity stable across updates.
				converted.doc.id = existing.id;
			}

			const result = validateDocDocument(converted.doc);
			if (!result.ok) {
				return errorResult(
					`converted document failed validation — nothing written:\n${result.issues
						.map((i) => `  ${i.path}: ${i.message}`)
						.join("\n")}`,
					{ path: relPath },
				);
			}

			mkdirSync(dir, { recursive: true });
			writeFileSync(docFile, serializeDocDocument(result.document));
			const action = existing ? "updated" : "created";
			const warnings = converted.warnings.length
				? `\nconversion warnings:\n${converted.warnings.map((w) => `  ${w}`).join("\n")}`
				: "";
			return textResult(
				`${action} ${relPath} (${Object.keys(result.document.blocks).length} blocks)${warnings}`,
				{ path: relPath, action, warnings: converted.warnings },
			);
		},
	});

	pi.registerTool({
		name: "docs_check",
		label: "Check docs",
		description:
			"Validate one doc node (or the whole corpus) against the doc schema. Run on every touched doc before finishing.",
		promptSnippet: "Validate touched docs with docs_check before finishing.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "one doc node; omit to check the whole corpus" })),
			root: Type.Optional(Type.String()),
		}),
		executionMode: "sequential",
		execute: async (_id, params) => {
			const root = resolveRoot(params.root);
			if (typeof root !== "string") return errorResult(root.error);
			const targets = params.path
				? [params.path]
				: listDocs(root).map((doc) => doc.path);
			const failures: string[] = [];
			for (const target of targets) {
				const dir = resolveDocDir(root, target);
				if (typeof dir !== "string") {
					failures.push(`${target}: ${dir.error}`);
					continue;
				}
				const doc = readValidated(join(dir, "doc.json"));
				if ("error" in doc) failures.push(`${target}: ${doc.error}`);
			}
			if (failures.length > 0) {
				return errorResult(`${failures.length}/${targets.length} doc(s) failed:\n${failures.join("\n")}`);
			}
			return textResult(`ok — ${targets.length} doc(s) valid`, { checked: targets.length });
		},
	});
}
