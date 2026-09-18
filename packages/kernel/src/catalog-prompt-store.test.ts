import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { createPromptStore } from "@codecaine-ai/prompt-kit-server";

import { buildRegistry, registerPromptRevisions, type AgentRegistry } from "./agent-registry";
import {
	createKernelCatalogService,
	RENDERED_SNAPSHOT_HEADER,
	type KernelCatalogService,
} from "./catalog-service";

const AGENT = "shared-store-agent";

function prompt(text: string): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: "shared-store-prompt",
		nodes: [{ type: "paragraph", id: "body", content: [text] }],
	} as PromptDocument;
}

let temp: string;
let catalogRoot: string;
let agentDir: string;
let handle: KernelDatabaseHandle;
let registry: AgentRegistry;
let service: KernelCatalogService;
let initial: PromptDocument;

beforeEach(async () => {
	temp = mkdtempSync(join(tmpdir(), "kernel-shared-prompt-store-"));
	catalogRoot = join(temp, "catalog");
	agentDir = join(catalogRoot, AGENT);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		`${JSON.stringify({
			$schema: "agent-kernel/agent-v1",
			name: AGENT,
			description: "Shared store fixture.",
			model: "test-model",
			variables: { focus: { default: "" } },
		}, null, "\t")}\n`,
	);
	initial = prompt("Initial prompt.");
	writeFileSync(join(agentDir, "prompt.json"), canonicalizePrompt(initial));

	handle = openKernelDatabase({ path: kernelDatabasePath(temp) });
	await ensureKernelObservabilitySchema(handle.db);
	registry = await buildRegistry({ roots: [catalogRoot] });
	await registerPromptRevisions(handle.db, registry);
	service = createKernelCatalogService({
		registry: async () => registry,
		db: () => handle.db,
		allowWrites: true,
	});
});

afterEach(() => {
	handle.close();
	rmSync(temp, { recursive: true, force: true });
});

describe("Kernel catalog shared prompt store", () => {
	test("simultaneous MCP and UI saves serialize with one stale conflict", async () => {
		const expectedHash = hashPrompt(initial);
		const uiDocument = prompt("Saved from Prompt Lab.");
		const mcpDocument = prompt("Saved from MCP.");
		const external = createPromptStore({ root: catalogRoot });

		const [ui, mcp] = await Promise.all([
			service.savePrompt(AGENT, uiDocument, expectedHash),
			external.save(
				{
					promptPath: `${AGENT}/prompt.json`,
					renderedPath: `${AGENT}/prompt.rendered.md`,
					renderedHeader: RENDERED_SNAPSHOT_HEADER,
				},
				{ document: mcpDocument, expectedHash, source: "mcp" },
			),
		]);

		const uiWon = ui !== null && ui.ok;
		const mcpWon = mcp.ok;
		expect(Number(uiWon) + Number(mcpWon)).toBe(1);
		if (!uiWon) {
			expect(ui).toEqual({ ok: false, currentHash: hashPrompt(mcpDocument) });
		}
		if (!mcpWon) {
			expect(mcp.code).toBe("conflict");
			expect(mcp.currentHash).toBe(hashPrompt(uiDocument));
		}

		const winner = uiWon ? uiDocument : mcpDocument;
		expect(readFileSync(join(agentDir, "prompt.json"), "utf8")).toBe(
			canonicalizePrompt(winner),
		);
		const rendered = readFileSync(join(agentDir, "prompt.rendered.md"), "utf8");
		expect(rendered.startsWith(RENDERED_SNAPSHOT_HEADER)).toBe(true);
		expect(rendered).toContain(uiWon ? "Saved from Prompt Lab." : "Saved from MCP.");

		// The normal detail sync observes an MCP winner and records it before the
		// next spawn; a UI winner was already hot-swapped and recorded directly.
		const detail = await service.getAgentDetail(AGENT);
		expect(detail?.promptHash).toBe(hashPrompt(winner));
		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT);
		expect(revisions.some((revision) => revision.hash === hashPrompt(winner))).toBe(true);
	});

	test("Kernel validation still rejects undeclared raw template variables", async () => {
		const invalid = prompt("Use {{missing_variable}}.");
		const result = await service.savePrompt(AGENT, invalid, hashPrompt(initial));

		expect(result?.ok).toBe(false);
		if (result && !result.ok && "errors" in result) {
			expect(result.errors.join("\n")).toContain("missing_variable");
		}
		expect(readFileSync(join(agentDir, "prompt.json"), "utf8")).toBe(
			canonicalizePrompt(initial),
		);
	});

	test("disk sync records Prompt Kit MCP provenance from the shared journal", async () => {
		const edited = prompt("Saved externally with MCP provenance.");
		const external = createPromptStore({ root: catalogRoot });
		const saved = await external.save(
			{
				promptPath: `${AGENT}/prompt.json`,
				renderedPath: `${AGENT}/prompt.rendered.md`,
				renderedHeader: RENDERED_SNAPSHOT_HEADER,
			},
			{
				document: edited,
				expectedHash: hashPrompt(initial),
				source: "prompt-kit-mcp",
			},
		);
		expect(saved.ok).toBe(true);

		const detail = await service.getAgentDetail(AGENT);
		expect(detail?.promptHash).toBe(hashPrompt(edited));
		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT);
		expect(
			revisions.some(
				(revision) =>
					revision.hash === hashPrompt(edited) &&
					revision.source === "prompt-kit-mcp",
			),
		).toBe(true);
	});

	test("reports a committed save when database revision recording fails", async () => {
		let databaseAvailable = false;
		const dbFailure = createKernelCatalogService({
			registry: async () => registry,
			db: () => {
				if (!databaseAvailable) throw new Error("database unavailable");
				return handle.db;
			},
			allowWrites: true,
		});
		const edited = prompt("Canonical file commits before database recording.");

		const result = await dbFailure.savePrompt(AGENT, edited, hashPrompt(initial));

		expect(result).toMatchObject({
			ok: false,
			committed: true,
			hash: hashPrompt(edited),
		});
		if (result && !result.ok && "errors" in result) {
			expect(result.errors.join("\n")).toContain("database unavailable");
		}
		expect(readFileSync(join(agentDir, "prompt.json"), "utf8")).toBe(
			canonicalizePrompt(edited),
		);
		expect(registry.get(AGENT).promptHash).toBe(hashPrompt(edited));

		databaseAvailable = true;
		await dbFailure.listRevisions(AGENT);
		const revisions = await listPromptRevisionsForAgent(handle.db, AGENT);
		expect(
			revisions.some(
				(revision) =>
					revision.hash === hashPrompt(edited) && revision.source === "lab-save",
			),
		).toBe(true);
	});
});
