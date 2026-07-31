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
 *     -> write prompt.json + regenerate its markdown render
 *        (prompt.rendered.md, or prompt/system.md for a folder-form bundle)
 *     -> upsert prompt_revisions (source: "lab-save")
 *     -> hot-swap the in-memory registry entry (next spawn uses the new
 *        prompt, no restart)
 *
 * Local-dev trust model: the save path mutates catalog files on disk, so a
 * service is read-only unless created with `allowWrites: true`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
	getPromptRevision,
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
	syncAgentPromptFromDisk,
	type AgentDefinition,
	type AgentRegistry,
} from "./agent-registry";
import {
	RENDERED_SNAPSHOT_HEADER,
	renderedPromptSnapshot,
} from "./agent-registry/prompt-snapshot";
import { validateAgentManifestShape } from "./agent-definition";
import {
	createCatalogAnnotationOps,
	type KernelCatalogAnnotationOps,
} from "./catalog-annotations";
import {
	buildContext,
	createSpawnContext,
	type AgentContextResolver,
	type LoaderCatalog,
} from "./context";

/** One row of `GET .../catalog/agents`. */
export interface KernelCatalogAgentSummary {
	name: string;
	description: string;
	/** The manifest model string, pre-alias (aliases resolve at spawn). */
	model: string;
	promptHash: string;
	valid: boolean;
}

/** One declared context input with its preview-resolution outcome. */
export interface KernelCatalogContextInput {
	loaderKind: string;
	inputRef: string;
	status: "ok" | "empty" | "error";
	bytes: number;
}

/**
 * Preview of an agent's assembled context, built from the context.ts sidecar
 * against manifest variable defaults and no session data. Session-dependent
 * inputs render as placeholders in `renderedContext`; `inputs` carries the
 * true per-loader statuses. `renderedContext` is null when the preview cannot
 * be built (no loader catalog wired, or the resolver throws).
 */
