#!/usr/bin/env bun
/**
 * brief.ts — deterministic orientation for kernel agent authoring.
 *
 * From a start directory (default: cwd) walk up to `.agent-kernel/kernel.json`,
 * read its `catalogRoots`, and print — for every bundle, or one named agent —
 *
 *   1. anatomy: which sections exist (prompt / context / tools / state),
 *      in which form (file vs folder), plus shadowed-path warnings;
 *   2. the assembled section ② context: per-loader status and the top-level
 *      block tags of the rendered string;
 *   3. a rendered section ③ state fixture (the `default` fixture when one
 *      exists, else the first by id, else the module's seeded state).
 *
 * The generic catalog (`agent-kernel/catalog/`, resolved relative to this
 * script) is always included as a fallback root; a project bundle with the
 * same name shadows the generic one, mirroring the TUI harness's catalog
 * precedence.
 *
 * Deliberately db-free: only `@agent-kernel/kernel`'s fs-only exports are
 * used (agent-registry, context, state). The ③ recipe mirrors the kernel's
 * private `buildStatePreview` (catalog-service.ts) rebuilt from exported
 * primitives — never import catalog-service, createKernel, or the
 * spawn-pipeline here; they are db-tangled.
 *
 * Usage:
 *   bun scripts/brief.ts                     # orient from cwd, all bundles
 *   bun scripts/brief.ts <start-dir>         # orient from another directory
 *   bun scripts/brief.ts <agent-name>        # one bundle only
 *   bun scripts/brief.ts <start-dir> <agent-name>
 *
 * Exit codes: 0 printed a brief · 2 nothing to orient against (no kernel.json
 * above the start dir and no generic catalog) or unknown agent name.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
	buildRegistry,
	discoverStateFixtures,
	type AgentDefinition,
	type AgentStateFixture,
} from "@agent-kernel/kernel/agent-registry";
import {
	buildContext,
	createDefaultCatalog,
	createSpawnContext,
	inputRefOf,
	type SpawnContext,
} from "@agent-kernel/kernel/context";
import {
	messageText,
	normalizeRenderOutput,
	resolveWindowPolicy,
	type RenderContext,
} from "@agent-kernel/kernel/state";

/** agent-kernel repo root, anchored to this script's location. */
const GENERIC_CATALOG_ROOT = resolve(import.meta.dir, "..", "..", "..", "catalog");

const STATE_PREVIEW_MAX_LINES = 40;

interface KernelManifest {
	kernelId?: string;
	catalogRoots?: string[];
}

interface BundleEntry {
	def: AgentDefinition;
	origin: "project" | "generic";
	/** Generic bundle of the same name hidden by this project bundle. */
	shadows: AgentDefinition | null;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Walk from `startDir` upward to the first `.agent-kernel/kernel.json`. */
function findKernelManifest(startDir: string): string | null {
	let dir = resolve(startDir);
	for (;;) {
		const candidate = join(dir, ".agent-kernel", "kernel.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function readKernelManifest(path: string): KernelManifest {
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`kernel manifest is not an object: ${path}`);
	}
	return parsed as KernelManifest;
}

/** buildRegistry that reports per-agent errors instead of aborting the brief. */
async function loadRoots(roots: string[]): Promise<{
	defs: AgentDefinition[];
	errors: string[];
}> {
	if (roots.length === 0) return { defs: [], errors: [] };
	try {
		const registry = await buildRegistry({ roots });
		return { defs: registry.listAll(), errors: [] };
	} catch (err) {
		if (err instanceof AggregateError) {
			return {
				defs: [],
				errors: err.errors.map((e) => (e instanceof Error ? e.message : String(e))),
			};
		}
		return { defs: [], errors: [err instanceof Error ? err.message : String(err)] };
	}
}

function manifestVariables(def: AgentDefinition): Record<string, unknown> {
	const variables: Record<string, unknown> = {};
	for (const [name, declaration] of Object.entries(def.manifest.variables)) {
		variables[name] = declaration.default;
	}
	return variables;
}

function previewSpawnContext(
	def: AgentDefinition,
	extraVariables: Record<string, unknown> = {},
): SpawnContext {
	return createSpawnContext({
		agentName: def.name,
		runtime: { cwd: def.bundleLayout.dir },
		variables: { ...manifestVariables(def), ...extraVariables },
		caller: { kind: "system", id: "authoring-brief" },
		sessionData: null,
	});
}

function sectionLine(
	label: string,
	entry: AgentDefinition["bundleLayout"]["prompt"],
	bundleDir: string,
): string {
	if (!entry.path) return `  ${label.padEnd(8)}(absent)`;
	const shadow = entry.shadowedPath
		? `  !! shadowed: ${relative(bundleDir, entry.shadowedPath)}`
		: "";
	return `  ${label.padEnd(8)}${entry.form}  ${relative(bundleDir, entry.path)}${shadow}`;
}

/** Top-level `<tag …>` names of an assembled ② string, in appearance order. */
function topLevelTags(rendered: string): string[] {
	const tags: string[] = [];
	for (const line of rendered.split("\n")) {
		// Whole-line opening tags only, so prose like "<bundle>/prompt.json"
		// inside a block body does not count as a block.
		const match = /^<([A-Za-z_][\w-]*)(?: [^>]*)?\/?>$/.exec(line.trim());
		if (match && !tags.includes(match[1])) tags.push(match[1]);
	}
	return tags;
}

function truncateLines(text: string, maxLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	const hidden = lines.length - maxLines;
	return [...lines.slice(0, maxLines), `… (+${hidden} more lines)`].join("\n");
}

function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `${prefix}${line}` : line))
		.join("\n");
}

