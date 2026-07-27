/**
 * state-sidecar.test.ts — `state.ts` discovery by filename convention, and
 * the manifest's optional `state.window` block.
 *
 * The back-compat case is the one that matters: a bundle with neither carries
 * `stateModule: null` and `stateConfig: null`, which is what keeps the spawn
 * pipeline on the pure pass-through path.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { buildRegistry } from "./registry";

const PROMPT_DOCUMENT = {
	kind: "prompt",
	schemaVersion: "prompt-kit/v1",
	id: "stateAgentPrompt",
	nodes: [
		{
			type: "section",
			tag: "role",
			children: [{ type: "paragraph", content: ["You edit a board."] }],
		},
	],
};

const STATE_TS = `import { defineState } from "@agent-kernel/kernel/agent-definition";

export const state = defineState({
  seed: (ctx) => ({ board: ctx.agentName, ops: [] }),
  update: (s, event) => ({ ...s, ops: [...s.ops, event.kind] }),
  render: (s) => ({
    messages: [{ role: "user", content: [{ type: "text", text: "<state ops=\\"" + s.ops.length + "\\"/>" }], timestamp: 1 }],
    stateMessageCount: 1
  }),
  window: { strategy: "turns", maxTurns: 3 }
});
`;

const BROKEN_STATE_TS = `export const state = { seed: () => ({}) };
`;

function baseManifest(extra: Record<string, unknown> = {}) {
	return {
		$schema: "agent-kernel/agent-v1",
		name: "state-agent",
		description: "State sidecar test agent.",
		model: "test/model",
		...extra,
	};
}

function writeAgentDir(
	agentDir: string,
	opts: { manifest?: Record<string, unknown>; stateTs?: string } = {},
): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "agent.json"),
		`${JSON.stringify(opts.manifest ?? baseManifest(), null, 2)}\n`,
	);
	writeFileSync(
		join(agentDir, "prompt.json"),
		`${JSON.stringify(PROMPT_DOCUMENT, null, 2)}\n`,
	);
	if (opts.stateTs) writeFileSync(join(agentDir, "state.ts"), opts.stateTs);
}

function tempRoot(): string {
	return mkdtempSync(join(import.meta.dir, ".state-sidecar-registry-"));
}

describe("state.ts sidecar discovery", () => {
	test("a bundle with no state.ts and no state block stays pure pass-through", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "state-agent"));
			const agent = (await buildRegistry({ roots: [root] })).get("state-agent");
			expect(agent.stateModule).toBeNull();
			expect(agent.stateModulePath).toBeNull();
			expect(agent.stateConfig).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("state.ts attaches by filename and exposes seed/update/render", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "state-agent"), { stateTs: STATE_TS });
			const agent = (await buildRegistry({ roots: [root] })).get("state-agent");

			expect(agent.stateModulePath?.endsWith("state.ts")).toBe(true);
			expect(agent.stateModule).toBeTruthy();
			const module = agent.stateModule!;
			expect(typeof module.seed).toBe("function");
			expect(typeof module.update).toBe("function");
			expect(typeof module.render).toBe("function");
			expect(module.window).toEqual({ strategy: "turns", maxTurns: 3 });

			const seeded = module.seed(
				{
					agentName: "state-agent",
					variables: {},
					caller: { kind: "user", id: "test" },
					runtime: { cwd: root },
					paths: { workingDir: root, activeSessionDir: root },
				},
				undefined,
			) as { board: string; ops: string[] };
			expect(seeded).toEqual({ board: "state-agent", ops: [] });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("manifest state.window is carried onto the definition", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "state-agent"), {
				manifest: baseManifest({
					state: { window: { strategy: "token-budget", maxTokens: 40000 } },
				}),
			});
			const agent = (await buildRegistry({ roots: [root] })).get("state-agent");
			expect(agent.stateConfig).toEqual({
				window: { strategy: "token-budget", maxTokens: 40000 },
			});
			expect(agent.stateModule).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a state.ts missing part of the contract fails boot loudly", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "state-agent"), { stateTs: BROKEN_STATE_TS });
			await buildRegistry({ roots: [root] });
			throw new Error("expected buildRegistry to fail");
		} catch (err) {
			expect(err).toBeInstanceOf(AggregateError);
			const messages = (err as AggregateError).errors
				.map((e: unknown) => (e instanceof Error ? e.message : String(e)))
				.join("\n");
			expect(messages).toMatch(/state\.ts must export/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("an invalid state.window is rejected by the manifest schema", async () => {
		const root = tempRoot();
		try {
			writeAgentDir(join(root, "state-agent"), {
				manifest: baseManifest({ state: { window: { strategy: "vibes" } } }),
			});
			await buildRegistry({ roots: [root] });
			throw new Error("expected buildRegistry to fail");
		} catch (err) {
			expect(err).toBeInstanceOf(AggregateError);
			const messages = (err as AggregateError).errors
				.map((e: unknown) => (e instanceof Error ? e.message : String(e)))
				.join("\n");
			expect(messages).toMatch(/state\.window\.strategy/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
