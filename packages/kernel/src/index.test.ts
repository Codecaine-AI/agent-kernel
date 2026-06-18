import { describe, expect, mock, test } from "bun:test";

import { createKernel, DEFAULT_MAX_BACKGROUND_AGENTS } from ".";

describe("createKernel", () => {
	test("routes spawns through the configured adapter", async () => {
		const spawnAgent = mock(async (name: string, prompt: string) => ({
			name,
			prompt,
		}));
		const kernel = createKernel({ spawnAgent });

		const result = await kernel.spawnAgent("spec", "hello");

		expect(result).toEqual({ name: "spec", prompt: "hello" });
		expect(spawnAgent).toHaveBeenCalledTimes(1);
		expect(kernel.concurrency.maxBackgroundAgents).toBe(
			DEFAULT_MAX_BACKGROUND_AGENTS,
		);
	});

	test("owns per-instance background concurrency", () => {
		const setMaxConcurrent = mock(() => {});
		const kernel = createKernel({
			concurrency: { maxBackgroundAgents: 2 },
			spawnAgent: async () => null,
			createAgentManager: ({ maxConcurrentBackgroundAgents }) => ({
				initialLimit: maxConcurrentBackgroundAgents,
				setMaxConcurrent,
			}),
		});

		expect(kernel.agentManager.initialLimit).toBe(2);
		kernel.setMaxBackgroundAgents(3);

		expect(kernel.concurrency.maxBackgroundAgents).toBe(3);
		expect(setMaxConcurrent).toHaveBeenCalledWith(3);
	});
});
