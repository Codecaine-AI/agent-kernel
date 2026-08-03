/**
 * Route-level tests for the catalog annotation endpoints: a real registry
 * over a temp agent-catalog directory + a temp SQLite kernel db, exercised
 * through Elysia's .handle(new Request(...)) like the catalog API tests.
 * The app under test is createKernelCatalogApi — proving the annotation
 * routes ride in through its one-line .use() wiring.
 *
 * Fixture carries two agents: a file-form bundle (prompt.json at the root)
 * and a folder-form bundle (prompt/prompt.json) — the sidecar must land at
 * the bundle ROOT in both.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	ensureKernelObservabilitySchema,
	kernelDatabasePath,
	openKernelDatabase,
	type KernelDatabaseHandle,
} from "@agent-kernel/db";
import {
	canonicalizePrompt,
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
	type KernelCatalogService,
} from "./catalog-service";

const FILE_AGENT = "annotations-file-agent";
const FOLDER_AGENT = "annotations-folder-agent";

function makePromptDocument(docId: string, paragraphs: string[]): PromptDocument {
	return {
		kind: "prompt",
		schemaVersion: PROMPT_KIT_SCHEMA_VERSION,
		id: docId,
		title: "Annotations Test",
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

function makeManifest(name: string) {
	return {
		$schema: "agent-kernel/agent-v1",
		name,
		description: `Fixture agent ${name}.`,
		model: "test-model-alias",
		variables: {},
	};
}

let dir: string;
let catalogRoot: string;
let fileAgentDir: string;
let folderAgentDir: string;
let handle: KernelDatabaseHandle;
let registry: AgentRegistry;
let service: KernelCatalogService;
let app: ReturnType<typeof createKernelCatalogApi>;

const FILE_DOC_ID = "annotations-file-prompt";
const FOLDER_DOC_ID = "annotations-folder-prompt";

const nodeTarget = { kind: "prompt-node", docId: FILE_DOC_ID, nodeId: "para-0" };

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "agent-kernel-annotations-api-test-"));
	catalogRoot = join(dir, "agent-catalog");

	// File-form bundle: prompt.json at the bundle root.
	fileAgentDir = join(catalogRoot, FILE_AGENT);
	mkdirSync(fileAgentDir, { recursive: true });
	writeFileSync(
		join(fileAgentDir, "agent.json"),
		`${JSON.stringify(makeManifest(FILE_AGENT), null, "\t")}\n`,
		"utf8",
	);
	writeFileSync(
		join(fileAgentDir, "prompt.json"),
		canonicalizePrompt(makePromptDocument(FILE_DOC_ID, ["You are the file-form agent."])),
		"utf8",
	);

	// Folder-form bundle: prompt/prompt.json.
	folderAgentDir = join(catalogRoot, FOLDER_AGENT);
	mkdirSync(join(folderAgentDir, "prompt"), { recursive: true });
	writeFileSync(
		join(folderAgentDir, "agent.json"),
		`${JSON.stringify(makeManifest(FOLDER_AGENT), null, "\t")}\n`,
		"utf8",
	);
	writeFileSync(
		join(folderAgentDir, "prompt", "prompt.json"),
		canonicalizePrompt(
			makePromptDocument(FOLDER_DOC_ID, ["You are the folder-form agent."]),
		),
		"utf8",
	);

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

function annotationsUrl(agent: string, suffix = ""): string {
	return url(`/kernel/catalog/agents/${agent}/annotations${suffix}`);
}

function getAnnotations(agent: string) {
	return app.handle(new Request(annotationsUrl(agent)));
}

function post(agent: string, suffix: string, body: unknown) {
	return app.handle(
		new Request(annotationsUrl(agent, suffix), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

async function addAnnotation(agent = FILE_AGENT, overrides: Record<string, unknown> = {}) {
	const response = await post(agent, "", {
		target: nodeTarget,
		body: "Tighten this paragraph.",
		intent: "agent-request",
		author: "ford",
		...overrides,
	});
	return { response, body: await response.json() };
}

describe("GET .../annotations", () => {
	test("empty state: no sidecar yet answers an empty document with a null hash", async () => {
		const response = await getAnnotations(FILE_AGENT);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			annotations: { schemaVersion: 1, annotations: [] },
			hash: null,
			dangling: [],
		});
	});

	test("404 for an unknown agent", async () => {
		const response = await getAnnotations("no-such-agent");
		expect(response.status).toBe(404);
	});
});

describe("POST .../annotations (add)", () => {
	test("adds and round-trips; the sidecar lands at the bundle root", async () => {
		const { response, body } = await addAnnotation();
		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.annotation.status).toBe("open");
		expect(typeof body.hash).toBe("string");

		expect(existsSync(join(fileAgentDir, "annotations.json"))).toBe(true);

		const listed = await (await getAnnotations(FILE_AGENT)).json();
		expect(listed.annotations.annotations).toHaveLength(1);
		expect(listed.annotations.annotations[0].id).toBe(body.annotation.id);
		expect(listed.hash).toBe(body.hash);
	});

	test("folder-form bundle: sidecar at the bundle ROOT, not inside prompt/", async () => {
		const { response } = await addAnnotation(FOLDER_AGENT, {
			target: { kind: "prompt-node", docId: FOLDER_DOC_ID, nodeId: "para-0" },
		});
		expect(response.status).toBe(200);
		expect(existsSync(join(folderAgentDir, "annotations.json"))).toBe(true);
		expect(existsSync(join(folderAgentDir, "prompt", "annotations.json"))).toBe(false);
	});

	test("409 + currentHash on a stale expectedHash", async () => {
		const first = await addAnnotation();
		const { response, body } = await addAnnotation(FILE_AGENT, {
			expectedHash: "0".repeat(64),
		});
		expect(response.status).toBe(409);
		expect(body.currentHash).toBe(first.body.hash);
	});

	test("400 when the target does not resolve on the current prompt", async () => {
		const { response, body } = await addAnnotation(FILE_AGENT, {
			target: { ...nodeTarget, nodeId: "para-99" },
		});
		expect(response.status).toBe(400);
		expect(body.errors.join("; ")).toContain('Node "para-99" no longer exists.');
	});

	test("400 on missing fields", async () => {
		const response = await post(FILE_AGENT, "", { target: nodeTarget });
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.errors.length).toBeGreaterThan(0);
	});

	test("404 for an unknown agent", async () => {
		const { response } = await addAnnotation("no-such-agent");
		expect(response.status).toBe(404);
	});
});

describe("POST .../annotations/:id/replies", () => {
	test("appends a reply to the thread", async () => {
		const { body: added } = await addAnnotation();
		const response = await post(FILE_AGENT, `/${added.annotation.id}/replies`, {
			author: "agent",
			body: "Shorter or more specific?",
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.annotation.replies).toHaveLength(1);
		expect(body.annotation.replies[0].author).toBe("agent");
	});

	test("404 for an unknown annotation id", async () => {
		const response = await post(FILE_AGENT, "/missing-id/replies", {
			author: "ford",
			body: "hello?",
		});
		expect(response.status).toBe(404);
	});
});

describe("POST .../annotations/:id/resolve", () => {
	test("resolves with an optional note", async () => {
		const { body: added } = await addAnnotation();
		const response = await post(FILE_AGENT, `/${added.annotation.id}/resolve`, {
			resolution: "Handled by hand.",
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.annotation.status).toBe("resolved");
		expect(body.annotation.resolution).toBe("Handled by hand.");
	});

	test("re-opens via status: open", async () => {
		const { body: added } = await addAnnotation();
		await post(FILE_AGENT, `/${added.annotation.id}/resolve`, {});
		const response = await post(FILE_AGENT, `/${added.annotation.id}/resolve`, {
			status: "open",
		});
		expect(response.status).toBe(200);
		expect((await response.json()).annotation.status).toBe("open");
	});
});

describe("POST .../annotations/:id/agent-run", () => {
	test("attaches the run record and resolves the annotation", async () => {
		const { body: added } = await addAnnotation();
		const response = await post(FILE_AGENT, `/${added.annotation.id}/agent-run`, {
			sessionId: "sess-1",
			patchId: "patch-1",
			summary: "Shortened para-0.",
			changedIds: ["para-0"],
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.annotation.status).toBe("resolved");
		expect(body.annotation.agentRun).toEqual({
			sessionId: "sess-1",
			patchId: "patch-1",
			summary: "Shortened para-0.",
			changedIds: ["para-0"],
		});
	});

	test("400 on a malformed run payload", async () => {
		const { body: added } = await addAnnotation();
		const response = await post(FILE_AGENT, `/${added.annotation.id}/agent-run`, {
			sessionId: "sess-1",
		});
		expect(response.status).toBe(400);
	});
});

describe("DELETE .../annotations/:id", () => {
	test("removes the annotation; a second delete answers 404", async () => {
		const { body: added } = await addAnnotation();
		const remove = () =>
			app.handle(
				new Request(annotationsUrl(FILE_AGENT, `/${added.annotation.id}`), {
					method: "DELETE",
				}),
			);
		const first = await remove();
		expect(first.status).toBe(200);
		expect((await first.json()).annotations.annotations).toHaveLength(0);

		const second = await remove();
		expect(second.status).toBe(404);
	});

	test("409 on a stale expectedHash query parameter", async () => {
		const { body: added } = await addAnnotation();
		const response = await app.handle(
			new Request(
				annotationsUrl(
					FILE_AGENT,
					`/${added.annotation.id}?expectedHash=${"0".repeat(64)}`,
				),
				{ method: "DELETE" },
			),
		);
		expect(response.status).toBe(409);
		expect((await response.json()).currentHash).toBe(added.hash);
	});
});

describe("POST .../annotations/prune (live-only semantics)", () => {
	test("drops resolved entries, keeps open ones", async () => {
		const { body: keep } = await addAnnotation(FILE_AGENT, { body: "still open" });
		const { body: drop } = await addAnnotation(FILE_AGENT, { body: "done" });
		await post(FILE_AGENT, `/${drop.annotation.id}/resolve`, {});

		const response = await post(FILE_AGENT, "/prune", {});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.removed).toBe(1);
		expect(body.annotations.annotations.map((a: { id: string }) => a.id)).toEqual([
			keep.annotation.id,
		]);
	});
});

describe("write gating (read-only kernel)", () => {
	test("mutations answer 403 while GET keeps working", async () => {
		const readOnlyService = createKernelCatalogService({
			registry: async () => registry,
			db: () => handle.db,
		});
		const readOnlyApp = createKernelCatalogApi(readOnlyService);

		const get = await readOnlyApp.handle(new Request(annotationsUrl(FILE_AGENT)));
		expect(get.status).toBe(200);

		const add = await readOnlyApp.handle(
			new Request(annotationsUrl(FILE_AGENT), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					target: nodeTarget,
					body: "nope",
					intent: "note",
					author: "ford",
				}),
			}),
		);
		expect(add.status).toBe(403);

		const remove = await readOnlyApp.handle(
			new Request(annotationsUrl(FILE_AGENT, "/some-id"), { method: "DELETE" }),
		);
		expect(remove.status).toBe(403);
	});
});
