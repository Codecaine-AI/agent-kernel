import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import {
	ensureKernelObservabilitySchema,
	openKernelDatabase,
} from "@agent-kernel/db";
import { canonicalizePrompt, hashPrompt } from "@codecaine-ai/prompt-kit";

import { registerPromptRevisions } from "../register-prompt-revisions";
import { buildRegistry } from "./registry";

const PROMPT_DOCUMENT = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "manifestAgentPrompt",
	nodes: [
		{
			type: "section",
			tag: "request",
			children: [
				{
					type: "paragraph",
					content: ["Request: ", { type: "variable", name: "userPrompt" }],
				},
			],
		},
	],
};

const CONTEXT_TS = `import { defineContext } from "@agent-kernel/kernel/agent-definition";

export const context = defineContext({
  loaders: [],
  assemble() {
    return "<manifest_context />";
  }
});
`;

const TOOLS_TS = `import { defineTools } from "@agent-kernel/kernel/agent-definition";

export const tools = defineTools((pi) => {
  pi.registerTool({
    name: "custom_tool",
    label: "Custom tool",
    description: "A private manifest-agent tool.",
    parameters: {},
    execute: async () => ({ content: [{ type: "text", text: "ok" }] })
  });
});
`;

function spawnerToolsTs(spawns: string[]): string {
	return `import { defineSpawnerTool, defineTools } from "@agent-kernel/kernel/agent-definition";

export const tools = defineTools((pi) => {
  pi.registerTool(defineSpawnerTool({
    name: "spawn_helper",
    label: "Spawn helper",
    description: "Dispatch helper agents.",
    parameters: {},
    spawns: ${JSON.stringify(spawns)},
    execute: async (_id, _params, { dispatch }) => {
      await dispatch(${JSON.stringify(spawns[0])}, "go");
      return { content: [{ type: "text", text: "ok" }] };
    }
  }));
});
`;
}

const AGENT_MANIFEST = {
	$schema: "agent-kernel/agent-v1",
	name: "manifest-agent",
	description: "Manifest registry test agent.",
	model: "test/model",
	coreTools: ["read"],
	variables: {
		userPrompt: {
			default: "hello",
			description: "User request.",
		},
	},
	variants: {
		deep: { model: "test/model-deep", maxTurns: 24, displayLabel: "Deep" },
	},
};

function writeAgentDir(
	agentDir: string,
	opts: {
		promptJson?: string | null;
		manifest?: Record<string, unknown>;
		manifestRaw?: string;
		toolsTs?: string;
	} = {},
): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "context.ts"), CONTEXT_TS);
	writeFileSync(join(agentDir, "tools.ts"), opts.toolsTs ?? TOOLS_TS);
	writeFileSync(
		join(agentDir, "agent.json"),
		opts.manifestRaw ??
			`${JSON.stringify(opts.manifest ?? AGENT_MANIFEST, null, 2)}\n`,
	);
	if (opts.promptJson !== null) {
		writeFileSync(
			join(agentDir, "prompt.json"),
			opts.promptJson ?? `${JSON.stringify(PROMPT_DOCUMENT, null, 2)}\n`,
		);
	}
}

function tempRoot(): string {
	return mkdtempSync(join(import.meta.dir, ".manifest-agent-registry-"));
}

/** Registry boot failures aggregate per-agent RegistryErrors. */
async function expectBootFailure(
	root: string,
	pattern: RegExp,
	toolProfiles?: Record<string, string[]>,
): Promise<void> {
	try {
		await buildRegistry({ roots: [root], toolProfiles });
	} catch (err) {
		expect(err).toBeInstanceOf(AggregateError);
		const messages = (err as AggregateError).errors
			.map((e: unknown) => (e instanceof Error ? e.message : String(e)))
			.join("\n");
		expect(messages).toMatch(pattern);
		return;
	}
	throw new Error("expected buildRegistry to fail");
}

