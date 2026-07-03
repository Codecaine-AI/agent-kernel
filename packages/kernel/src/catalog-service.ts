/**
 * Kernel catalog service (Phase 5) — the read/write surface behind
 * createKernelCatalogApi: registry listing, agent detail (manifest + prompt
 * + validation products), the prompt save flow, revision history, and
 * per-revision run stats.
 *
 * Payload shapes are plain data mirroring the viewer catalog contract
 * (structurally compatible with @agent-kernel/viewer-core's catalog-types)
 * without a viewer dependency.
 *
 * Save flow (PUT .../prompt):
 *   PromptDocument from the lab
 *     -> shape check + validatePrompt against declared variables (errors out)
 *     -> canonicalize + hash
 *     -> write prompt.json + regenerate prompt.rendered.md
 *     -> upsert prompt_revisions (source: "lab-save")
 *     -> hot-swap the in-memory registry entry (next spawn uses the new
 *        prompt, no restart)
 *
 * Local-dev trust model: the save path mutates catalog files on disk, so a
 * service is read-only unless created with `allowWrites: true`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
	getPromptRevisionStats,
	listPromptRevisionsForAgent,
	upsertPromptRevision,
	type KernelDatabase,
	type PromptRevisionStats,
} from "@agent-kernel/db";
import {
	canonicalizePrompt,
	validatePromptDocumentShape,
	type PromptDocument,
} from "@codecaine-ai/prompt-kit";

import {
	buildAgentPromptState,
	RegistryError,
	type AgentRegistry,
} from "./agent-registry";
import { validateAgentManifestShape } from "./agent-definition";

/** One row of `GET .../catalog/agents`. */
export interface KernelCatalogAgentSummary {
	name: string;
	description: string;
	/** The manifest model string, pre-alias (aliases resolve at spawn). */
	model: string;
	promptHash: string;
	valid: boolean;
}

/** Response body of `GET .../catalog/agents/:name`. */
export interface KernelCatalogAgentDetail {
	manifest: Record<string, unknown>;
	prompt: PromptDocument;
	promptHash: string;
	rendered: string;
	declaredVariables: string[];
	/** Model alias keys from the kernel's models.aliases config (datalist suggestions). */
	modelAliases: string[];
}

/** Partial manifest patch accepted by `PUT .../catalog/agents/:name/manifest`. */
export interface KernelCatalogManifestPatch {
	description?: string;
	model?: string;
}

/** One row of `GET .../catalog/agents/:name/revisions`. */
export interface KernelCatalogRevisionSummary {
	hash: string;
	source: string;
	createdAt: string;
}

export type KernelCatalogPromptSaveResult =
	| { ok: true; hash: string }
	| { ok: false; errors: string[] };

export type KernelCatalogManifestSaveResult =
	| { ok: true; manifest: Record<string, unknown> }
	| { ok: false; errors: string[] };

export interface KernelCatalogService {
	/** Dev-mode write gate: the PUT route answers 403 when false. */
	readonly allowWrites: boolean;
	listAgents(): Promise<KernelCatalogAgentSummary[]>;
	/** null when the agent is not in the registry. */
	getAgentDetail(name: string): Promise<KernelCatalogAgentDetail | null>;
	/** null when the agent is not in the registry. */
	savePrompt(
		name: string,
		document: unknown,
	): Promise<KernelCatalogPromptSaveResult | null>;
	/** null when the agent is not in the registry. */
	saveManifest(
		name: string,
		patch: unknown,
	): Promise<KernelCatalogManifestSaveResult | null>;
	/** null when the agent is not in the registry. */
	listRevisions(name: string): Promise<KernelCatalogRevisionSummary[] | null>;
	/** null when the agent is not in the registry. */
	getRevisionStats(
		name: string,
		hash: string,
	): Promise<PromptRevisionStats | null>;
}

export interface CreateKernelCatalogServiceOptions {
	/** The kernel's agent registry (built lazily, hence the accessor). */
	registry: () => Promise<AgentRegistry>;
	/** The kernel trace db (revisions + stats live there). */
	db: () => KernelDatabase;
	/** Enable the prompt save path (mutates catalog files). Default false. */
	allowWrites?: boolean;
	/**
	 * Model alias keys from the kernel's models.aliases config — surfaced on
	 * agent detail as datalist suggestions for the manifest model field. The
	 * accessor lets the kernel thread its live config without a dependency.
	 */
	modelAliases?: () => string[];
}

/**
 * Derived prompt.rendered.md content — byte-for-byte identical to the
 * `renderedSnapshot` helper in scripts/render-prompts-to-json.ts (the Phase 3
 * regeneration script, not importable from this package). Keep the two in
 * lockstep: the catalog snapshot test compares committed files against the
 * script's output.
 */
export const RENDERED_SNAPSHOT_HEADER =
	"<!-- derived from prompt.json — do not edit. regenerate: bun run scripts/render-prompts-to-json.ts -->\n\n";

