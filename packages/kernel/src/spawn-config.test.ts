import { describe, expect, test } from "bun:test";

import { normalizeAgentManifest } from "./agent-definition";
import { resolveSpawnConfig, type SpawnConfigSource } from "./spawn-config";

function makeDef(): SpawnConfigSource {
	const manifest = normalizeAgentManifest({
		name: "worker",
		description: "Test worker.",
		model: "strong",
		thinking: "low",
		maxTurns: 12,
		variants: {
			cheap: { model: "fanout", maxTurns: 4 },
			deep: {
				thinking: "high",
				maxTurns: 24,
				runInBackground: true,
				displayLabel: "Worker (deep)",
			},
		},
	});
	return {
		name: "worker",
		manifest,
		parsed: {
			config: {
				name: "worker",
				description: "Test worker.",
				model: "strong",
				tools: ["read"],
				variables: {},
				maxTurns: 12,
				thinking: "low",
			},
			body: "prompt body",
			promptHash: "pk1-test",
		},
	};
}

const ALIASES = {
	strong: "codex-lb/gpt-5.5",
	fanout: "codex-lb/gpt-5-mini",
};

describe("resolveSpawnConfig", () => {
	test("resolves the manifest model through config aliases", () => {
		const { parsed } = resolveSpawnConfig(makeDef(), undefined, ALIASES);
		expect(parsed.config.model).toBe("codex-lb/gpt-5.5");
		// Everything else is untouched.
		expect(parsed.config.maxTurns).toBe(12);
		expect(parsed.config.thinking).toBe("low");
		expect(parsed.promptHash).toBe("pk1-test");
	});

	test("leaves non-alias model strings as-is", () => {
		const def = makeDef();
		def.parsed.config.model = "anthropic/claude-sonnet-4-5";
		const { parsed } = resolveSpawnConfig(def, undefined, ALIASES);
		expect(parsed.config.model).toBe("anthropic/claude-sonnet-4-5");
	});

	test("applies variant overrides, then alias-resolves the variant model", () => {
		const { parsed, displayLabel } = resolveSpawnConfig(makeDef(), "cheap", ALIASES);
		expect(parsed.config.model).toBe("codex-lb/gpt-5-mini");
		expect(parsed.config.maxTurns).toBe(4);
		expect(displayLabel).toBeUndefined();
	});

	test("variant thinking/maxTurns/runInBackground/displayLabel override the manifest", () => {
		const { parsed, displayLabel } = resolveSpawnConfig(makeDef(), "deep", ALIASES);
		// Model untouched by the variant → manifest alias still resolves.
		expect(parsed.config.model).toBe("codex-lb/gpt-5.5");
		expect(parsed.config.thinking).toBe("high");
		expect(parsed.config.maxTurns).toBe(24);
		expect(parsed.config.runInBackground).toBe(true);
		expect(displayLabel).toBe("Worker (deep)");
	});

	test("unknown variant fails with the declared variant names", () => {
		expect(() => resolveSpawnConfig(makeDef(), "turbo", ALIASES)).toThrow(
			'Unknown variant "turbo" for agent "worker" — declared variants: cheap, deep',
		);
	});

	test("does not mutate the definition's config", () => {
		const def = makeDef();
		resolveSpawnConfig(def, "deep", ALIASES);
		expect(def.parsed.config.model).toBe("strong");
		expect(def.parsed.config.maxTurns).toBe(12);
	});
});
