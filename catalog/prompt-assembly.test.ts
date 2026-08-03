/**
 * Prompt shape gate for the first-party prompt-editor bundle (the canvas
 * layout-editor prompt-assembly test, ported to the kernel catalog).
 *
 * The static prompt is the purpose, the inputs picture, the editing rules,
 * the workflow, and the tool semantics — operational text only. The authoring
 * reference lives in the <prompt_kit_authoring> context block, the target
 * prompt and request queue arrive per-session from the session service, and
 * tool mechanics live in the tool schemas.
 *
 * Shape is part of the contract: every bullet and step carries one sentence
 * with its qualifications nested beneath it, and the only variable the body
 * references is the manifest's one declaration.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
	canonicalizePrompt,
	hashPrompt,
	renderXmlMarkdown,
	validatePrompt,
	validatePromptDocumentShape,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";
import {
	buildRegistry,
	refreshBundlePromptSnapshot,
	resolvePromptEntry,
	validateVariables,
} from "@agent-kernel/kernel/agent-registry";
import type {
	LoadedMap,
	SpawnContext,
} from "@agent-kernel/kernel/context";

import promptEditorContext, {
	AUTHORING_REFERENCE_FILES,
} from "./prompt-editor/context/index";

const CATALOG_DIR = import.meta.dir;
const BUNDLE_DIR = join(CATALOG_DIR, "prompt-editor");
const PROMPT_FILE = join(BUNDLE_DIR, "prompt", "prompt.json");

interface PromptNode {
	type: string;
	tag?: string;
	[key: string]: unknown;
}

function readPrompt(): {
	raw: string;
	document: PromptDocument;
	nodes: PromptNode[];
	text: string;
} {
	const raw = readFileSync(PROMPT_FILE, "utf8");
	const document = JSON.parse(raw) as PromptDocument;
	const strings: string[] = [];
	const collect = (value: unknown, key?: string): void => {
		if (typeof value === "string") {
			if (key === "content") strings.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const entry of value) collect(entry, key);
			return;
		}
		if (value && typeof value === "object") {
			for (const [childKey, child] of Object.entries(value)) {
				collect(child, childKey);
			}
		}
	};
	collect(document);
	return {
		raw,
		document,
		nodes: document.nodes as unknown as PromptNode[],
		text: strings.join("\n"),
	};
}

/** Every listItem in the tree, as { id, text } pairs. */
function listItems(root: unknown): { id: string; text: string }[] {
	const found: { id: string; text: string }[] = [];
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const entry of value) walk(entry);
			return;
		}
		if (!value || typeof value !== "object") return;
		const node = value as PromptNode;
		if (node.type === "listItem") {
			const content = Array.isArray(node.content) ? node.content : [];
			found.push({
				id: String(node.id ?? "(unnamed)"),
				text: content
					.filter((part): part is string => typeof part === "string")
					.join(""),
			});
		}
		for (const child of Object.values(node)) walk(child);
	};
	walk(root);
	return found;
}

function manifestVariables(): string[] {
	const manifest = JSON.parse(
		readFileSync(join(BUNDLE_DIR, "agent.json"), "utf8"),
	) as { variables?: Record<string, unknown> };
	return Object.keys(manifest.variables ?? {});
}

function fakeSpawnContext(
	overrides: Partial<SpawnContext> = {},
): SpawnContext {
	return {
		agentName: "prompt-editor",
		variables: {},
		caller: { kind: "system", id: "test" },
		runtime: { cwd: BUNDLE_DIR },
		paths: { workingDir: BUNDLE_DIR, activeSessionDir: BUNDLE_DIR },
		...overrides,
	};
}

async function loadDeclaredFiles(): Promise<LoadedMap> {
	return promptEditorContext.loaders.map((decl) => {
		const path = String((decl as { path?: unknown }).path ?? "");
		const content = readFileSync(path, "utf8");
		return {
			decl,
			status: "ok" as const,
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			hash: "",
			fromCache: false,
		};
	});
}

