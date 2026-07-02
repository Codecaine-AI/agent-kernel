/**
 * Route-level tests for the kernel catalog API (Phase 5): a real registry
 * over a temp agent-catalog directory + a temp SQLite kernel db, exercised
 * through Elysia's .handle(new Request(...)) like the read-api tests.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createAgentRun,
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	listPromptRevisionsForAgent,
	openKernelDatabase,
	upsertContainer,
	upsertPiAgentSession,
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
	type AgentRegistry,
} from "./agent-registry";
import { createKernelCatalogApi } from "./catalog-api";
import {
	createKernelCatalogService,
	RENDERED_SNAPSHOT_HEADER,
	type KernelCatalogService,
} from "./catalog-service";

const AGENT_NAME = "catalog-test-agent";

function makePromptDocument(paragraphs: string[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: "catalog-test-prompt",
		title: "Catalog Test",
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

/** A document referencing a variable the manifest does not declare. */
function makeUndeclaredVariableDocument(): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: "catalog-test-prompt",
		nodes: [
			{
				type: "paragraph",
				id: "para-var",
				content: [
					"Focus on ",
					{ type: "variable", id: "var-1", name: "notDeclaredAnywhere" },
				],
			},
		],
	} as PromptDocument;
}

const manifest = {
	$schema: "agent-kernel/agent-v1",
	name: AGENT_NAME,
	description: "Agent fixture for catalog API tests.",
	model: "test-model-alias",
	variables: {
		focus: { default: "", description: "Assigned focus." },
	},
};

let dir: string;
let catalogRoot: string;
let agentDir: string;
let handle: KernelDatabaseHandle;
let registry: AgentRegistry;
let service: KernelCatalogService;
let app: ReturnType<typeof createKernelCatalogApi>;
let originalDocument: PromptDocument;
let originalCanonical: string;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "agent-kernel-catalog-api-test-"));
	catalogRoot = join(dir, "agent-catalog");
	agentDir = join(catalogRoot, AGENT_NAME);
	mkdirSync(agentDir, { recursive: true });

	originalDocument = makePromptDocument(["You are the catalog test agent."]);
	originalCanonical = canonicalizePrompt(originalDocument);
	writeFileSync(join(agentDir, "agent.json"), `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
	writeFileSync(join(agentDir, "prompt.json"), originalCanonical, "utf8");

	handle = openKernelDatabase({ path: kernelDatabasePath(dir) });
	await ensureKernelObservabilitySchema(handle.db);

	registry = await buildRegistry({ roots: [catalogRoot] });
	await registerPromptRevisions(handle.db, registry);

	service = createKernelCatalogService({
		registry: async () => registry,
		db: () => handle.db,
		allowWrites: true,
	});
	app = createKernelCatalogApi(service);
});

afterEach(() => {
	handle.close();
	rmSync(dir, { recursive: true, force: true });
});

function url(path: string): string {
	return `http://localhost${path}`;
}

function putPrompt(
	target: ReturnType<typeof createKernelCatalogApi>,
	name: string,
	document: unknown,
) {
	return target.handle(
		new Request(url(`/kernel/catalog/agents/${name}/prompt`), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(document),
		}),
	);
}

describe("GET /kernel/catalog/agents", () => {
	test("lists registry agents with pre-alias model and prompt hash", async () => {
		const response = await app.handle(new Request(url("/kernel/catalog/agents")));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.agents).toEqual([
			{
				name: AGENT_NAME,
				description: manifest.description,
				model: "test-model-alias",
				promptHash: hashPrompt(originalDocument),
				valid: true,
			},
		]);
	});
});

describe("GET /kernel/catalog/agents/:name", () => {
	test("returns manifest, prompt document, hash, rendered text, declared variables", async () => {
		const response = await app.handle(
			new Request(url(`/kernel/catalog/agents/${AGENT_NAME}`)),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.manifest.name).toBe(AGENT_NAME);
		expect(body.manifest.model).toBe("test-model-alias");
		expect(body.prompt.kind).toBe("prompt");
		expect(body.promptHash).toBe(hashPrompt(originalDocument));
		expect(body.rendered).toContain("<purpose>");
		expect(body.rendered).toContain("You are the catalog test agent.");
		expect(body.declaredVariables).toEqual(["focus"]);
	});

	test("404 for an agent that is not in the registry", async () => {
		const response = await app.handle(
			new Request(url("/kernel/catalog/agents/no-such-agent")),
		);
		expect(response.status).toBe(404);
	});
});

