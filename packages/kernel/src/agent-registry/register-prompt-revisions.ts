import {
	upsertPromptRevision,
	type KernelDatabase,
	type PromptRevision,
} from "@agent-kernel/db";
import { canonicalizePrompt } from "@codecaine-ai/prompt-kit";

import type { AgentRegistry } from "./registry/types";

/**
 * Upsert one prompt_revisions row per catalog agent whose prompt is a
 * content-addressed prompt.json document (D72). Idempotent: revisions are
 * keyed by hash, so re-booting an unchanged catalog is a no-op. Call this at
 * kernel boot, where both the registry and the trace db handle exist.
 */
export async function registerPromptRevisions(
	db: KernelDatabase,
	registry: AgentRegistry,
): Promise<PromptRevision[]> {
	const createdAt = new Date().toISOString();
	const revisions: PromptRevision[] = [];
	for (const def of registry.list()) {
		if (!def.promptDocument || !def.promptHash) continue;
		revisions.push(
			await upsertPromptRevision(db, {
				hash: def.promptHash,
				agentName: def.name,
				schemaVersion: def.promptDocument.schemaVersion,
				document: canonicalizePrompt(def.promptDocument),
				renderedText: def.parsed.body,
				source: "registry-boot",
				createdAt,
			}),
		);
	}
	return revisions;
}