export function renderedPromptSnapshot(body: string): string {
	return `${RENDERED_SNAPSHOT_HEADER}${body.endsWith("\n") ? body : `${body}\n`}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createKernelCatalogService(
	opts: CreateKernelCatalogServiceOptions,
): KernelCatalogService {
	const allowWrites = opts.allowWrites ?? false;
	const modelAliases = opts.modelAliases ?? (() => []);

	return {
		allowWrites,

		async listAgents() {
			const registry = await opts.registry();
			// Registry boot rejects invalid agents wholesale (AggregateError), so
			// every listed agent validated successfully.
			return registry.list().map((def) => ({
				name: def.name,
				description: def.manifest.description,
				model: def.manifest.model,
				promptHash: def.promptHash,
				valid: true,
			}));
		},

		async getAgentDetail(name) {
			const registry = await opts.registry();
			const def = registry.tryGet(name);
			if (!def) return null;
			return {
				manifest: def.manifest as unknown as Record<string, unknown>,
				prompt: def.promptDocument,
				promptHash: def.promptHash,
				rendered: def.parsed.body,
				declaredVariables: Object.keys(def.manifest.variables),
				modelAliases: modelAliases(),
			};
		},

		async savePrompt(name, input) {
			const registry = await opts.registry();
			const def = registry.tryGet(name);
			if (!def) return null;

			const shape = validatePromptDocumentShape(input);
			if (!shape.valid) return { ok: false, errors: shape.errors };
			const document = input as PromptDocument;

			// Exactly the boot-time validation (declared variables + rendered
			// {{var}} references), so a saved prompt is one the next boot accepts.
			let rendered: string;
			let hash: string;
			try {
				const state = buildAgentPromptState(def.manifest, document, def.manifestFile);
				rendered = state.body;
				hash = state.promptHash;
			} catch (err) {
				if (err instanceof RegistryError) return { ok: false, errors: err.violations };
				throw err;
			}

			const canonical = canonicalizePrompt(document);
			writeFileSync(def.promptFile, canonical, "utf8");
			writeFileSync(
				join(dirname(def.promptFile), "prompt.rendered.md"),
				renderedPromptSnapshot(rendered),
				"utf8",
			);

			await upsertPromptRevision(opts.db(), {
				hash,
				agentName: def.name,
				schemaVersion: document.schemaVersion,
				document: canonical,
				renderedText: rendered,
				source: "lab-save",
				createdAt: new Date().toISOString(),
			});

			// Hot-swap the in-memory definition from the file just written —
			// subsequent spawns freeze the new prompt (and stamp its hash on
			// their sessions) without a server restart.
			registry.reloadAgentPrompt(name);

			return { ok: true, hash };
		},

		async saveManifest(name, input) {
			const registry = await opts.registry();
			const def = registry.tryGet(name);
			if (!def) return null;

			// Shape-check the partial patch before touching disk.
			if (!isPlainObject(input)) {
				return { ok: false, errors: ["manifest patch: expected an object"] };
			}
			const patch = input as Record<string, unknown>;
			const errors: string[] = [];
			for (const key of Object.keys(patch)) {
				if (key !== "description" && key !== "model") {
					errors.push(`manifest patch.${key}: only description and model are editable`);
				}
			}
			if (patch.description !== undefined && typeof patch.description !== "string") {
				errors.push("manifest patch.description: expected a string");
			}
			if (patch.model !== undefined && typeof patch.model !== "string") {
				errors.push("manifest patch.model: expected a string");
			}
			if (errors.length > 0) return { ok: false, errors };

			// Re-read the raw agent.json (source of truth for formatting) and
			// merge the patch, so fields we don't edit ($schema, variants, …)
			// are preserved verbatim.
			let onDisk: Record<string, unknown>;
			try {
				const parsed = JSON.parse(readFileSync(def.manifestFile, "utf8"));
				if (!isPlainObject(parsed)) {
					return { ok: false, errors: ["agent.json: expected an object"] };
				}
				onDisk = parsed;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return { ok: false, errors: [`agent.json parse error: ${msg}`] };
			}

			const merged: Record<string, unknown> = { ...onDisk };
			if (patch.description !== undefined) merged.description = patch.description;
			if (patch.model !== undefined) merged.model = patch.model;

			// Validate the MERGED manifest against the shared schema shape.
			const shape = validateAgentManifestShape(merged);
			if (!shape.valid) return { ok: false, errors: shape.errors };

			// Rewrite agent.json preserving the tab-indented convention, then
			// hot-swap the registry entry. reloadAgentManifest re-normalizes and
			// re-validates (spawner targets / tool profiles); on failure it
			// throws RegistryError and the on-disk file has already been written,
			// so guard the write behind a successful reload by writing first and
			// reverting on reload failure.
			const previous = readFileSync(def.manifestFile, "utf8");
			writeFileSync(def.manifestFile, `${JSON.stringify(merged, null, "\t")}\n`, "utf8");
			try {
				registry.reloadAgentManifest(name);
			} catch (err) {
				writeFileSync(def.manifestFile, previous, "utf8");
				if (err instanceof RegistryError) return { ok: false, errors: err.violations };
				throw err;
			}

			return { ok: true, manifest: merged };
		},

		async listRevisions(name) {
			const registry = await opts.registry();
			if (!registry.tryGet(name)) return null;
			const rows = await listPromptRevisionsForAgent(opts.db(), name);
			return rows
				.map((row) => ({
					hash: row.hash,
					source: row.source,
					createdAt: row.createdAt,
				}))
				.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
		},

		async getRevisionStats(name, hash) {
			const registry = await opts.registry();
			if (!registry.tryGet(name)) return null;
			return getPromptRevisionStats(opts.db(), hash);
		},
	};
}
