import {
	upsertPromptRevision,
	type KernelDatabase,
	type PromptRevision,
} from "@agent-kernel/db";
import { canonicalizePrompt } from "@codecaine-ai/prompt-kit";

import type { AgentDefinition, AgentRegistry } from "./registry/types";

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

/**
 * Refresh one agent's prompt from disk (registry.refreshAgentPromptFromDisk)
 * and, when the document actually changed, upsert its prompt_revisions row
 * with source "disk-sync" so revision history and per-revision stats cover
 * out-of-band edits. A file that fails to stat or validate serves the cached
 * definition unchanged — callers keep answering from the last good read.
 * Throws only for a name that is not in the registry.
 */
export async function syncAgentPromptFromDisk(
	db: KernelDatabase | null,
	registry: AgentRegistry,
	name: string,
): Promise<AgentDefinition> {
	const { def, changed, error } = registry.refreshAgentPromptFromDisk(name);
	if (error || !changed || !db) return def;
	await upsertPromptRevision(db, {
		hash: def.promptHash,
		agentName: def.name,
		schemaVersion: def.promptDocument.schemaVersion,
		document: canonicalizePrompt(def.promptDocument),
		renderedText: def.parsed.body,
		source: "disk-sync",
		createdAt: new Date().toISOString(),
	});
	return def;
}
