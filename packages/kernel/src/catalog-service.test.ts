/**
 * Service-level tests for the kernel catalog service: disk-freshness of
 * prompt.json (out-of-band rewrites hot-swap in and register "disk-sync"
 * revisions) and the context preview block on agent detail. A real registry
 * over a temp agent-catalog directory + a temp SQLite kernel db, like the
 * catalog API tests; temp dirs live under import.meta.dir so context.ts
 * sidecar fixtures resolve their package imports.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	listPromptRevisionsForAgent,
	openKernelDatabase,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import {
	canonicalizePrompt,
	hashPrompt,
	PROMPT_KIT_SCHEMA_VERSION,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";

import {
	buildRegistry,
	registerPromptRevisions,
	syncAgentPromptFromDisk,
	type AgentRegistry,
} from "./agent-registry";
import {
	createKernelCatalogService,
	type KernelCatalogService,
} from "./catalog-service";
import { createDefaultCatalog, type Loader } from "./context";

const AGENT_NAME = "catalog-service-agent";

function makePromptDocument(paragraphs: string[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: "catalog-service-prompt",
		title: "Catalog Service Test",
		nodes: [
			{
				type: "section",
				id: "sec-purpose",
				tag: "purpose",
				children: paragraphs.map((text, index) => ({
					type: "paragraph",
					id: `para-${index}`,
					content: [text],
				})),
			},
		],
	} as PromptDocument;
}

const manifest = {
	$schema: "agent-kernel/agent-v1",
	name: AGENT_NAME,
	description: "Agent fixture for catalog service tests.",
	model: "test-model-alias",
	variables: {
		focus: { default: "default-focus", description: "Assigned focus." },
	},
};

/**
 * context.ts sidecar fixture: one static text input plus one custom-kind
 * input whose loader resolves "empty" without live session data. assemble()
 * joins whatever content the builder hands it, so placeholder substitution
 * is directly observable in the rendered preview.
 */
const CONTEXT_TS = `import { defineContext } from "@agent-kernel/kernel/agent-definition";

export const context = defineContext({
  loaders: [
    { kind: "text", content: "STATIC-PREVIEW-TEXT", label: "static-note" },
    { kind: "session-notes", ref: "notes" }
  ],
  assemble(loaded) {
    return loaded.map((input) => input.content).join("\\n");
  }
});
`;

/** Custom loader kind: "ok" only when live session data is present. */
const sessionNotesLoader: Loader = {
	kind: "session-notes",
	resolve: async (_decl, ctx) => {
		if (!ctx.sessionData) {
			return { status: "empty", content: "", bytes: 0, hash: "" };
		}
		const content = "live session notes";
		return {
			status: "ok",
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			hash: "",
		};
	},
};

let dir: string;
let catalogRoot: string;
let agentDir: string;
let promptFile: string;
let handle: KernelDatabaseHandle;
let registry: AgentRegistry;
let service: KernelCatalogService;
let originalDocument: PromptDocument;
// Monotonic mtime source: mtimeMs granularity can swallow rapid successive
// writes, so every rewrite stamps an explicitly increasing timestamp.
let mtimeTick: number;

function writePromptFile(content: string): void {
	writeFileSync(promptFile, content, "utf8");
	mtimeTick += 1000;
	const stamp = new Date(mtimeTick);
	utimesSync(promptFile, stamp, stamp);
}

