import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createPromptKitKernelHarness,
	type PromptKitKernelHarness,
} from "../src/app";

const temporaryDirectories: string[] = [];
const openHarnesses: PromptKitKernelHarness[] = [];

async function makeHarness(): Promise<PromptKitKernelHarness> {
	const rootDir = mkdtempSync(join(tmpdir(), "prompt-kit-kernel-test-"));
	temporaryDirectories.push(rootDir);
	const harness = await createPromptKitKernelHarness({
		rootDir,
		readApiBaseUrl: "http://127.0.0.1:4850",
	});
	openHarnesses.push(harness);
	return harness;
}

afterEach(async () => {
	for (const harness of openHarnesses.splice(0)) await harness.dispose();
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function request(path: string): Request {
	return new Request(`http://prompt-kit-kernel.test${path}`);
}

function jsonRequest(path: string, body: unknown): Request {
	return new Request(`http://prompt-kit-kernel.test${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("Prompt Kit kernel harness", () => {
	test("boots the prompt-editor catalog and mounts viewer, session, annotation, trace, and liveness routes", async () => {
		const harness = await makeHarness();
		const registry = await harness.boot.kernel.registry();

		expect(registry.tryGet("prompt-editor")).not.toBeNull();

		const catalog = await harness.app.handle(
			request("/kernel/catalog/agents"),
		);
		expect(catalog.status).toBe(200);
		const catalogBody = (await catalog.json()) as {
			agents: Array<{ name: string }>;
		};
		expect(catalogBody.agents.map((agent) => agent.name)).toEqual([
			"prompt-editor",
		]);

		const editorDetail = await harness.app.handle(
			request("/kernel/catalog/agents/prompt-editor"),
		);
		expect(editorDetail.status).toBe(200);
		const editorBody = (await editorDetail.json()) as {
			manifest: { name: string };
			prompt: { kind: string };
			modelAliases: string[];
		};
		expect(editorBody.manifest.name).toBe("prompt-editor");
		expect(editorBody.prompt.kind).toBe("prompt");
		expect(editorBody.modelAliases).toContain("prompt-editor");

		const headlessSession = await harness.app.handle(
			jsonRequest("/kernel/catalog/agents/prompt-editor/edit-sessions", {
				spawn: false,
				sessionId: "headless-session",
			}),
		);
		expect(headlessSession.status).toBe(201);
		expect(await headlessSession.json()).toMatchObject({
			state: {
				sessionId: "headless-session",
				targetAgent: "prompt-editor",
				agent: { spawned: false },
			},
		});

		const fakeSession = await harness.app.handle(
			request("/kernel/prompt-edit-sessions/not-a-session"),
		);
		expect(fakeSession.status).toBe(404);
		expect(await fakeSession.json()).toEqual({
			error: "Prompt-edit session not-a-session not found",
		});

		const annotations = await harness.app.handle(
			request("/kernel/catalog/agents/prompt-editor/annotations"),
		);
		expect(annotations.status).toBe(200);

		const traces = await harness.app.handle(
			request("/kernel/trace-sessions"),
		);
		expect(traces.status).toBe(200);

		const health = await harness.app.handle(request("/health"));
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({
			status: "ok",
			kernel: "prompt-kit-kernel",
		});
	});
});