describe("PUT /kernel/catalog/agents/:name/prompt", () => {
	test("happy path: canonical file, rendered snapshot, lab-save revision, hot-swapped registry", async () => {
		const edited = makePromptDocument([
			"You are the catalog test agent.",
			"Always cite the source file for every claim.",
		]);

		const response = await putPrompt(app, AGENT_NAME, edited);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({ hash: hashPrompt(edited) });
		expect(body.hash).not.toBe(hashPrompt(originalDocument));

		// prompt.json was rewritten with canonical bytes.
		const onDisk = readFileSync(join(agentDir, "prompt.json"), "utf8");
		expect(onDisk).toBe(canonicalizePrompt(edited));

		// prompt.rendered.md was regenerated with the derived header.
		const rendered = readFileSync(join(agentDir, "prompt.rendered.md"), "utf8");
		expect(rendered.startsWith(RENDERED_SNAPSHOT_HEADER)).toBe(true);
		expect(rendered).toContain("Always cite the source file for every claim.");

		// A lab-save revision row exists alongside the registry-boot row.
		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT_NAME);
		const sources = revisions.map((row) => [row.hash, row.source]);
		expect(sources).toContainEqual([hashPrompt(originalDocument), "registry-boot"]);
		expect(sources).toContainEqual([body.hash, "lab-save"]);

		// The in-memory registry entry was hot-swapped: subsequent spawns
		// resolve the new prompt without a restart.
		const def = registry.get(AGENT_NAME);
		expect(def.promptHash).toBe(body.hash);
		expect(def.parsed.promptHash).toBe(body.hash);
		expect(def.parsed.body).toContain("Always cite the source file for every claim.");

		// The detail route serves the new revision.
		const detail = await (
			await app.handle(new Request(url(`/kernel/catalog/agents/${AGENT_NAME}`)))
		).json();
		expect(detail.promptHash).toBe(body.hash);
	});

	test("undeclared variable: 400 with errors, files untouched", async () => {
		const response = await putPrompt(app, AGENT_NAME, makeUndeclaredVariableDocument());
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(Array.isArray(body.errors)).toBe(true);
		expect(body.errors.join("\n")).toContain("notDeclaredAnywhere");

		const onDisk = readFileSync(join(agentDir, "prompt.json"), "utf8");
		expect(onDisk).toBe(originalCanonical);
		expect(registry.get(AGENT_NAME).promptHash).toBe(hashPrompt(originalDocument));

		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT_NAME);
		expect(revisions.map((row) => row.source)).toEqual(["registry-boot"]);
	});

	test("shape failure: 400 with errors", async () => {
		const response = await putPrompt(app, AGENT_NAME, { kind: "not-a-prompt" });
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(Array.isArray(body.errors)).toBe(true);
		expect(body.errors.length).toBeGreaterThan(0);
	});

	test("unknown agent: 404", async () => {
		const response = await putPrompt(app, "no-such-agent", originalDocument);
		expect(response.status).toBe(404);
	});

	test("write gate: 403 when allowWrites is false, file untouched", async () => {
		const readOnly = createKernelCatalogApi(
			createKernelCatalogService({
				registry: async () => registry,
				db: () => handle.db,
				allowWrites: false,
			}),
		);

		const response = await putPrompt(readOnly, AGENT_NAME, makePromptDocument(["edit"]));
		expect(response.status).toBe(403);
		expect(readFileSync(join(agentDir, "prompt.json"), "utf8")).toBe(originalCanonical);
	});
});