async function bootFixture(opts: { contextTs?: string } = {}): Promise<void> {
	dir = mkdtempSync(join(import.meta.dir, ".catalog-service-test-"));
	catalogRoot = join(dir, "agent-catalog");
	agentDir = join(catalogRoot, AGENT_NAME);
	mkdirSync(agentDir, { recursive: true });

	originalDocument = makePromptDocument(["You are the catalog service test agent."]);
	writeFileSync(join(agentDir, "agent.json"), `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
	writeFileSync(join(agentDir, "prompt.json"), canonicalizePrompt(originalDocument), "utf8");
	if (opts.contextTs) {
		writeFileSync(join(agentDir, "context.ts"), opts.contextTs, "utf8");
	}
	promptFile = join(agentDir, "prompt.json");
	mtimeTick = Date.now() + 5000;

	handle = openKernelDatabase({ path: kernelDatabasePath(dir) });
	await ensureKernelObservabilitySchema(handle.db);

	registry = await buildRegistry({ roots: [catalogRoot] });
	await registerPromptRevisions(handle.db, registry);

	service = createKernelCatalogService({
		registry: async () => registry,
		db: () => handle.db,
		contextCatalog: () => {
			const catalog = createDefaultCatalog();
			catalog.register(sessionNotesLoader);
			return catalog;
		},
	});
}

afterEach(() => {
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("catalog service disk-freshness (prompt.json rewritten out-of-band)", () => {
	beforeEach(() => bootFixture());

	test("getAgentDetail / listAgents serve the rewritten prompt and record a disk-sync revision", async () => {
		const edited = makePromptDocument([
			"You are the catalog service test agent.",
			"Prefer terse answers.",
		]);
		writePromptFile(canonicalizePrompt(edited));

		const detail = await service.getAgentDetail(AGENT_NAME);
		expect(detail?.promptHash).toBe(hashPrompt(edited));
		expect(detail?.rendered).toContain("Prefer terse answers.");

		// The registry entry was hot-swapped: the next spawn freezes this prompt.
		expect(registry.get(AGENT_NAME).promptHash).toBe(hashPrompt(edited));

		const revisions = await service.listRevisions(AGENT_NAME);
		const sources = (revisions ?? []).map((row) => [row.hash, row.source]);
		expect(sources).toContainEqual([hashPrompt(originalDocument), "registry-boot"]);
		expect(sources).toContainEqual([hashPrompt(edited), "disk-sync"]);

		const listed = await service.listAgents();
		expect(listed).toHaveLength(1);
		expect(listed[0].promptHash).toBe(hashPrompt(edited));
	});

	test("a mid-edit invalid file serves the cached prompt without throwing, then recovers", async () => {
		writePromptFile("{ half-written garbag");

		const detail = await service.getAgentDetail(AGENT_NAME);
		expect(detail?.promptHash).toBe(hashPrompt(originalDocument));
		expect((await service.listAgents())[0].promptHash).toBe(hashPrompt(originalDocument));
		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT_NAME);
		expect(revisions.map((row) => row.source)).toEqual(["registry-boot"]);

		// The edit completes: the next read picks up the finished document.
		const finished = makePromptDocument(["Finished edit."]);
		writePromptFile(canonicalizePrompt(finished));
		const fresh = await service.getAgentDetail(AGENT_NAME);
		expect(fresh?.promptHash).toBe(hashPrompt(finished));
	});

	test("a formatting-only rewrite keeps the hash and adds no disk-sync revision", async () => {
		// Same canonical document, different bytes on disk.
		writePromptFile(`${JSON.stringify(originalDocument, null, 2)}\n`);

		const detail = await service.getAgentDetail(AGENT_NAME);
		expect(detail?.promptHash).toBe(hashPrompt(originalDocument));

		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT_NAME);
		expect(revisions.map((row) => row.source)).toEqual(["registry-boot"]);
	});

	test("syncAgentPromptFromDisk: change upserts a disk-sync row; failure returns the cached def", async () => {
		const edited = makePromptDocument(["Synced from disk."]);
		writePromptFile(canonicalizePrompt(edited));

		const synced = await syncAgentPromptFromDisk(handle.db, registry, AGENT_NAME);
		expect(synced.promptHash).toBe(hashPrompt(edited));
		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT_NAME);
		expect(revisions.map((row) => [row.hash, row.source])).toContainEqual([
			hashPrompt(edited),
			"disk-sync",
		]);

		// A failing read serves the cached definition and adds nothing.
		writePromptFile("{ half-written garbag");
		const cached = await syncAgentPromptFromDisk(handle.db, registry, AGENT_NAME);
		expect(cached.promptHash).toBe(hashPrompt(edited));
		expect(await listPromptRevisionsForAgent(handle.db, AGENT_NAME)).toHaveLength(
			revisions.length,
		);
	});
});

describe("catalog service context preview", () => {
	test("agent without a context.ts sidecar answers context: null", async () => {
		await bootFixture();

		const detail = await service.getAgentDetail(AGENT_NAME);
		expect(detail).not.toBeNull();
		expect(detail?.context).toBeNull();
	});

	test("sidecar preview renders static inputs, placeholders for session inputs, true statuses", async () => {
		await bootFixture({ contextTs: CONTEXT_TS });

		const detail = await service.getAgentDetail(AGENT_NAME);
		expect(detail?.context).not.toBeNull();
		const context = detail!.context!;

		expect(context.modulePath).toBe(join(agentDir, "context.ts"));
		expect(context.renderedContext).toContain("STATIC-PREVIEW-TEXT");
		expect(context.renderedContext).toContain(
			"(assembled per spawn from live session data)",
		);
		// The reported statuses are the build's own, not the placeholder view.
		expect(context.inputs).toEqual([
			{ loaderKind: "text", inputRef: "static-note", status: "ok", bytes: 19 },
			{ loaderKind: "session-notes", inputRef: "notes", status: "empty", bytes: 0 },
		]);
	});

	test("without a contextCatalog the preview degrades to declaration metadata", async () => {
		await bootFixture({ contextTs: CONTEXT_TS });
		const bare = createKernelCatalogService({
			registry: async () => registry,
			db: () => handle.db,
		});

		const detail = await bare.getAgentDetail(AGENT_NAME);
		expect(detail?.context).toEqual({
			modulePath: join(agentDir, "context.ts"),
			inputs: [],
			renderedContext: null,
		});
	});
});
