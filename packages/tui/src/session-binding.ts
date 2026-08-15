/**
 * session-binding.ts — JSONL identity markers for TUI boots.
 *
 * When /kernel boots a bundle, the session's Pi JSONL transcript becomes a
 * kernel-traceable record: we append the same "agent-kernel:session-binding"
 * custom entry the spawn pipeline writes (transcript-recovery's EventMapper
 * reads `data.containerId` / `data.runId` at the top level of the entry's
 * payload), plus a TUI-only "agent-kernel:tui-session-meta" entry carrying
 * everything the ingest CLI needs to upsert identity rows into the right db.
 *
 * Ownership rule: traces belong to the repo you operate in. The target kernel
 * root is the cwd-walk `.agent-kernel/` (same walk catalog.ts uses for the
 * project layer); a kernel-less cwd falls back to agent-kernel's own
 * `.agent-kernel/`, located from this package's position in the checkout.
 *
 * Booting a second agent in one session appends a fresh binding (new
 * container); the mapper rebinds all subsequent events to the latest marker.
 *
 * Node-clean: pi runs extensions under Node — node:crypto/fs/path only.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
	findProjectKernelFile,
	locateGenericCatalog,
	type CatalogSource,
} from "./catalog";

/** Must match DEFAULT_SESSION_BINDING_CUSTOM_TYPE (kernel/src/index.ts). Kept
 * literal here so the TUI import graph stays free of the db-tangled barrel. */
export const SESSION_BINDING_CUSTOM_TYPE = "agent-kernel:session-binding";
export const TUI_SESSION_META_CUSTOM_TYPE = "agent-kernel:tui-session-meta";

/** Payload of the session-binding entry — exactly what EventMapper reads. */
export interface SessionBindingPayload {
	containerId: string;
	runId: string;
}

/** Payload of the tui-session-meta entry — what the ingest CLI reads. */
export interface TuiSessionMetaPayload {
	/** Pairs the meta with its binding when several boots share a session. */
	containerId: string;
	runId: string;
	agentName: string;
	source: CatalogSource;
	cwd: string;
	/** kernelId from the target root's kernel.json, when readable. */
	kernelId: string | null;
	/** Absolute `.agent-kernel/` dir whose db owns this session's traces. */
	targetKernelRoot: string | null;
	origin: "tui";
}

export interface SessionBindingMarkers {
	containerId: string;
	runId: string;
	binding: SessionBindingPayload;
	meta: TuiSessionMetaPayload;
}

export interface ResolvedKernelTarget {
	/** Absolute path of the owning `.agent-kernel/` dir, or null if none. */
	root: string | null;
	/** kernelId read from `<root>/kernel.json`, or null when unreadable. */
	kernelId: string | null;
}

function readKernelId(kernelFile: string): string | null {
	try {
		const parsed = JSON.parse(readFileSync(kernelFile, "utf8")) as {
			kernelId?: unknown;
		};
		return typeof parsed.kernelId === "string" && parsed.kernelId !== ""
			? parsed.kernelId
			: null;
	} catch {
		return null;
	}
}

/**
 * The `.agent-kernel/` whose trace.db owns this session: cwd-walk first
 * (project kernel), else agent-kernel's own root resolved from this package's
 * checkout position (parent of the generic catalog root).
 */
export function resolveTargetKernelRoot(cwd: string): ResolvedKernelTarget {
	const projectKernelFile = findProjectKernelFile(cwd);
	if (projectKernelFile) {
		return {
			root: dirname(projectKernelFile),
			kernelId: readKernelId(projectKernelFile),
		};
	}
	const catalogRoot = locateGenericCatalog().root;
	if (catalogRoot) {
		const fallbackFile = join(dirname(catalogRoot), ".agent-kernel", "kernel.json");
		if (existsSync(fallbackFile)) {
			return { root: dirname(fallbackFile), kernelId: readKernelId(fallbackFile) };
		}
	}
	return { root: null, kernelId: null };
}

export interface BuildMarkersInput {
	agentName: string;
	source: CatalogSource;
	cwd: string;
}

/**
 * Mint a fresh container + run identity and build both marker payloads.
 * Ids are random UUIDs (no Date.now derivation); pi stamps entry timestamps
 * when the entries are appended.
 */
export function buildSessionBindingMarkers(
	input: BuildMarkersInput,
): SessionBindingMarkers {
	const containerId = randomUUID();
	const runId = randomUUID();
	const target = resolveTargetKernelRoot(input.cwd);
	return {
		containerId,
		runId,
		binding: { containerId, runId },
		meta: {
			containerId,
			runId,
			agentName: input.agentName,
			source: input.source,
			cwd: input.cwd,
			kernelId: target.kernelId,
			targetKernelRoot: target.root,
			origin: "tui",
		},
	};
}