export interface KernelCatalogContextPreview {
	modulePath: string | null;
	inputs: KernelCatalogContextInput[];
	renderedContext: string | null;
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
	/** null when the agent has no context.ts sidecar. */
	context: KernelCatalogContextPreview | null;
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

/** Response body of `GET .../revisions/:hash/document`. */
export interface KernelCatalogRevisionDocument {
	hash: string;
	createdAt: string;
	document: PromptDocument;
}

export type KernelCatalogPromptSaveResult =
	| { ok: true; hash: string }
	| { ok: false; currentHash: string }
	| { ok: false; errors: string[] };

export type KernelCatalogManifestSaveResult =
	| { ok: true; manifest: Record<string, unknown> }
	| { ok: false; errors: string[] };

export interface KernelCatalogService extends KernelCatalogAnnotationOps {
	/** Dev-mode write gate: the PUT route answers 403 when false. */
	readonly allowWrites: boolean;
	listAgents(): Promise<KernelCatalogAgentSummary[]>;
	/** null when the agent is not in the registry. */
	getAgentDetail(name: string): Promise<KernelCatalogAgentDetail | null>;
	/** null when the agent is not in the registry. */
	savePrompt(
		name: string,
		document: unknown,
		expectedHash?: string,
	): Promise<KernelCatalogPromptSaveResult | null>;
	/** null when the agent is not in the registry. */
	saveManifest(
		name: string,
		patch: unknown,
	): Promise<KernelCatalogManifestSaveResult | null>;
	/** null when the agent is not in the registry. */
	listRevisions(name: string): Promise<KernelCatalogRevisionSummary[] | null>;
	/** null when the agent or requested revision is not found. */
	getRevisionDocument(
		name: string,
		hash: string,
	): Promise<KernelCatalogRevisionDocument | null>;
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
	/**
	 * Loader catalog used to resolve context.ts declarations for the agent
	 * detail preview — the same catalog the spawn pipeline uses, so preview
	 * and spawn resolve loaders identically. Absent: detail answers with a
	 * context block whose renderedContext is null.
	 */
	contextCatalog?: () => LoaderCatalog;
}

/**
 * Derived prompt markdown content. Re-exported from the single
 * implementation in agent-registry/prompt-snapshot.ts so the lab save path,
 * the regeneration CLI and the catalog snapshot test all emit identical bytes.
 */
export { RENDERED_SNAPSHOT_HEADER, renderedPromptSnapshot };

// Annotation sidecar ops surface (additive; wire results + the ops interface
// mixed into KernelCatalogService above).
export * from "./catalog-annotations";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createKernelCatalogService(
	opts: CreateKernelCatalogServiceOptions,
): KernelCatalogService {
	const allowWrites = opts.allowWrites ?? false;
	const modelAliases = opts.modelAliases ?? (() => []);

	// Revisions + stats live in the db, but the read surface must keep
	// answering (from the cached registry) when no db was configured — the
	// accessor throws in that case, so disk-sync degrades to registry-only.
	function tryDb(): KernelDatabase | null {
		try {
			return opts.db();
		} catch {
			return null;
		}
	}

	/**
	 * Assemble the agent's context.ts against manifest variable defaults and
	 * no session data. Session-dependent loaders resolve "empty"/"error";
	 * assemble() sees placeholder content for those inputs while the reported
	 * input statuses stay true to the build.
	 */
	async function buildContextPreview(
		def: AgentDefinition,
	): Promise<KernelCatalogContextPreview | null> {
		const resolver = def.contextResolver;
		if (!resolver) return null;
		const catalog = opts.contextCatalog?.();
		if (!catalog) {
			return { modulePath: def.contextModulePath, inputs: [], renderedContext: null };
		}

		const variables: Record<string, unknown> = {};
		for (const [name, declaration] of Object.entries(def.manifest.variables)) {
			variables[name] = declaration.default;
		}
		const spawnContext = createSpawnContext({
			agentName: def.name,
			runtime: { cwd: dirname(def.manifestFile) },
			variables,
			caller: { kind: "system", id: "catalog-preview" },
			sessionData: null,
		});
		// Text-only preview: assembleImages is deliberately not forwarded.
		const previewResolver: AgentContextResolver = {
			loaders: resolver.loaders,
			assemble: (loaded, ctx) =>
				resolver.assemble(
					loaded.map((input) =>
						input.status === "ok"
							? input
							: {
									...input,
									content:
										input.status === "error"
											? `(unavailable in preview: ${input.error ?? "loader error"})`
											: "(assembled per spawn from live session data)",
								},
					),
					ctx,
				),
		};

		try {
			const result = await buildContext({
				resolver: previewResolver,
				spawnContext,
				catalog,
				emitter: null,
			});
			return {
				modulePath: def.contextModulePath,
				inputs: result.inputsSummary.map((entry) => ({
					loaderKind: entry.loader_kind,
					inputRef: entry.input_ref,
					status: entry.status,
					bytes: entry.bytes,
				})),
				renderedContext: result.renderedContext,
			};
		} catch {
			// A resolver bug must not take down the detail route — the preview
			// degrades to declaration metadata only.
			return { modulePath: def.contextModulePath, inputs: [], renderedContext: null };
		}
	}

	return {
		allowWrites,

		// Annotation sidecar CRUD (catalog-annotations.ts) — same registry/db
		// accessors, so every op syncs the prompt from disk like the reads above.
		...createCatalogAnnotationOps({ registry: opts.registry, db: opts.db }),

		async listAgents() {
			const registry = await opts.registry();
			// Disk-freshness: a prompt.json rewritten out-of-band must list with
			// its current hash, not the one cached at boot.
			const db = tryDb();
			for (const def of registry.list()) {
				await syncAgentPromptFromDisk(db, registry, def.name);
			}
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
			if (!registry.tryGet(name)) return null;
			const def = await syncAgentPromptFromDisk(tryDb(), registry, name);
			return {
				manifest: def.manifest as unknown as Record<string, unknown>,
				prompt: def.promptDocument,
				promptHash: def.promptHash,
				rendered: def.parsed.body,
				declaredVariables: Object.keys(def.manifest.variables),
				modelAliases: modelAliases(),
				context: await buildContextPreview(def),
			};
		},

		async savePrompt(name, input, expectedHash) {
			const registry = await opts.registry();
			if (!registry.tryGet(name)) return null;
			// Compare against the disk-fresh canonical prompt, not just the
			// registry snapshot captured at boot. This also records an
			// out-of-band edit as a disk-sync revision before reporting the
			// conflict.
			await syncAgentPromptFromDisk(tryDb(), registry, name);
			// Re-read after the await: another save may have completed while
			// this request was syncing its disk snapshot.
			const def = registry.get(name);
			if (expectedHash !== undefined && expectedHash !== def.promptHash) {
				return { ok: false, currentHash: def.promptHash };
			}

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
			// Form-aware: prompt.rendered.md beside a flat prompt.json,
			// prompt/system.md inside a folder-form bundle.
			writeFileSync(def.renderedPromptFile, renderedPromptSnapshot(rendered), "utf8");

			// Hot-swap immediately after the synchronous file writes so another
			// save resuming while the revision upsert is in flight observes this
			// request's hash during its optimistic-concurrency check.
			registry.reloadAgentPrompt(name);

			await upsertPromptRevision(opts.db(), {
				hash,
				agentName: def.name,
				schemaVersion: document.schemaVersion,
				document: canonical,
				renderedText: rendered,
				source: "lab-save",
				createdAt: new Date().toISOString(),
			});

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
			// Disk-freshness: an out-of-band rewrite gets its disk-sync revision
			// row upserted before the history is read.
			await syncAgentPromptFromDisk(tryDb(), registry, name);
			const rows = await listPromptRevisionsForAgent(opts.db(), name);
			return rows
				.map((row) => ({
					hash: row.hash,
					source: row.source,
					createdAt: row.createdAt,
				}))
				.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
		},

		async getRevisionDocument(name, hash) {
			const registry = await opts.registry();
			if (!registry.tryGet(name)) return null;
			await syncAgentPromptFromDisk(tryDb(), registry, name);
			const row = await getPromptRevision(opts.db(), hash);
			if (!row || row.agentName !== name) return null;

			const document: unknown = JSON.parse(row.document);
			const shape = validatePromptDocumentShape(document);
			if (!shape.valid) {
				throw new Error(
					`Stored prompt revision ${hash} is not a valid PromptDocument: ${shape.errors.join("; ")}`,
				);
			}
			return {
				hash: row.hash,
				createdAt: row.createdAt,
				document: document as PromptDocument,
			};
		},

		async getRevisionStats(name, hash) {
			const registry = await opts.registry();
			if (!registry.tryGet(name)) return null;
			return getPromptRevisionStats(opts.db(), hash);
		},
	};
}
