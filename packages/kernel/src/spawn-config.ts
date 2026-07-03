/**
 * Sanctioned per-spawn config resolution (Phase 4b):
 *
 *   manifest config
 *     -> variant overrides (model/thinking/maxTurns/runInBackground/
 *        displayLabel, selected via spawn option `variant`)
 *     -> model alias resolution (kernel config `models.aliases`)
 *
 * The returned config carries the RESOLVED model string — that is what lands
 * on the pi_agent_sessions row and in turn usage, so fleet-wide retargeting
 * is one config edit and cost attribution stays truthful.
 */
import type { NormalizedAgentManifest } from "./agent-definition";
import type { ParsedAgent } from "./spawn-pipeline/types";

export interface SpawnConfigSource {
	name: string;
	parsed: ParsedAgent;
	manifest: NormalizedAgentManifest;
}

export interface ResolvedSpawnAgent {
	parsed: ParsedAgent;
	/** Variant display label, when the selected variant declares one. */
	displayLabel?: string;
}

export function resolveSpawnConfig(
	def: SpawnConfigSource,
	variantName: string | undefined,
	aliases: Record<string, string> | undefined,
): ResolvedSpawnAgent {
	const config = { ...def.parsed.config };
	let displayLabel: string | undefined;

	if (variantName !== undefined) {
		const variant = def.manifest.variants[variantName];
		if (!variant) {
			const declared = Object.keys(def.manifest.variants).sort();
			throw new Error(
				`Unknown variant "${variantName}" for agent "${def.name}" — declared variants: ${
					declared.length ? declared.join(", ") : "(none)"
				}`,
			);
		}
		if (variant.model !== undefined) config.model = variant.model;
		if (variant.thinking !== undefined) config.thinking = variant.thinking;
		if (variant.maxTurns !== undefined) config.maxTurns = variant.maxTurns;
		if (variant.runInBackground !== undefined) {
			config.runInBackground = variant.runInBackground;
		}
		displayLabel = variant.displayLabel;
	}

	config.model = aliases?.[config.model] ?? config.model;

	return {
		parsed: { ...def.parsed, config },
		...(displayLabel !== undefined && { displayLabel }),
	};
}
