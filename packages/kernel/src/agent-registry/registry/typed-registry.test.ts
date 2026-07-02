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
	id: "typedAgentPrompt",
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
    return "<typed_context />";
  }
});
`;

const TOOLS_TS = `import { defineTools } from "@agent-kernel/kernel/agent-definition";

export const tools = defineTools((pi) => {
  pi.registerTool({
    name: "custom_tool",
    label: "Custom tool",
    description: "A private typed tool.",
    parameters: {},
    execute: async () => ({ content: [{ type: "text", text: "ok" }] })
  });
});
`;

const AGENT_TS = `import { defineAgent } from "@agent-kernel/kernel/agent-definition";
import { context } from "./context";
import { tools } from "./tools";

export default defineAgent({
  name: "typed-agent",
  description: "Typed registry test agent.",
  model: "test/model",
  coreTools: ["read"],
  variables: {
    userPrompt: {
      default: "hello",
      description: "User request."
    }
  },
  context,
  tools
});
`;

function writeTypedAgentDir(
	agentDir: string,
	opts: { promptJson?: string | null } = {},
): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "context.ts"), CONTEXT_TS);
	writeFileSync(join(agentDir, "tools.ts"), TOOLS_TS);
	writeFileSync(join(agentDir, "agent.ts"), AGENT_TS);
	if (opts.promptJson !== null) {
		writeFileSync(
			join(agentDir, "prompt.json"),
			opts.promptJson ?? `${JSON.stringify(PROMPT_DOCUMENT, null, 2)}\n`,
		);
	}
}

function tempRoot(): string {
	return mkdtempSync(join(import.meta.dir, ".typed-agent-registry-"));
}

/** Registry boot failures aggregate per-agent RegistryErrors. */
async function expectBootFailure(root: string, pattern: RegExp): Promise<void> {
	try {
		await buildRegistry({ catalogRoot: root });
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

describe("typed agent registry (prompt.json)", () => {
	test("loads agent.ts + sibling prompt.json and normalizes prompt, context, and tools", async () => {
		const root = tempRoot();
		try {
			writeTypedAgentDir(join(root, "typed-agent"));

			const registry = await buildRegistry({ catalogRoot: root });
			const agent = registry.get("typed-agent");

			expect(agent.source).toBe("typed");
			expect(agent.agentFile.endsWith("agent.ts")).toBe(true);
			expect(agent.promptFile?.endsWith("prompt.json")).toBe(true);
			expect(agent.parsed.body).toContain("<request>");
			expect(agent.parsed.body).toContain("{{userPrompt}}");
			expect(agent.parsed.frontmatter.tools).toEqual(["read", "custom_tool"]);
			expect(agent.coreTools).toEqual(["read"]);
			expect(agent.privateToolNames).toEqual(["custom_tool"]);
			expect(agent.contextResolver).toBeTruthy();
			const renderedContext = await agent.contextResolver?.assemble([], {
				agentName: "typed-agent",
				variables: {},
				caller: { kind: "user", id: "test" },
				runtime: { cwd: root },
				paths: { workingDir: root, activeSessionDir: root },
			});
			expect(renderedContext).toBe("<typed_context />");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("computes a stable content hash and exposes the loaded document", async () => {
		const root = tempRoot();
		try {
			writeTypedAgentDir(join(root, "typed-agent"));

			const registry = await buildRegistry({ catalogRoot: root });
			const agent = registry.get("typed-agent");

			expect(agent.promptHash).toStartWith("pk1-");
			expect(agent.parsed.promptHash).toBe(agent.promptHash ?? undefined);
			expect(agent.promptDocument).toBeTruthy();
			// The hash is derived from the canonical form of the loaded document.
			expect(hashPrompt(agent.promptDocument!)).toBe(agent.promptHash!);
			// Canonicalization is idempotent over the canonical file content.
			const canonical = canonicalizePrompt(agent.promptDocument!);
			expect(canonicalizePrompt(JSON.parse(canonical))).toBe(canonical);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails with a clear error when prompt.json is missing", async () => {
		const root = tempRoot();
		try {
			writeTypedAgentDir(join(root, "typed-agent"), { promptJson: null });

			await expectBootFailure(root, /missing prompt\.json/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("boot fails when prompt.json is not valid JSON", async () => {
		const root = tempRoot();
		try {
			writeTypedAgentDir(join(root, "typed-agent"), {
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
			writeTypedAgentDir(join(root, "typed-agent"), {
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
			writeTypedAgentDir(join(root, "typed-agent"), {
				promptJson: `${JSON.stringify(doc, null, 2)}\n`,
			});

			await expectBootFailure(root, /notDeclared/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("registerPromptRevisions upserts one registry-boot revision per agent, idempotently", async () => {
		const root = tempRoot();
		const handle = openKernelDatabase({ path: join(root, "trace.db") });
		try {
			await ensureKernelObservabilitySchema(handle.db);
			writeTypedAgentDir(join(root, "catalog", "typed-agent"));

			const registry = await buildRegistry({ catalogRoot: join(root, "catalog") });
			const first = await registerPromptRevisions(handle.db, registry);
			expect(first).toHaveLength(1);
			expect(first[0].hash).toBe(registry.get("typed-agent").promptHash!);
			expect(first[0].agentName).toBe("typed-agent");
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
