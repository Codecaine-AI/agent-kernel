import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	getPromptRevision,
	openKernelDatabase,
} from "@agent-kernel/db";

import { createKernel, DEFAULT_MAX_BACKGROUND_AGENTS } from ".";

function makePromptJson(id: string): string {
	return JSON.stringify({
		kind: "prompt",
		schemaVersion: "prompt-kit/v1",
		id,
		nodes: [
			{
				type: "section",
				tag: "task",
				children: [{ type: "paragraph", content: ["Do the thing."] }],
			},
		],
	});
}

const PROMPT_JSON = makePromptJson("kernelTestPrompt");

function writeCatalog(
	root: string,
	manifest: Record<string, unknown>,
	promptJson = PROMPT_JSON,
): void {
	const agentDir = join(root, String(manifest.name));
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "agent.json"), JSON.stringify(manifest));
	writeFileSync(join(agentDir, "prompt.json"), promptJson);
}

describe("createKernel", () => {
	test("defaults concurrency and owns per-instance background limits", () => {
		const kernel = createKernel();
		try {
			expect(kernel.concurrency.maxBackgroundAgents).toBe(
				DEFAULT_MAX_BACKGROUND_AGENTS,
			);
			expect(kernel.agentManager.getMaxConcurrent()).toBe(
				DEFAULT_MAX_BACKGROUND_AGENTS,
			);
			kernel.setMaxBackgroundAgents(3);
			expect(kernel.concurrency.maxBackgroundAgents).toBe(3);
			expect(kernel.agentManager.getMaxConcurrent()).toBe(3);
		} finally {
			kernel.dispose();
		}
	});

	test("container() without a configured db throws a clear error", async () => {
		const kernel = createKernel();
		try {
			await expect(
				kernel.container({ kind: "session", key: ["req-1"] }),
			).rejects.toThrow("requires a database");
		} finally {
			kernel.dispose();
		}
	});

	test("traceWriter / readApiService / doctor without a db throw clear errors", async () => {
		const kernel = createKernel();
		try {
			expect(() => kernel.traceWriter).toThrow("requires a database");
			expect(() => kernel.readApiService).toThrow("requires a database");
			await expect(kernel.doctor()).rejects.toThrow("requires a database");
		} finally {
			kernel.dispose();
		}
	});

	test("spawnAgent without catalog roots throws a clear error", async () => {
		const kernel = createKernel();
		try {
			await expect(kernel.spawnAgent("anything", "hi")).rejects.toThrow(
				"catalog",
			);
		} finally {
			kernel.dispose();
		}
	});

	test("registry() builds from catalog roots and registers prompt revisions", async () => {
		const root = mkdtempSync(join(import.meta.dir, ".kernel-test-"));
		const handle = openKernelDatabase({ path: join(root, "trace.db") });
		const kernel = createKernel({
			id: "kernel-test",
			db: handle.db,
			catalog: { roots: [join(root, "catalog")] },
			toolProfiles: { reader: ["read", "glob"] },
		});
		try {
			await ensureKernelObservabilitySchema(handle.db);
			writeCatalog(join(root, "catalog"), {
				name: "worker",
				description: "test worker",
				model: "test/model",
				toolProfiles: ["reader"],
			});

			const registry = await kernel.registry();
			const def = registry.get("worker");
			expect(def.parsed.config.tools).toEqual(["read", "glob"]);

			// Prompt revision registered at registry build.
			const revision = await getPromptRevision(handle.db, def.promptHash);
			expect(revision?.agentName).toBe("worker");

			// Cached: same instance on the second call.
			expect(await kernel.registry()).toBe(registry);
		} finally {
			kernel.dispose();
			handle.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("unlisted roots stay detail-fetchable and spawn-resolvable but are not listed", async () => {
		const root = mkdtempSync(join(import.meta.dir, ".kernel-test-"));
		const handle = openKernelDatabase({ path: join(root, "trace.db") });
		const listedRoot = join(root, "listed-catalog");
		const unlistedRoot = join(root, "unlisted-catalog");
		const kernel = createKernel({
			id: "kernel-test",
			db: handle.db,
			catalog: {
				roots: [listedRoot, { path: unlistedRoot, listed: false }],
			},
		});
		try {
			await ensureKernelObservabilitySchema(handle.db);
			writeCatalog(listedRoot, {
				name: "listed-worker",
				description: "listed test worker",
				model: "test/model",
			});
			writeCatalog(
				unlistedRoot,
				{
					name: "unlisted-worker",
					description: "unlisted test worker",
					model: "test/model",
				},
				makePromptJson("unlistedKernelTestPrompt"),
			);

			const registry = await kernel.registry();
			expect(registry.list().map((def) => def.name)).toEqual(["listed-worker"]);
			expect(registry.listAll().map((def) => def.name)).toEqual([
				"listed-worker",
				"unlisted-worker",
			]);
			const unlistedRevision = await getPromptRevision(
				handle.db,
				registry.get("unlisted-worker").promptHash,
			);
			expect(unlistedRevision?.agentName).toBe("unlisted-worker");

			const catalog = kernel.catalogApiService();
			expect((await catalog.listAgents()).map((agent) => agent.name)).toEqual([
				"listed-worker",
			]);
			expect((await catalog.getAgentDetail("unlisted-worker"))?.manifest.name).toBe(
				"unlisted-worker",
			);

			// An agent-specific variant error proves the unlisted name reached the
			// spawn config resolver; it fails before any model session is created.
			await expect(
				kernel.spawnAgent("unlisted-worker", "hi", null, {
					variant: "intentionally-missing",
					workingDir: root,
					containerId: "c-unlisted",
				}),
			).rejects.toThrow(
				'Unknown variant "intentionally-missing" for agent "unlisted-worker"',
			);
		} finally {
			kernel.dispose();
			handle.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("spawnAgent rejects unknown variants before creating any session", async () => {
		const root = mkdtempSync(join(import.meta.dir, ".kernel-test-"));
		const handle = openKernelDatabase({ path: join(root, "trace.db") });
		const kernel = createKernel({
			id: "kernel-test",
			db: handle.db,
			catalog: { roots: [join(root, "catalog")] },
		});
		try {
			await ensureKernelObservabilitySchema(handle.db);
			writeCatalog(join(root, "catalog"), {
				name: "worker",
				description: "test worker",
				model: "test/model",
				variants: { deep: { thinking: "high" } },
			});

			await expect(
				kernel.spawnAgent("worker", "hi", null, {
					variant: "nope",
					workingDir: root,
					containerId: "c-1",
				}),
			).rejects.toThrow('Unknown variant "nope" for agent "worker"');
		} finally {
			kernel.dispose();
			handle.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("registry boot error surfaces unknown tool profiles", async () => {
		const root = mkdtempSync(join(import.meta.dir, ".kernel-test-"));
		const kernel = createKernel({
			catalog: { roots: [join(root, "catalog")] },
			toolProfiles: { reader: ["read"] },
		});
		try {
			writeCatalog(join(root, "catalog"), {
				name: "worker",
				description: "test worker",
				model: "test/model",
				toolProfiles: ["writer"],
			});

			await expect(kernel.registry()).rejects.toThrow(
				"Agent registry validation failed",
			);
		} finally {
			kernel.dispose();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