async function printContextSection(def: AgentDefinition): Promise<void> {
	if (!def.contextResolver) {
		console.log("  ② context: (no context sidecar)");
		return;
	}
	try {
		const result = await buildContext({
			resolver: def.contextResolver,
			catalog: createDefaultCatalog(),
			spawnContext: previewSpawnContext(def),
			emitter: null,
		});
		console.log("  ② context:");
		for (const input of result.loaded) {
			const ref = inputRefOf(input.decl);
			const size = input.status === "ok" ? `  ${input.bytes} B` : "";
			const error = input.error ? `  (${input.error})` : "";
			console.log(`    [${input.status}] ${input.decl.kind} ${ref}${size}${error}`);
		}
		const tags = topLevelTags(result.renderedContext);
		console.log(
			`    assembled: ${result.totalBytes} B` +
				(tags.length > 0 ? `, blocks: <${tags.join("> <")}>` : ""),
		);
		const failed = result.loaded.filter((input) => input.status === "error");
		if (failed.length > 0) {
			console.log(
				"    note: error statuses usually mean app-registered loader kinds;",
			);
			console.log(
				"    those blocks only assemble inside the app's own harness.",
			);
		}
	} catch (err) {
		console.log(
			`  ② context: assemble failed — ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * The ③ preview recipe, rebuilt from exported primitives (the kernel keeps
 * its own copy private in catalog-service.ts): a fixture's `state` IS the
 * previewed state; a fixture without one previews the module's seeded state.
 */
function renderStatePreview(
	def: AgentDefinition,
	fixture: AgentStateFixture | null,
): string {
	const module = def.stateModule;
	if (!module) {
		const value = fixture?.hasState ? fixture.state : null;
		return `<state>\n${JSON.stringify(value, null, 2) ?? "null"}\n</state>`;
	}
	const spawnContext = previewSpawnContext(def, fixture?.variables ?? {});
	const state =
		fixture?.hasState === true
			? (fixture.state as Parameters<typeof module.render>[0])
			: module.seed(spawnContext);
	const renderCtx: RenderContext = {
		agentName: def.name,
		messages: [],
		turnIndex: 0,
		window: resolveWindowPolicy(def.stateConfig?.window ?? module.window ?? null),
	};
	const rendered = normalizeRenderOutput(module.render(state, renderCtx));
	return rendered.messages.map((message) => messageText(message)).join("\n\n");
}

function printStateSection(def: AgentDefinition): void {
	const fixtures = discoverStateFixtures(def.bundleLayout.dir);
	if (!def.stateModule && fixtures.length === 0) {
		console.log("  ③ state: (no state sidecar — section ③ is the base rolling window)");
		return;
	}
	const fixture = fixtures.find((f) => f.id === "default") ?? fixtures[0] ?? null;
	const source = fixture
		? `fixture "${fixture.id}" (${fixture.label})`
		: "seeded state (no fixtures)";
	const available =
		fixtures.length > 0 ? ` — fixtures: ${fixtures.map((f) => f.id).join(", ")}` : "";
	console.log(`  ③ state: ${source}${available}`);
	try {
		const preview = renderStatePreview(def, fixture);
		console.log(indent(truncateLines(preview, STATE_PREVIEW_MAX_LINES), "    | "));
	} catch (err) {
		console.log(
			`    render failed — ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

async function printBundle(entry: BundleEntry): Promise<void> {
	const { def } = entry;
	const layout = def.bundleLayout;
	console.log("");
	console.log(`── ${def.name} ${"─".repeat(Math.max(3, 60 - def.name.length))}`);
	console.log(`  ${def.manifest.description}`);
	const origin =
		entry.origin === "generic" ? "generic catalog" : "project catalog";
	console.log(`  dir: ${layout.dir}  (${origin})`);
	if (entry.shadows) {
		console.log(`  shadows generic bundle at: ${entry.shadows.bundleLayout.dir}`);
	}
	const variableNames = Object.keys(def.manifest.variables);
	console.log(
		`  model: ${def.manifest.model}  thinking: ${def.manifest.thinking ?? "(default)"}` +
			(variableNames.length > 0 ? `  variables: ${variableNames.join(", ")}` : ""),
	);
	console.log(sectionLine("prompt", layout.prompt, layout.dir));
	console.log(sectionLine("context", layout.context, layout.dir));
	console.log(sectionLine("tools", layout.tools, layout.dir));
	console.log(sectionLine("state", layout.state, layout.dir));
	await printContextSection(def);
	printStateSection(def);
}

async function main(argv: string[]): Promise<number> {
	// Arg forms: [start-dir], [agent-name], or [start-dir, agent-name]. A first
	// argument that is an existing directory is the start dir; otherwise it is
	// the agent name.
	let startDir = process.cwd();
	let agentName: string | null = null;
	const args = argv.filter((arg) => arg.length > 0);
	if (args.length > 0) {
		if (isDirectory(args[0])) {
			startDir = resolve(args[0]);
			agentName = args[1] ?? null;
		} else {
			agentName = args[0];
		}
	}

	const manifestPath = findKernelManifest(startDir);
	let projectRoots: string[] = [];
	if (manifestPath) {
		const manifest = readKernelManifest(manifestPath);
		console.log(`kernel: ${manifest.kernelId ?? "(unnamed)"}  (${manifestPath})`);
		for (const root of manifest.catalogRoots ?? []) {
			if (isDirectory(root)) projectRoots.push(root);
			else console.log(`  !! catalogRoot missing on disk: ${root}`);
		}
	} else {
		console.log(`no .agent-kernel/kernel.json at or above ${startDir}`);
	}

	const hasGeneric =
		isDirectory(GENERIC_CATALOG_ROOT) && !projectRoots.includes(GENERIC_CATALOG_ROOT);
	if (!manifestPath && !hasGeneric) {
		console.error("nothing to orient against: no kernel manifest and no generic catalog");
		return 2;
	}
	console.log(`catalog roots (project first, then generic):`);
	for (const root of projectRoots) console.log(`  - ${root}`);
	if (hasGeneric) console.log(`  - ${GENERIC_CATALOG_ROOT}  (generic)`);

	const project = await loadRoots(projectRoots);
	const generic = hasGeneric ? await loadRoots([GENERIC_CATALOG_ROOT]) : { defs: [], errors: [] };
	for (const error of [...project.errors, ...generic.errors]) {
		console.log(`  !! registry error: ${error}`);
	}

	// Project-first precedence: a project bundle shadows a generic one of the
	// same name (the TUI harness's specialization mechanism).
	const merged = new Map<string, BundleEntry>();
	for (const def of project.defs) {
		merged.set(def.name, { def, origin: "project", shadows: null });
	}
	for (const def of generic.defs) {
		const existing = merged.get(def.name);
		if (existing) existing.shadows = def;
		else merged.set(def.name, { def, origin: "generic", shadows: null });
	}

	let entries = [...merged.values()].sort((a, b) => a.def.name.localeCompare(b.def.name));
	if (agentName) {
		entries = entries.filter((entry) => entry.def.name === agentName);
		if (entries.length === 0) {
			console.error(
				`unknown agent "${agentName}" — bundles: ${[...merged.keys()].sort().join(", ") || "(none)"}`,
			);
			return 2;
		}
	}
	if (entries.length === 0) {
		console.log("no agent bundles found under the catalog roots");
		return 0;
	}

	for (const entry of entries) await printBundle(entry);
	return 0;
}

process.exit(await main(process.argv.slice(2)));