describe("prompt-editor bundle", () => {
	test("the registry discovers the bundle from the catalog root", async () => {
		const registry = await buildRegistry({ roots: [CATALOG_DIR] });
		expect(registry.list().map((def) => def.name)).toContain("prompt-editor");
		const def = registry.get("prompt-editor");
		expect(def.contextResolver).not.toBeNull();
		expect(def.manifest.model).toBe("prompt-editor");
		expect(Object.keys(def.manifest.variables)).toEqual(["targetAgent"]);
		// Boot-time variable validation passed with nothing left over.
		expect(def.warnings).toEqual([]);
	});

	test("the bundle is in folder form with no flat-file shadows", () => {
		expect(resolvePromptEntry(BUNDLE_DIR).form).toBe("folder");
		expect(existsSync(join(BUNDLE_DIR, "context", "index.ts"))).toBe(true);
		expect(existsSync(join(BUNDLE_DIR, "prompt.json"))).toBe(false);
		expect(existsSync(join(BUNDLE_DIR, "prompt.rendered.md"))).toBe(false);
		expect(existsSync(join(BUNDLE_DIR, "context.ts"))).toBe(false);
	});

	test("prompt.json is canonical bytes and hashes as pk1", () => {
		const { raw, document } = readPrompt();
		const shape = validatePromptDocumentShape(document);
		expect(shape.errors).toEqual([]);
		expect(canonicalizePrompt(document)).toBe(raw);
		expect(hashPrompt(document)).toStartWith("pk1-");
	});

	test("the prompt validates against the manifest's declared variables", () => {
		const { document } = readPrompt();
		const declared = manifestVariables();
		const result = validatePrompt(document, { declaredVariables: declared });
		expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
			[],
		);
		expect(result.ok).toBe(true);
		// The rendered body references exactly the declared set — no strays,
		// no unused declarations.
		const body = renderXmlMarkdown(document);
		const vars = validateVariables(
			body,
			Object.fromEntries(declared.map((name) => [name, {}])),
		);
		expect(vars.missingDeclarations).toEqual([]);
		expect(vars.unusedDeclarations).toEqual([]);
	});

	test("the committed system.md is fresh and the render is stable", () => {
		const { document } = readPrompt();
		const result = refreshBundlePromptSnapshot(BUNDLE_DIR, { dryRun: true });
		expect(result.form).toBe("folder");
		expect(result.changed).toBe(false);
		expect(result.canonicalized).toBe(false);
		// Same document, same bytes, every time.
		expect(renderXmlMarkdown(document)).toBe(renderXmlMarkdown(document));
		expect(canonicalizePrompt(document)).toBe(
			canonicalizePrompt(JSON.parse(canonicalizePrompt(document))),
		);
	});

	test("ships exactly the five static sections, in reading order", () => {
		const { nodes } = readPrompt();
		expect(
			nodes.filter((node) => node.type === "section").map((node) => node.tag),
		).toEqual(["purpose", "inputs", "editing_rules", "workflow", "tools"]);
	});

	test("every bullet and step carries a single sentence", () => {
		const { nodes } = readPrompt();
		for (const entry of listItems(nodes)) {
			expect(entry.text, `${entry.id} packs more than one sentence`).not.toMatch(
				/[.!?]"?\s+[A-Z`]/,
			);
		}
	});

	test("pins the identity and the staged-review framing", () => {
		const { text } = readPrompt();
		expect(text).toContain(
			"you change that agent's system prompt on behalf of the human who owns it",
		);
		expect(text).toContain(
			"its rendered markdown is a projection you never touch",
		);
		expect(text).toContain(
			"Your edits are staged proposals for human review, and nothing lands in the live prompt until the human accepts it.",
		);
	});

	test("pins the structural-transaction editing rules", () => {
		const { text } = readPrompt();
		expect(text).toContain(
			"an edit is a transaction of id-relative steps against the document tree, and rewritten markdown is never an edit",
		);
		expect(text).toContain("Preserve node ids");
		expect(text).toContain("Prefer the minimal transaction");
		expect(text).toContain(
			"a proposal that fails validation bounces straight back to you — repair it and propose again",
		);
		expect(text).toContain("Respect the target prompt's voice");
		expect(text).toContain(
			"notes, replies, and resolutions are plain language",
		);
	});

	test("pins the queue workflow: read all, one proposal each, resolve each", () => {
		const { text } = readPrompt();
		expect(text).toContain("Read the whole queue before editing anything");
		expect(text).toContain(
			"Propose exactly one transaction per request with propose_transaction",
		);
		expect(text).toContain(
			"Resolve every request individually with resolve_request",
		);
		expect(text).toContain("A batch never resolves as a lump");
		expect(text).toContain("the run never stalls waiting for an answer");
		expect(text).toContain(
			"Work a document-level request by pinning placed notes with add_note",
		);
	});

	test("names the five v1 tools and no others", () => {
		const { text } = readPrompt();
		for (const tool of [
			"read_prompt",
			"propose_transaction",
			"resolve_request",
			"reply_request",
			"add_note",
		]) {
			expect(text).toContain(tool);
		}
		// Retired / sibling-surface names stay out of the model's vocabulary.
		for (const absent of [
			"apply_steps",
			"save_prompt",
			"write_prompt",
			"add_annotation",
			"reply_annotation",
			"resolve_annotation",
		]) {
			expect(text).not.toContain(absent);
		}
	});

	test("the rendered body's only moustache is the declared variable", () => {
		const { document } = readPrompt();
		const body = renderXmlMarkdown(document);
		const refs = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
		expect([...new Set(refs)]).toEqual(["targetAgent"]);
	});
});

