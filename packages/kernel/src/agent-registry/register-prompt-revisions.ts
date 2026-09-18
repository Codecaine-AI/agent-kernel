import { basename, dirname } from "node:path";

import {
	PROMPT_REVISION_SOURCE,
	upsertPromptRevision,
	type KernelDatabase,
	type PromptRevision,
	type PromptRevisionSource,
} from "@agent-kernel/db";
import { canonicalizePrompt } from "@codecaine-ai/prompt-kit";
import { readLatestPromptChange } from "@codecaine-ai/prompt-kit-server";

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
	// Unlisted agents remain spawnable, so their runtime prompt revisions must
	// be registered even though browse-oriented catalog lists omit them.
	for (const def of registry.listAll()) {
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
	let source: PromptRevisionSource = PROMPT_REVISION_SOURCE.DISK_SYNC;
	const latestChange = await readLatestPromptChange({
		root: dirname(def.promptFile),
		target: { promptPath: basename(def.promptFile) },
		expectedHash: def.promptHash,
	});
	if (
		latestChange.ok &&
		latestChange.change?.source === PROMPT_REVISION_SOURCE.PROMPT_KIT_MCP
	) {
		source = PROMPT_REVISION_SOURCE.PROMPT_KIT_MCP;
	}
	await upsertPromptRevision(db, {
		hash: def.promptHash,
		agentName: def.name,
		schemaVersion: def.promptDocument.schemaVersion,
		document: canonicalizePrompt(def.promptDocument),
		renderedText: def.parsed.body,
		source,
		createdAt: new Date().toISOString(),
	});
	return def;
}
