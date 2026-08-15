import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	listAgents,
	listAgentsDetailed,
	loadCatalog,
	resolveAgent,
	resolveAgentDetailed,
} from "./catalog";

const fixturesCatalog = fileURLToPath(
	new URL("../test-fixtures/catalog", import.meta.url),
);

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

/**
 * A project layer shadowing the generic state-echo: same name, different
 * description, no TS sidecars (a temp dir cannot resolve workspace imports).
 */
function makeShadowProject(): string {
	const projectDir = makeTempDir("tui-shadow-");
	const bundleDir = join(projectDir, "catalog", "state-echo");
	mkdirSync(join(projectDir, ".agent-kernel"), { recursive: true });
	mkdirSync(bundleDir, { recursive: true });

	writeFileSync(
		join(projectDir, ".agent-kernel", "kernel.json"),
		JSON.stringify({
			manifestVersion: 2,
			kernelId: "tui-shadow-test",
			catalogRoots: [join(projectDir, "catalog")],
		}),
	);
	const generic = JSON.parse(
		readFileSync(join(fixturesCatalog, "state-echo", "agent.json"), "utf8"),
	) as Record<string, unknown>;
	writeFileSync(
		join(bundleDir, "agent.json"),
		JSON.stringify({ ...generic, description: "PROJECT-SHADOWED state-echo" }),
	);
	writeFileSync(
		join(bundleDir, "prompt.json"),
		readFileSync(join(fixturesCatalog, "state-echo", "prompt.json"), "utf8"),
	);
	return projectDir;
}

describe("catalog resolution", () => {
	test("generic layer resolves when no project kernel.json is up-tree", async () => {
		const cwd = makeTempDir("tui-nokernel-");
		const resolved = await resolveAgent("state-echo", cwd, {
			genericRoot: fixturesCatalog,
		});
		expect(resolved).not.toBeNull();
		expect(resolved?.source).toBe("generic");
		expect(resolved?.def.manifest.description).toContain("TUI test fixture");
	});

	test("project bundle shadows the generic bundle by name", async () => {
		const projectDir = makeShadowProject();
		const resolved = await resolveAgent("state-echo", projectDir, {
			genericRoot: fixturesCatalog,
		});
		expect(resolved?.source).toBe("project");
		expect(resolved?.def.manifest.description).toBe("PROJECT-SHADOWED state-echo");

		// The list carries exactly one state-echo — the project one.
		const agents = await listAgents(projectDir, { genericRoot: fixturesCatalog });
		const matches = agents.filter((agent) => agent.name === "state-echo");
		expect(matches).toHaveLength(1);
		expect(matches[0].source).toBe("project");
	});

	test("kernel.json discovery walks up from a nested cwd", async () => {
		const projectDir = makeShadowProject();
		const nested = join(projectDir, "deep", "nested", "dir");
		mkdirSync(nested, { recursive: true });
		const resolved = await resolveAgent("state-echo", nested, {
			genericRoot: null,
		});
		expect(resolved?.source).toBe("project");
	});

	test("one broken bundle degrades per-bundle, not per-layer", async () => {
		const projectDir = makeTempDir("tui-isolate-");
		const catalogDir = join(projectDir, "catalog");
		mkdirSync(join(projectDir, ".agent-kernel"), { recursive: true });
		writeFileSync(
			join(projectDir, ".agent-kernel", "kernel.json"),
			JSON.stringify({ manifestVersion: 2, kernelId: "tui-isolate", catalogRoots: [catalogDir] }),
		);
		const promptJson = readFileSync(
			join(fixturesCatalog, "state-echo", "prompt.json"),
			"utf8",
		);
		// One loadable bundle…
		const goodDir = join(catalogDir, "plain-good");
		mkdirSync(goodDir, { recursive: true });
		writeFileSync(
			join(goodDir, "agent.json"),
			JSON.stringify({
				name: "plain-good",
				description: "loads fine",
				model: "mock/x",
				host: "any",
			}),
		);
		writeFileSync(join(goodDir, "prompt.json"), promptJson);
		// …one declared host:any whose sidecar import explodes anyway (the
		// isolation backstop; e.g. a bundle wrongly declared portable)…
		const brokenDir = join(catalogDir, "app-coupled");
		mkdirSync(join(brokenDir, "context"), { recursive: true });
		writeFileSync(
			join(brokenDir, "agent.json"),
			JSON.stringify({
				name: "app-coupled",
				description: "needs app runtime",
				model: "mock/x",
				host: "any",
			}),
		);
		writeFileSync(join(brokenDir, "prompt.json"), promptJson);
		writeFileSync(
			join(brokenDir, "context", "index.ts"),
			`throw new Error("Cannot find module 'bun:sqlite' (simulated app runtime import)\\nRequire stack:\\n- fake");\n`,
		);
		// …and one with no host field: default "app" — classified from the
		// manifest, sidecars never evaluated (it would throw if they were).
		const appDir = join(catalogDir, "app-default");
		mkdirSync(join(appDir, "context"), { recursive: true });
		writeFileSync(
			join(appDir, "agent.json"),
			JSON.stringify({ name: "app-default", description: "app-harness only", model: "mock/x" }),
		);
		writeFileSync(join(appDir, "prompt.json"), promptJson);
		writeFileSync(
			join(appDir, "context", "index.ts"),
			`throw new Error("classification must not evaluate this sidecar");\n`,
		);

		const { agents, appHosted, unavailable } = await listAgentsDetailed(projectDir, {
			genericRoot: null,
		});
		expect(agents.map((a) => a.name)).toEqual(["plain-good"]);
		expect(appHosted.map((b) => b.name)).toEqual(["app-default"]);
		expect(unavailable).toHaveLength(1);
		expect(unavailable[0].name).toBe("app-coupled");
		expect(unavailable[0].reason).toContain("app runtime (bun:sqlite)");
		expect(unavailable[0].reason).not.toContain("\n");

		const resolution = await resolveAgentDetailed("app-coupled", projectDir, {
			genericRoot: null,
		});
		expect(resolution.status).toBe("unavailable");
		const classified = await resolveAgentDetailed("app-default", projectDir, {
			genericRoot: null,
		});
		expect(classified.status).toBe("app-hosted");
		if (classified.status === "app-hosted") {
			expect(classified.reason).toContain("app-harness agent");
		}
		expect(
			await resolveAgent("plain-good", projectDir, { genericRoot: null }),
		).not.toBeNull();
	});

	test("missing generic root degrades to project-only, unknown names answer null", async () => {
		const projectDir = makeShadowProject();
		const catalog = await loadCatalog(projectDir, { genericRoot: null });
		expect(catalog.layers).toHaveLength(1);
		expect(catalog.layers[0].source).toBe("project");
		expect(
			await resolveAgent("does-not-exist", projectDir, { genericRoot: null }),
		).toBeNull();
	});
});