describe("prompt-editor context sidecar", () => {
	test("declares only file loaders over the authoring reference, and every file exists", () => {
		expect(promptEditorContext.loaders.length).toBe(
			AUTHORING_REFERENCE_FILES.length,
		);
		for (const decl of promptEditorContext.loaders) {
			expect(decl.kind).toBe("file");
			const path = String((decl as { path?: unknown }).path ?? "");
			expect(existsSync(path), `missing reference file: ${path}`).toBe(true);
		}
	});

	test("assembles placeholders when no session is attached", async () => {
		const loaded = await loadDeclaredFiles();
		const out = await promptEditorContext.assemble(
			loaded,
			fakeSpawnContext(),
		);
		expect(out).toContain("<prompt_kit_authoring>");
		expect(out).toContain('<doc name="authoring-model">');
		expect(out).toContain('<doc name="core-methodology">');
		expect(out).toContain('<doc name="improve-prompt-ts">');
		expect(out).toContain('<doc name="anti-patterns">');
		expect(out).toContain('<target_prompt agent="(unset)" hash="(unset)">');
		expect(out).toContain(
			"sessionData.targetPromptRender to the node-id-stamped render",
		);
		expect(out).toContain("<requests>");
		expect(out).toContain("sessionData.requestQueue to the rendered queue");
	});

	test("assembles the session service's payload when attached", async () => {
		const loaded = await loadDeclaredFiles();
		const out = await promptEditorContext.assemble(
			loaded,
			fakeSpawnContext({
				variables: { targetAgent: "source-scout" },
				sessionData: {
					targetPromptRender:
						'<section id="node-section-purpose">the render</section>',
					targetPromptHash: "pk1-feedface",
					requestQueue:
						'R1 open node-section-purpose — "tighten the identity line"',
				},
			}),
		);
		expect(out).toContain(
			'<target_prompt agent="source-scout" hash="pk1-feedface">',
		);
		expect(out).toContain('<section id="node-section-purpose">the render</section>');
		expect(out).toContain(
			'R1 open node-section-purpose — "tighten the identity line"',
		);
		expect(out).not.toContain("(unset)");
	});
});