describe("manifest agent registry (agent.json)", () => {
	test("loads agent.json + sibling prompt.json and attaches context/tools sidecars by filename", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"));

			const registry = await buildRegistry({ roots: [root] });
			const agent = registry.get("manifest-agent");

			expect(agent.manifestFile.endsWith("agent.json")).toBe(true);
			expect(agent.promptFile.endsWith("prompt.json")).toBe(true);
			expect(agent.manifest.name).toBe("manifest-agent");
			expect(agent.manifest.variants.deep?.model).toBe("test/model-deep");
			expect(agent.parsed.body).toContain("<request>");
			expect(agent.parsed.body).toContain("{{userPrompt}}");
			expect(agent.parsed.config.tools).toEqual(["read", "custom_tool"]);
			expect(agent.parsed.config.model).toBe("test/model");
			expect(agent.coreTools).toEqual(["read"]);
			expect(agent.privateToolNames).toEqual(["custom_tool"]);
			expect(agent.contextResolver).toBeTruthy();
			const renderedContext = await agent.contextResolver?.assemble([], {
				agentName: "manifest-agent",
				variables: {},
				caller: { kind: "user", id: "test" },
				runtime: { cwd: root },
				paths: { workingDir: root, activeSessionDir: root },
			});
			expect(renderedContext).toBe("<manifest_context />");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("computes a stable content hash and exposes the loaded document", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"));

			const registry = await buildRegistry({ roots: [root] });
			const agent = registry.get("manifest-agent");

			expect(agent.promptHash).toStartWith("pk1-");
			expect(agent.parsed.promptHash).toBe(agent.promptHash);
			expect(agent.promptDocument).toBeTruthy();
			// The hash is derived from the canonical form of the loaded document.
			expect(hashPrompt(agent.promptDocument)).toBe(agent.promptHash);
			// Canonicalization is idempotent over the canonical file content.
			const canonical = canonicalizePrompt(agent.promptDocument);
			expect(canonicalizePrompt(JSON.parse(canonical))).toBe(canonical);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("expands manifest toolProfiles from the configured profile map", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				manifest: { ...AGENT_MANIFEST, toolProfiles: ["reader"] },
			});

			const registry = await buildRegistry({
				roots: [root],
				toolProfiles: { reader: ["glob", "grep", "read"] },
			});
			const agent = registry.get("manifest-agent");
			// coreTools + profile tools + private tools, deduped.
			expect(agent.parsed.config.tools).toEqual([
				"read",
				"glob",
				"grep",
				"custom_tool",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails on an unknown tool profile", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				manifest: { ...AGENT_MANIFEST, toolProfiles: ["nonexistent"] },
			});

			await expectBootFailure(root, /unknown tool profile "nonexistent"/, {
				reader: ["read"],
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails when agent.json is missing required fields", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				manifest: { name: "manifest-agent", description: "no model" },
			});

			await expectBootFailure(root, /manifest\.model: expected a non-empty string/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("harvests spawner declarations (D77) alongside private tool names", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				toolsTs: spawnerToolsTs(["manifest-agent"]),
			});

			const registry = await buildRegistry({ roots: [root] });
			const agent = registry.get("manifest-agent");
			expect(agent.privateToolNames).toEqual(["spawn_helper"]);
			expect(agent.spawnerTools).toEqual({ spawn_helper: ["manifest-agent"] });
			// The harvested map rides on the runtime config for the emitter/APIs.
			expect(agent.parsed.config.spawnerTools).toEqual({
				spawn_helper: ["manifest-agent"],
			});
			expect(agent.parsed.config.tools).toContain("spawn_helper");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails when a spawner tool targets an agent missing from the catalog", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				toolsTs: spawnerToolsTs(["ghost-agent"]),
			});

			await expectBootFailure(
				root,
				/spawner tool "spawn_helper" targets unknown agent "ghost-agent" — catalog agents: manifest-agent/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('spawns: ["*"] passes boot validation (deliberate general spawner)', async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				toolsTs: spawnerToolsTs(["*"]),
			});

			const registry = await buildRegistry({ roots: [root] });
			expect(registry.get("manifest-agent").spawnerTools).toEqual({
				spawn_helper: ["*"],
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot rejects the retired canSpawnSubagent manifest field (closed schema)", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				manifest: { ...AGENT_MANIFEST, canSpawnSubagent: true },
			});

			await expectBootFailure(root, /manifest\.canSpawnSubagent: unknown field/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails on unknown manifest fields (schema is closed)", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				manifest: { ...AGENT_MANIFEST, max_turns: 5 },
			});

			await expectBootFailure(root, /manifest\.max_turns: unknown field/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails when agent.json is not valid JSON", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				manifestRaw: "{ not json",
			});

			await expectBootFailure(root, /invalid agent\.json \(parse error\)/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails with a clear error when prompt.json is missing", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), { promptJson: null });

			await expectBootFailure(root, /missing prompt\.json/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails when prompt.json is not valid JSON", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				promptJson: "{ not json",
			});

			await expectBootFailure(root, /invalid prompt\.json \(parse error\)/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails when prompt.json fails the PromptDocument shape check", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "manifest-agent"), {
				promptJson: `${JSON.stringify({ kind: "prompt", nodes: [] })}\n`,
			});

			await expectBootFailure(root, /invalid prompt\.json/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails when prompt.json references undeclared variables", async () => {
		const root = tempRoot();
		try {
			const doc = {
				...PROMPT_DOCUMENT,
				nodes: [
					{
						type: "section",
						tag: "request",
						children: [
							{
								type: "paragraph",
								content: [
									"Request: ",
									{ type: "variable", name: "notDeclared" },
								],
							},
						],
					},
				],
			};
			writeAgentDir(join(root, "manifest-agent"), {
				promptJson: `${JSON.stringify(doc, null, 2)}\n`,
			});

			await expectBootFailure(root, /notDeclared/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reloadAgentManifest hot-swaps model/description keeping prompt + tool bindings", async () => {
		const root = tempRoot();
		try {
			const agentDir = join(root, "manifest-agent");
			writeAgentDir(agentDir);

			const registry = await buildRegistry({ roots: [root] });
			const before = registry.get("manifest-agent");
			expect(before.manifest.model).toBe("test/model");

			// Edit the manifest on disk (model + description), then hot-reload.
			writeFileSync(
				join(agentDir, "agent.json"),
				`${JSON.stringify({ ...AGENT_MANIFEST, model: "test/model-edited", description: "Edited." }, null, "\t")}\n`,
			);
			const next = registry.reloadAgentManifest("manifest-agent");

			expect(next.manifest.model).toBe("test/model-edited");
			expect(next.manifest.description).toBe("Edited.");
			expect(next.parsed.config.model).toBe("test/model-edited");
			expect(next.parsed.config.description).toBe("Edited.");
			// Prompt + tools bindings survive untouched.
			expect(next.promptHash).toBe(before.promptHash);
			expect(next.parsed.config.tools).toEqual(before.parsed.config.tools);
			expect(next.privateToolNames).toEqual(before.privateToolNames);
			expect(next.contextResolver).toBe(before.contextResolver);
			expect(registry.get("manifest-agent").manifest.model).toBe("test/model-edited");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reloadAgentManifest throws + leaves the cached entry intact on invalid manifest", async () => {
		const root = tempRoot();
		try {
			const agentDir = join(root, "manifest-agent");
			writeAgentDir(agentDir);

			const registry = await buildRegistry({ roots: [root] });

			// Write an invalid manifest (missing required model) to disk.
			writeFileSync(
				join(agentDir, "agent.json"),
				`${JSON.stringify({ name: "manifest-agent", description: "no model" }, null, "\t")}\n`,
			);

			expect(() => registry.reloadAgentManifest("manifest-agent")).toThrow(/model/);
			// The cached entry is unchanged (old model still resolves).
			expect(registry.get("manifest-agent").manifest.model).toBe("test/model");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("reloadAgentManifest re-expands tool profiles and rejects unknown ones", async () => {
		const root = tempRoot();
		try {
			const agentDir = join(root, "manifest-agent");
			writeAgentDir(agentDir);

			const registry = await buildRegistry({
				roots: [root],
				toolProfiles: { reader: ["glob", "grep", "read"] },
			});

			// Add a valid profile reference — reload expands it.
			writeFileSync(
				join(agentDir, "agent.json"),
				`${JSON.stringify({ ...AGENT_MANIFEST, toolProfiles: ["reader"] }, null, "\t")}\n`,
			);
			const next = registry.reloadAgentManifest("manifest-agent");
			expect(next.parsed.config.tools).toEqual(["read", "glob", "grep", "custom_tool"]);

			// Point at an unknown profile — reload throws, entry left intact.
			writeFileSync(
				join(agentDir, "agent.json"),
				`${JSON.stringify({ ...AGENT_MANIFEST, toolProfiles: ["ghost"] }, null, "\t")}\n`,
			);
			expect(() => registry.reloadAgentManifest("manifest-agent")).toThrow(
				/unknown tool profile "ghost"/,
			);
			expect(registry.get("manifest-agent").parsed.config.tools).toEqual([
				"read",
				"glob",
				"grep",
				"custom_tool",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("registerPromptRevisions upserts one registry-boot revision per agent, idempotently", async () => {
		const root = tempRoot();
		const handle = openKernelDatabase({ path: join(root, "trace.db") });
		try {
			await ensureKernelObservabilitySchema(handle.db);
			writeAgentDir(join(root, "catalog", "manifest-agent"));

			const registry = await buildRegistry({ roots: [join(root, "catalog")] });
			const first = await registerPromptRevisions(handle.db, registry);
			expect(first).toHaveLength(1);
			expect(first[0].hash).toBe(registry.get("manifest-agent").promptHash);
			expect(first[0].agentName).toBe("manifest-agent");
			expect(first[0].source).toBe("registry-boot");
			expect(first[0].schemaVersion).toBe("prompt-kit/v1");
			expect(first[0].renderedText).toContain("<request>");

			// Idempotent on hash: a second boot returns the same row untouched.
			const second = await registerPromptRevisions(handle.db, registry);
			expect(second).toHaveLength(1);
			expect(second[0].createdAt).toBe(first[0].createdAt);
		} finally {
			handle.close();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
