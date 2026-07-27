import type { PromptDocument } from "@codecaine-ai/prompt-kit";

import type { ParsedAgent } from "../../spawn-pipeline/types";
import type {
	AgentPrivateTools,
	AgentStateConfig,
	NormalizedAgentManifest,
} from "../../agent-definition";
import type { AgentContextResolver } from "../../context";
import type { StateModule } from "../../state/types";
import type { AgentBundleLayout } from "./bundle-layout";

export interface AgentDefinition {
	name: string;
	/** Runtime config + rendered prompt template (variables unsubstituted). */
	parsed: ParsedAgent;
	/** The validated, normalized agent.json contents (D76). */
	manifest: NormalizedAgentManifest;
	/** Canonical prompt document loaded from the sibling prompt.json. */
	promptDocument: PromptDocument;
	/** Content address of the prompt: "pk1-" + sha256(canonical bytes). */
	promptHash: string;
	/**
	 * Absolute path of the prompt.json the document was loaded from —
	 * `<bundle>/prompt.json` (file form) or `<bundle>/prompt/prompt.json`
	 * (folder form).
	 */
	promptFile: string;
	/**
	 * Absolute path of the generated markdown render of promptFile:
	 * `<bundle>/prompt.rendered.md` in file form, `<bundle>/prompt/system.md`
	 * in folder form. Never read by the registry — the write path uses it.
	 */
	renderedPromptFile: string;
	/** mtimeMs of promptFile when the document was read (disk-freshness check). */
	promptFileMtimeMs: number;
	/**
	 * Which form each bundle section resolved to (file vs folder), plus any
	 * shadowed path when both forms exist. Reported by doctor and the viewer.
	 */
	bundleLayout: AgentBundleLayout;
	/** Context sidecar (context.ts | context/index.ts), attached by convention. */
	contextResolver: AgentContextResolver | null;
	contextModulePath: string | null;
	/** Tools sidecar (tools.ts | tools/index.ts), attached by convention. */
	privateTools: AgentPrivateTools | null;
	privateToolNames: string[];
	/** Harvested spawner declarations: tool name → `spawns` allowlist (D77). */
	spawnerTools: Record<string, string[]>;
	toolsModulePath: string | null;
	/**
	 * State sidecar (state.ts | state/index.ts), attached by convention. null
	 * keeps the agent on base behavior — its state is its messages.
	 */
	stateModule: StateModule | null;
	stateModulePath: string | null;
	/** The manifest's `state` block (window policy), or null when absent. */
	stateConfig: AgentStateConfig | null;
	coreTools: string[];
	/** Absolute path of the agent.json manifest. */
	manifestFile: string;
	warnings: string[];
}

export interface AgentRegistry {
	get(name: string): AgentDefinition;
	tryGet(name: string): AgentDefinition | null;
	list(): AgentDefinition[];
	roots(): string[];
	/**
	 * Re-read an agent's prompt.json from disk, re-validate it against the
	 * cached manifest, and hot-swap the registry entry (Phase 5 lab save).
	 * The manifest and code sidecars are untouched; subsequent spawns render
	 * and stamp the new prompt revision without a process restart. Throws
	 * RegistryError when the on-disk document fails validation.
	 */
	reloadAgentPrompt(name: string): AgentDefinition;
	/**
	 * Cheap disk-freshness check for an agent's prompt.json: stat the file and,
	 * when its mtime differs from the cached read, re-validate + hot-swap the
	 * entry exactly like reloadAgentPrompt. A formatting-only rewrite (same
	 * canonical hash) refreshes the cached mtime without swapping. A file that
	 * fails to stat or validate (e.g. a mid-edit half-written document) leaves
	 * the cached entry untouched — including its mtime, so the next call
	 * retries — and reports the failure as `error` instead of throwing.
	 * Throws only for a name that is not in the registry, like get().
	 */
	refreshAgentPromptFromDisk(name: string): {
		def: AgentDefinition;
		changed: boolean;
		error: RegistryError | null;
	};
	/**
	 * Re-read an agent's agent.json from disk, re-normalize + re-validate it
	 * (schema shape, tool-profile expansion, spawner-target constraints), and
	 * hot-swap the registry entry keeping the loaded prompt/context/tools
	 * bindings (Phase 5 manifest edit). Throws RegistryError when the on-disk
	 * manifest fails validation, leaving the cached entry intact.
	 */
	reloadAgentManifest(name: string): AgentDefinition;
}

export class RegistryError extends Error {
	readonly agentFile: string;
	readonly violations: string[];

	constructor(agentFile: string, violations: string[]) {
		super(
			`Agent validation failed: ${agentFile}\n  - ${violations.join("\n  - ")}`,
		);
		this.name = "RegistryError";
		this.agentFile = agentFile;
		this.violations = violations;
	}
}
