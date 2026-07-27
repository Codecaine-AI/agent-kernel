/**
 * bundle-layout.test.ts — the folder-form discovery contract.
 *
 * The rules under test, in the order the registry applies them:
 *   prompt   <bundle>/prompt.json  →  <bundle>/prompt/prompt.json
 *   context  <bundle>/context.ts   →  <bundle>/context/index.ts
 *   tools    <bundle>/tools.ts     →  <bundle>/tools/index.ts
 *   state    <bundle>/state.ts     →  <bundle>/state/index.ts
 *
 * Both forms present: the file wins silently in resolution (so a migration can
 * leave a re-export shim), and doctor is the place that names both paths.
 * Non-entry files inside a section folder — `prompt/system.md` above all — are
 * invisible to discovery.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { runCatalogDoctor } from "../../doctor";
import { resolveBundleLayout } from "./bundle-layout";
import { buildRegistry } from "./registry";

const PROMPT_DOCUMENT = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "bundleAgentPrompt",
	nodes: [
		{
			type: "section",
			tag: "role",
			children: [{ type: "paragraph", content: ["You live in a bundle."] }],
		},
	],
};

const CONTEXT_TS = `import { defineContext } from "@agent-kernel/kernel/agent-definition";

export const context = defineContext({
  loaders: [{ kind: "text", label: "note", content: "folder form" }],
  assemble: (loaded) => "<ctx>" + Object.keys(loaded).length + "</ctx>",
});
export default context;
`;

const TOOLS_TS = `import { defineTools } from "@agent-kernel/kernel/agent-definition";
import { Type } from "@earendil-works/pi-ai";

export const tools = defineTools((pi) => {
  pi.registerTool({
    name: "echo",
    label: "Echo",
    description: "Echo a note back.",
    parameters: Type.Object({ note: Type.String() }),
    executionMode: "sequential",
    async execute() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
});
export default tools;
`;

const STATE_TS = `import { defineState } from "@agent-kernel/kernel/agent-definition";

export const state = defineState({
  seed: () => ({ n: 0 }),
  update: (s) => s,
  render: () => ({ messages: [], stateMessageCount: 0 }),
});
export default state;
`;

const MANIFEST = {
	$schema: "agent-kernel/agent-v1",
	name: "bundle-agent",
	description: "Folder-form bundle discovery test agent.",
	model: "test/model",
};

interface BundleSpec {
	/** "file" writes <kind>.ts, "folder" writes <kind>/index.ts, "both" writes each. */
	prompt?: "file" | "folder" | "both";
	context?: "file" | "folder" | "both";
	tools?: "file" | "folder" | "both";
	state?: "file" | "folder" | "both";
	/** Extra non-entry files inside section folders: relative path → contents. */
	extras?: Record<string, string>;
}

const SIDECAR_SOURCE = {
	context: CONTEXT_TS,
	tools: TOOLS_TS,
	state: STATE_TS,
} as const;

function writeBundle(agentDir: string, spec: BundleSpec): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "agent.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);

	const promptJson = `${JSON.stringify(PROMPT_DOCUMENT, null, 2)}\n`;
	const promptForm = spec.prompt ?? "file";
	if (promptForm === "file" || promptForm === "both") {
		writeFileSync(join(agentDir, "prompt.json"), promptJson);
	}
	if (promptForm === "folder" || promptForm === "both") {
		mkdirSync(join(agentDir, "prompt"), { recursive: true });
		writeFileSync(join(agentDir, "prompt", "prompt.json"), promptJson);
	}

	for (const kind of ["context", "tools", "state"] as const) {
		const form = spec[kind];
		if (!form) continue;
		if (form === "file" || form === "both") {
			writeFileSync(join(agentDir, `${kind}.ts`), SIDECAR_SOURCE[kind]);
		}
		if (form === "folder" || form === "both") {
			mkdirSync(join(agentDir, kind), { recursive: true });
			writeFileSync(join(agentDir, kind, "index.ts"), SIDECAR_SOURCE[kind]);
		}
	}

	for (const [rel, contents] of Object.entries(spec.extras ?? {})) {
		const full = join(agentDir, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, contents);
	}
}

function tempRoot(): string {
	return mkdtempSync(join(import.meta.dir, ".bundle-layout-registry-"));
}