describe("GET /kernel/catalog/agents/:name/revisions", () => {
	test("lists revisions newest-first with hash/source/createdAt", async () => {
		await putPrompt(app, AGENT_NAME, makePromptDocument(["revised body"]));

		const response = await app.handle(
			new Request(url(`/kernel/catalog/agents/${AGENT_NAME}/revisions`)),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.revisions).toHaveLength(2);
		for (const revision of body.revisions) {
			expect(Object.keys(revision).sort()).toEqual(["createdAt", "hash", "source"]);
		}
		const bySource = Object.fromEntries(
			body.revisions.map((revision: { source: string; hash: string }) => [
				revision.source,
				revision.hash,
			]),
		);
		expect(bySource["registry-boot"]).toBe(hashPrompt(originalDocument));
		expect(bySource["lab-save"]).toBe(hashPrompt(makePromptDocument(["revised body"])));
	});

	test("404 for an unknown agent", async () => {
		const response = await app.handle(
			new Request(url("/kernel/catalog/agents/no-such-agent/revisions")),
		);
		expect(response.status).toBe(404);
	});
});

describe("GET /kernel/catalog/agents/:name/revisions/:hash/stats", () => {
	const HASH_WITH_COST = "pk1-feedcafe";
	const HASH_WITHOUT_COST = "pk1-deadbeef";

	beforeEach(async () => {
		await upsertContainer(handle.db, {
			id: "container-1",
			kernelId: "catalog-test",
			kind: "session",
			appKey: ["stats-fixture"],
			status: "done",
			createdAt: "2026-07-01T00:00:00.000Z",
		});
		await upsertPiAgentSession(handle.db, {
			id: "session-1",
			containerId: "container-1",
			agentName: AGENT_NAME,
			promptHash: HASH_WITH_COST,
			status: "ended",
			createdAt: "2026-07-01T00:00:01.000Z",
		});
		await upsertPiAgentSession(handle.db, {
			id: "session-2",
			containerId: "container-1",
			agentName: AGENT_NAME,
			promptHash: HASH_WITHOUT_COST,
			status: "ended",
			createdAt: "2026-07-01T00:00:02.000Z",
		});

		// Two runs on the costed revision: one clean, one failed (turn-limit).
		await createAgentRun(handle.db, {
			id: "run-1",
			piSessionId: "session-1",
			containerId: "container-1",
			agentName: AGENT_NAME,
			trigger: "operator",
			status: "done",
			usageInputTokens: 100,
			usageOutputTokens: 50,
			usageCostEstimate: 0.25,
			startedAt: "2026-07-01T00:00:03.000Z",
		});
		await createAgentRun(handle.db, {
			id: "run-2",
			piSessionId: "session-1",
			containerId: "container-1",
			agentName: AGENT_NAME,
			trigger: "operator",
			status: "turn-limit",
			usageInputTokens: 20,
			usageOutputTokens: 10,
			usageCostEstimate: 0.05,
			startedAt: "2026-07-01T00:00:04.000Z",
		});
		// One run on the other revision with no cost data at all.
		await createAgentRun(handle.db, {
			id: "run-3",
			piSessionId: "session-2",
			containerId: "container-1",
			agentName: AGENT_NAME,
			trigger: "operator",
			status: "error",
			usageInputTokens: 8,
			usageOutputTokens: 2,
			startedAt: "2026-07-01T00:00:05.000Z",
		});
	});

	function statsUrl(hash: string): string {
		return url(
			`/kernel/catalog/agents/${AGENT_NAME}/revisions/${encodeURIComponent(hash)}/stats`,
		);
	}

	test("aggregates runs joined to sessions on prompt_hash", async () => {
		const response = await app.handle(new Request(statsUrl(HASH_WITH_COST)));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			runs: 2,
			totalTokens: 180,
			avgTokens: 90,
			cost: 0.3,
			failures: 1,
		});
	});

	test("cost is null when no run carries a cost estimate", async () => {
		const response = await app.handle(new Request(statsUrl(HASH_WITHOUT_COST)));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			runs: 1,
			totalTokens: 10,
			avgTokens: 10,
			cost: null,
			failures: 1,
		});
	});

	test("zero rows for a hash no session ran", async () => {
		const response = await app.handle(new Request(statsUrl("pk1-never-ran")));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			runs: 0,
			totalTokens: 0,
			avgTokens: 0,
			cost: null,
			failures: 0,
		});
	});

	test("404 for an unknown agent", async () => {
		const response = await app.handle(
			new Request(url("/kernel/catalog/agents/no-such-agent/revisions/pk1-x/stats")),
		);
		expect(response.status).toBe(404);
	});
});
