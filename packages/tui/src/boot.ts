/**
 * boot.ts — thin spawn: assemble ① ② ③ from a bundle using only the db-free
 * kernel exports (agent-registry, context, state).
 *
 * The full spawn-pipeline is db-tangled; this reproduces its two private
 * recipes from exported primitives instead of importing it:
 *   - ① variable substitution mirrors
 *     spawn-pipeline/system-prompt-resolver/resolve-system-prompt.ts, except
 *     an unresolved placeholder degrades to a warning (interactive session)
 *     instead of throwing.
 *   - ③ mirrors catalog-service.ts buildStatePreview: fixture state (or
 *     module.seed) → module.render → normalizeRenderOutput, with the
 *     pseudo-XML pretty-print as the degradation path.
 *
 * Assembled output: systemPrompt = ① prompt render + ② context sections + ③
 * rendered state, joined with blank lines. ② and ③ keep whatever tags the
 * bundle's own assemble()/render() emit; ② is wrapped in a <context> block to
 * mirror the kernel's context-message section boundary.
 */

import { dirname } from "node:path";

// db-free sub-barrel — the parent agent-registry barrel pulls @agent-kernel/db
// (bun:sqlite), which does not load under pi's Node runtime.
import {
	discoverStateFixtures,
	type AgentDefinition,
	type AgentStateFixture,
} from "@agent-kernel/kernel/agent-registry/registry";
import {
	buildContext,
	createDefaultCatalog,
	createSpawnContext,
	type SpawnContext,
} from "@agent-kernel/kernel/context";
import {
	messageText,
	normalizeRenderOutput,
	resolveWindowPolicy,
	type RenderContext,
} from "@agent-kernel/kernel/state";

import type { CatalogSource } from "./catalog";

export interface BootOptions {
	cwd: string;
	/** Caller overrides layered over manifest variable defaults. */
	variables?: Record<string, unknown>;
	/**
	 * Boot ③ from a named `state/fixtures/<id>.json` instead of module.seed.
	 * With no state module, a fixture pretty-prints as the pseudo-XML fallback.
	 */
	fixtureId?: string;
}

export interface BootedSections {
	/** ① prompt render with variables substituted. */
	prompt: string;
	/** ② assembled context, or null when the bundle has no context sidecar. */
	context: string | null;
	/** ③ rendered state, or null for a base agent booted without a fixture. */
	state: string | null;
}

export interface BootedAgent {
	name: string;
	source: CatalogSource;
	def: AgentDefinition;
	/** The full assembled system prompt (① + ② + ③). */
	systemPrompt: string;
	sections: BootedSections;
	fixtures: AgentStateFixture[];
	/** The fixture that seeded ③, when one did. */
	fixtureId: string | null;
	warnings: string[];
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function substitutePrompt(
	body: string,
	map: Record<string, string>,
	warnings: string[],
): string {
	const substituted = body.replace(PLACEHOLDER, (full, key: string) =>
		key in map ? map[key] : full,
	);
	const leftovers = new Set<string>();
	for (const m of substituted.matchAll(PLACEHOLDER)) leftovers.add(m[1]);
	if (leftovers.size > 0) {
		warnings.push(
			`unresolved prompt placeholders left verbatim: ${[...leftovers].sort().join(", ")}`,
		);
	}
	return substituted.trim();
}

function resolveBootVariables(
	def: AgentDefinition,
	overrides: Record<string, unknown>,
): Record<string, unknown> {
	const variables: Record<string, unknown> = {};
	for (const [name, declaration] of Object.entries(def.manifest.variables)) {
		variables[name] = declaration.default;
	}
	Object.assign(variables, overrides);
	return variables;
}

function bootSpawnContext(
	def: AgentDefinition,
	cwd: string,
	variables: Record<string, unknown>,
): SpawnContext {
	return createSpawnContext({
		agentName: def.name,
		runtime: { cwd, platform: process.platform },
		variables,
		caller: { kind: "system", id: "tui-boot" },
		cwd,
		sessionData: null,
	});
}

async function renderContextSection(
	def: AgentDefinition,
	spawnContext: SpawnContext,
	warnings: string[],
): Promise<string | null> {
	const resolver = def.contextResolver;
	if (!resolver) return null;
	try {
		const result = await buildContext({
			resolver,
			spawnContext,
			catalog: createDefaultCatalog(),
			emitter: null,
		});
		for (const input of result.inputsSummary) {
			if (input.status === "error") {
				warnings.push(
					`context input failed: ${input.loader_kind} ${input.input_ref}`,
				);
			}
		}
		return `<context>\n${result.renderedContext}\n</context>`;
	} catch (err) {
		// A resolver bug must not stop the boot — ② degrades to absent.
		warnings.push(
			`context assembly failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

function fallbackStateSection(fixture: AgentStateFixture): string {
	const value = fixture.hasState ? fixture.state : null;
	return `<state>\n${JSON.stringify(value, null, 2) ?? "null"}\n</state>`;
}

function renderStateSection(
	def: AgentDefinition,
	fixture: AgentStateFixture | null,
	spawnContext: SpawnContext,
	warnings: string[],
): string | null {
	const module = def.stateModule;
	if (!module) {
		// Base agent: its state is its messages. A fixture still previews as
		// the pseudo-XML fallback when explicitly requested.
		return fixture ? fallbackStateSection(fixture) : null;
	}
	try {
		const state =
			fixture && fixture.hasState
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
	} catch (err) {
		warnings.push(
			`state render failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return fixture ? fallbackStateSection(fixture) : null;
	}
}

export function assembleSystemPrompt(sections: BootedSections): string {
	return [sections.prompt, sections.context, sections.state]
		.filter((section): section is string => section != null && section.length > 0)
		.join("\n\n");
}

export async function bootAgent(
	def: AgentDefinition,
	source: CatalogSource,
	opts: BootOptions,
): Promise<BootedAgent> {
	const warnings: string[] = [];
	const fixtures = discoverStateFixtures(def.bundleLayout.dir);

	let fixture: AgentStateFixture | null = null;
	if (opts.fixtureId) {
		fixture = fixtures.find((f) => f.id === opts.fixtureId) ?? null;
		if (!fixture) {
			warnings.push(
				`fixture "${opts.fixtureId}" not found (available: ${
					fixtures.map((f) => f.id).join(", ") || "none"
				})`,
			);
		}
	}

	const variables = resolveBootVariables(def, {
		...fixture?.variables,
		...opts.variables,
	});
	// ① substitutes against manifest defaults + runtime like the spawn
	// pipeline: cwd/platform first, declared variables win on collision.
	const substitutionMap: Record<string, string> = {
		cwd: opts.cwd,
		platform: process.platform,
	};
	for (const [key, value] of Object.entries(variables)) {
		substitutionMap[key] = value == null ? "" : String(value);
	}

	const spawnContext = bootSpawnContext(def, opts.cwd, variables);
	const sections: BootedSections = {
		prompt: substitutePrompt(def.parsed.body, substitutionMap, warnings),
		context: await renderContextSection(def, spawnContext, warnings),
		state: renderStateSection(def, fixture, spawnContext, warnings),
	};

	return {
		name: def.name,
		source,
		def,
		systemPrompt: assembleSystemPrompt(sections),
		sections,
		fixtures,
		fixtureId: fixture?.id ?? null,
		warnings,
	};
}