async function withBundle<T>(
	spec: BundleSpec,
	fn: (ctx: { root: string; agentDir: string }) => Promise<T> | T,
): Promise<T> {
	const root = tempRoot();
	const agentDir = join(root, "bundle-agent");
	try {
		writeBundle(agentDir, spec);
		return await fn({ root, agentDir });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("bundle layout resolution", () => {
	test("legacy flat bundle resolves every section to the file form", async () => {
		await withBundle(
			{ prompt: "file", context: "file", tools: "file", state: "file" },
			async ({ root, agentDir }) => {
				const layout = resolveBundleLayout(agentDir);
				expect(layout.prompt.form).toBe("file");
				expect(layout.context.form).toBe("file");
				expect(layout.tools.form).toBe("file");
				expect(layout.state.form).toBe("file");

				const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
				expect(agent.promptFile).toBe(join(agentDir, "prompt.json"));
				expect(agent.renderedPromptFile).toBe(join(agentDir, "prompt.rendered.md"));
				expect(agent.contextModulePath).toBe(join(agentDir, "context.ts"));
				expect(agent.toolsModulePath).toBe(join(agentDir, "tools.ts"));
				expect(agent.stateModulePath).toBe(join(agentDir, "state.ts"));
				expect(agent.contextResolver).toBeTruthy();
				expect(agent.privateTools).toBeTruthy();
				expect(agent.stateModule).toBeTruthy();
				expect(agent.privateToolNames).toEqual(["echo"]);
				expect(agent.warnings).toEqual([]);
			},
		);
	});

	test("prompt/prompt.json is found when there is no flat prompt.json", async () => {
		await withBundle({ prompt: "folder" }, async ({ root, agentDir }) => {
			const layout = resolveBundleLayout(agentDir);
			expect(layout.prompt.form).toBe("folder");
			expect(layout.prompt.path).toBe(join(agentDir, "prompt", "prompt.json"));

			const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
			expect(agent.promptFile).toBe(join(agentDir, "prompt", "prompt.json"));
			expect(agent.renderedPromptFile).toBe(join(agentDir, "prompt", "system.md"));
			expect(agent.parsed.body).toContain("You live in a bundle.");
		});
	});

	test("context/index.ts is found when there is no context.ts", async () => {
		await withBundle({ context: "folder" }, async ({ root, agentDir }) => {
			const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
			expect(agent.bundleLayout.context.form).toBe("folder");
			expect(agent.contextModulePath).toBe(join(agentDir, "context", "index.ts"));
			expect(agent.contextResolver?.loaders).toHaveLength(1);
		});
	});

	test("tools/index.ts is found when there is no tools.ts", async () => {
		await withBundle({ tools: "folder" }, async ({ root, agentDir }) => {
			const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
			expect(agent.bundleLayout.tools.form).toBe("folder");
			expect(agent.toolsModulePath).toBe(join(agentDir, "tools", "index.ts"));
			expect(agent.privateToolNames).toEqual(["echo"]);
		});
	});

	test("state/index.ts is found when there is no state.ts", async () => {
		await withBundle({ state: "folder" }, async ({ root, agentDir }) => {
			const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
			expect(agent.bundleLayout.state.form).toBe("folder");
			expect(agent.stateModulePath).toBe(join(agentDir, "state", "index.ts"));
			expect(typeof agent.stateModule?.seed).toBe("function");
		});
	});

	test("a base bundle is agent.json + prompt/ only", async () => {
		await withBundle(
			{ prompt: "folder", extras: { "prompt/system.md": "# generated\n" } },
			async ({ root, agentDir }) => {
				const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
				// The absence of the other folders IS the statement that this is a
				// plain windowed agent.
				expect(agent.contextResolver).toBeNull();
				expect(agent.contextModulePath).toBeNull();
				expect(agent.privateTools).toBeNull();
				expect(agent.stateModule).toBeNull();
				expect(agent.stateConfig).toBeNull();
				expect(agent.bundleLayout.context.form).toBeNull();
				expect(agent.bundleLayout.tools.form).toBeNull();
				expect(agent.bundleLayout.state.form).toBeNull();
				// system.md sits right beside prompt.json and is never parsed.
				expect(existsSync(join(agentDir, "prompt", "system.md"))).toBe(true);
				expect(agent.promptFile.endsWith("prompt.json")).toBe(true);
			},
		);
	});

	test("non-entry files inside section folders are ignored", async () => {
		await withBundle(
			{
				prompt: "folder",
				context: "folder",
				state: "folder",
				extras: {
					"prompt/system.md": "# generated\n",
					"prompt/notes.md": "scratch\n",
					"context/style-guide.ts": "export const broken: number = 'nope';\n",
					"state/rules/operations.ts": "throw new Error('never imported');\n",
				},
			},
			async ({ root, agentDir }) => {
				const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
				expect(agent.contextModulePath).toBe(join(agentDir, "context", "index.ts"));
				expect(agent.stateModulePath).toBe(join(agentDir, "state", "index.ts"));
				expect(agent.contextResolver).toBeTruthy();
				expect(agent.stateModule).toBeTruthy();
			},
		);
	});

	test("both forms present: the file wins silently in resolution", async () => {
		await withBundle(
			{ prompt: "both", context: "both", tools: "both", state: "both" },
			async ({ root, agentDir }) => {
				const layout = resolveBundleLayout(agentDir);
				expect(layout.prompt.form).toBe("file");
				expect(layout.prompt.shadowedPath).toBe(
					join(agentDir, "prompt", "prompt.json"),
				);
				expect(layout.context.shadowedPath).toBe(
					join(agentDir, "context", "index.ts"),
				);

				const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
				expect(agent.promptFile).toBe(join(agentDir, "prompt.json"));
				expect(agent.contextModulePath).toBe(join(agentDir, "context.ts"));
				expect(agent.toolsModulePath).toBe(join(agentDir, "tools.ts"));
				expect(agent.stateModulePath).toBe(join(agentDir, "state.ts"));
				// Silent: no registry warning, no boot failure.
				expect(agent.warnings).toEqual([]);
			},
		);
	});

	test("a re-export shim at the file path keeps a migrated folder loading", async () => {
		// The migration shape the silent precedence exists for: the folder holds
		// the implementation, the old path is one re-export line.
		await withBundle({ prompt: "folder", tools: "folder" }, async ({ root, agentDir }) => {
			writeFileSync(
				join(agentDir, "tools.ts"),
				'export { tools as default, tools } from "./tools/index";\n',
			);
			const agent = (await buildRegistry({ roots: [root] })).get("bundle-agent");
			expect(agent.toolsModulePath).toBe(join(agentDir, "tools.ts"));
			expect(agent.privateToolNames).toEqual(["echo"]);
			expect(agent.bundleLayout.tools.shadowedPath).toBe(
				join(agentDir, "tools", "index.ts"),
			);
		});
	});

	test("a bundle with no prompt.json in either form fails boot naming both paths", async () => {
		const root = tempRoot();
		const agentDir = join(root, "bundle-agent");
		try {
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(
				join(agentDir, "agent.json"),
				`${JSON.stringify(MANIFEST, null, 2)}\n`,
			);
			await buildRegistry({ roots: [root] });
			throw new Error("expected buildRegistry to fail");
		} catch (err) {
			expect(err).toBeInstanceOf(AggregateError);
			const messages = (err as AggregateError).errors
				.map((e: unknown) => (e instanceof Error ? e.message : String(e)))
				.join("\n");
			expect(messages).toContain("missing prompt.json");
			expect(messages).toContain(join(agentDir, "prompt.json"));
			expect(messages).toContain(join(agentDir, "prompt", "prompt.json"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("catalog doctor — bundle layout", () => {
	test("clean folder-form catalog produces no warnings", async () => {
		await withBundle(
			{ prompt: "folder", context: "folder", tools: "folder" },
			({ root }) => {
				const report = runCatalogDoctor([root]);
				expect(report.ok).toBe(true);
				expect(report.warnings).toEqual([]);
				expect(report.counts.bundles).toBe(1);
				expect(report.counts.folderForm).toBe(3);
				expect(report.counts.fileForm).toBe(0);
				expect(report.bundles[0].forms).toEqual({
					prompt: "folder",
					context: "folder",
					tools: "folder",
					state: null,
				});
			},
		);
	});

	test("clean legacy flat catalog produces no warnings", async () => {
		await withBundle({ prompt: "file", context: "file" }, ({ root }) => {
			const report = runCatalogDoctor([root]);
			expect(report.ok).toBe(true);
			expect(report.counts.fileForm).toBe(2);
			expect(report.counts.folderForm).toBe(0);
		});
	});

	test("both forms present is reported as a warning naming both paths", async () => {
		await withBundle(
			{ prompt: "both", context: "both", tools: "folder" },
			({ root, agentDir }) => {
				const report = runCatalogDoctor([root]);
				expect(report.ok).toBe(false);
				expect(report.warnings.map((w) => w.section).sort()).toEqual([
					"context",
					"prompt",
				]);

				const prompt = report.warnings.find((w) => w.section === "prompt")!;
				expect(prompt.resolvedPath).toBe(join(agentDir, "prompt.json"));
				expect(prompt.shadowedPath).toBe(join(agentDir, "prompt", "prompt.json"));
				expect(prompt.agentDir).toBe(agentDir);

				const context = report.warnings.find((w) => w.section === "context")!;
				expect(context.resolvedPath).toBe(join(agentDir, "context.ts"));
				expect(context.shadowedPath).toBe(join(agentDir, "context", "index.ts"));
			},
		);
	});
});
