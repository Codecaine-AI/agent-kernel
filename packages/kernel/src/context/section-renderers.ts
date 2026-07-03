/**
 * assemble-helpers.ts — Shared render helpers for v2 agent context resolvers.
 *
 * Every migrated agent's assemble() composes three pure helpers:
 *   - renderSessionMeta(ctx)    — `<session-meta>…</session-meta>` bullets
 *   - renderPriorSessions(ctx)  — `<prior-sessions>\n<prior-session id="…">…</prior-session>\n…\n</prior-sessions>`
 *   - renderLoadedSection(li)   — `<loaded kind="…" ref="…">…</loaded>` / `<loader-error …>` block
 * plus composeAssembled(sections) which filters empty strings and joins with
 * `\n\n`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { inputRefOf } from "./types";
import type { LoadedInput, SpawnContext } from "./types";

export function renderSessionMeta(ctx: SpawnContext): string {
	const r = ctx.runtime;
	const lines = [
		"<session-meta>",
		`- **Container**: \`${r.containerId ?? ""}\``,
		`- **Topic**: ${r.topic}`,
		`- **Phase**: ${r.phase}`,
		`- **Status**: ${r.status}`,
		`- **Session directory**: ${r.sessionDir}`,
		"</session-meta>",
	];
	return lines.join("\n");
}

export function renderPriorSessions(ctx: SpawnContext): string {
	const priors = ctx.runtime.priorSessions ?? [];
	if (!priors.length || !ctx.paths.priorSessionsDir) return "";

	const blocks: string[] = [];
	for (const priorId of priors) {
		const specPath = join(
			ctx.paths.priorSessionsDir,
			priorId,
			"spec.md",
		);
		if (!existsSync(specPath)) continue;
		const body = readFileSync(specPath, "utf-8").trim();
		if (!body) continue;
		blocks.push(`<prior-session id="${priorId}">\n${body}\n</prior-session>`);
	}
	if (!blocks.length) return "";
	return `<prior-sessions>\n${blocks.join("\n\n")}\n</prior-sessions>`;
}

export function renderLoadedSection(li: LoadedInput): string {
	const ref = inputRefOf(li.decl);
	if (li.status === "ok") {
		return `<loaded kind="${li.decl.kind}" ref="${ref}">\n${li.content}\n</loaded>`;
	}
	if (li.status === "error") {
		return `<loader-error kind="${li.decl.kind}" ref="${ref}">${li.error ?? ""}</loader-error>`;
	}
	return "";
}

export function composeAssembled(sections: string[]): string {
	return sections.filter((s) => s && s.length > 0).join("\n\n");
}
