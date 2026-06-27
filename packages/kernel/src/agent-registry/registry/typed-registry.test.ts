import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { buildRegistry } from "./registry";

describe("typed agent registry", () => {
	test("loads agent.ts definitions and normalizes prompt, context, and tools", async () => {
		const root = mkdtempSync(join(import.meta.dir, ".typed-agent-registry-"));
		const agentDir = join(root, "typed-agent");
		try {
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(
				join(agentDir, "prompt.ts"),
				`import { paragraph, section, variable, workflowPrompt } from "@codecaine-ai/prompt-kit";

export const prompt = workflowPrompt({
  id: "typedAgentPrompt",
  sections: [
    section("request", [
      paragraph(["Request: ", variable("userPrompt")])
    ])
  ]
});
`,
			);
			writeFileSync(
				join(agentDir, "context.ts"),
				`import { defineContext } from "@agent-kernel/kernel/agent-definition";

export const context = defineContext({
  loaders: [],
  assemble() {
    return "<typed_context />";
  }
});
`,
			);
			writeFileSync(
				join(agentDir, "tools.ts"),
				`import { defineTools } from "@agent-kernel/kernel/agent-definition";

export const tools = defineTools((pi) => {
  pi.registerTool({
    name: "custom_tool",
    label: "Custom tool",
    description: "A private typed tool.",
    parameters: {},
    execute: async () => ({ content: [{ type: "text", text: "ok" }] })
  });
});
`,
			);
			writeFileSync(
				join(agentDir, "agent.ts"),
				`import { defineAgent } from "@agent-kernel/kernel/agent-definition";
import { context } from "./context";
import { prompt } from "./prompt";
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
  prompt,
  context,
  tools
});
`,
			);

			const registry = await buildRegistry({ catalogRoot: root });
			const agent = registry.get("typed-agent");

			expect(agent.source).toBe("typed");
			expect(agent.agentFile.endsWith("agent.ts")).toBe(true);
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
});
