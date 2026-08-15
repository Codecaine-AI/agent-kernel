/**
 * commands.ts — the /kernel interaction surface.
 *
 *   /kernel                interactive agent selector (TUI); plain list in
 *                          non-interactive contexts (RPC, -p)
 *   /kernel <name>         boot a bundle into the current session
 *   /kernel <name> --fixture <id>
 *                          seed ③ from a named state fixture
 *
 * Booting assembles ① ② ③ once and caches the result; before_agent_start
 * returns the cached prompt every turn, replacing pi's chained system prompt
 * for the session. Booting another agent replaces the cached prompt (already
 * registered tools from the previous bundle stay for the session).
 *
 * Host gate: `host: "app"` bundles (the default) are classified from their
 * manifest and never evaluated or booted here; `host: "any"` bundles that
 * fail to load surface with a one-line reason (catalog.ts isolation).
 */

import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

import { bootAgent, type BootedAgent } from "./boot";
import {
	listAgentsDetailed,
	resolveAgentDetailed,
	type AgentListing,
	type CatalogSource,
} from "./catalog";
import {
	buildSessionBindingMarkers,
	SESSION_BINDING_CUSTOM_TYPE,
	TUI_SESSION_META_CUSTOM_TYPE,
} from "./session-binding";
import { bindBundleTools } from "./tools";

function parseAgentArgs(args: string): {
	name: string | null;
	fixtureId: string | undefined;
} {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	let name: string | null = null;
	let fixtureId: string | undefined;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] === "--fixture") {
			fixtureId = tokens[++i];
		} else if (!name) {
			name = tokens[i];
		}
	}
	return { name, fixtureId };
}

function truncate(text: string, max: number): string {
	const oneLine = text.split("\n")[0];
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

type EntryKind = "bootable" | "app-harness" | "unavailable";

interface SelectorEntry {
	name: string;
	source: CatalogSource;
	kind: EntryKind;
	description: string;
	reason: string | null;
}

/** Selector order: project before generic, bootable first within each. */
function selectorEntries(listing: AgentListing): SelectorEntry[] {
	const kindRank: Record<EntryKind, number> = {
		bootable: 0,
		"app-harness": 1,
		unavailable: 2,
	};
	const entries: SelectorEntry[] = [
		...listing.agents.map<SelectorEntry>((agent) => ({
			name: agent.name,
			source: agent.source,
			kind: "bootable",
			description: agent.description,
			reason: null,
		})),
		...listing.appHosted.map<SelectorEntry>((bundle) => ({
			name: bundle.name,
			source: bundle.source,
			kind: "app-harness",
			description: bundle.description,
			reason: "boot it through its app harness, not the TUI",
		})),
		...listing.unavailable.map<SelectorEntry>((bundle) => ({
			name: bundle.name,
			source: bundle.source,
			kind: "unavailable",
			description: "",
			reason: bundle.reason,
		})),
	];
	return entries.sort(
		(a, b) =>
			(a.source === b.source ? 0 : a.source === "project" ? -1 : 1) ||
			kindRank[a.kind] - kindRank[b.kind] ||
			a.name.localeCompare(b.name),
	);
}

function plainListLines(listing: AgentListing): string[] {
	return [
		"Agents:",
		...listing.agents.map(
			(agent) => `  ${agent.name} (${agent.source}) — ${agent.description}`,
		),
		...listing.appHosted.map(
			(bundle) =>
				`  ${bundle.name} (${bundle.source}) — app-harness agent (runs in its owning harness)`,
		),
		...listing.unavailable.map(
			(bundle) => `  ${bundle.name} (${bundle.source}) — ${bundle.reason}`,
		),
		...listing.warnings.map((warning) => `warning: ${warning}`),
	];
}

/** Table row: a section header or a selectable agent entry. */
type TableRow = { header: string } | { entry: SelectorEntry };

function tableRows(entries: SelectorEntry[]): TableRow[] {
	const rows: TableRow[] = [];
	for (const source of ["project", "generic"] as const) {
		const group = entries.filter((entry) => entry.source === source);
		if (group.length === 0) continue;
		rows.push({ header: source.toUpperCase() });
		for (const entry of group) rows.push({ entry });
	}
	return rows;
}

// Status colors are deliberately NOT theme colors: several themes render
// `success` and `warning` as near-identical olives, which made ready and
// app-only indistinguishable. Runnable must be unmistakably bright green;
// broken bright red; not-runnable-here stays dim so it reads as inert.
const brightGreen = (s: string) => `\x1b[92m${s}\x1b[39m`;
const brightRed = (s: string) => `\x1b[91m${s}\x1b[39m`;

const STATUS: Record<
	EntryKind,
	{ glyph: string; label: string; paint: (theme: any, s: string) => string }
> = {
	bootable: { glyph: "●", label: "ready", paint: (_theme, s) => brightGreen(s) },
	"app-harness": {
		glyph: "⊘",
		label: "can't run in TUI",
		paint: (theme, s) => theme.fg("dim", s),
	},
	unavailable: { glyph: "✕", label: "failed to load", paint: (_theme, s) => brightRed(s) },
};

/**
 * Open the agent table over the listing. Resolves with the picked entry, or
 * null on Esc. Custom component (not SelectList) so rows render as aligned,
 * per-status-colored columns under PROJECT/GENERIC section headers.
 * Theme-change safe: every render composes colors fresh; nothing is cached.
 */
/** Greedy word-wrap for the Tab detail panel; plain text in, lines out. */
function wrapText(text: string, width: number, maxLines: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			if (lines.length === maxLines) return lines;
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) lines.push(line);
	return lines.slice(0, maxLines);
}

async function pickAgent(
	ctx: ExtensionCommandContext,
	listing: AgentListing,
): Promise<SelectorEntry | null> {
	const entries = selectorEntries(listing);
	const rows = tableRows(entries);
	// Only runnable rows are selectable — app-only/failed rows are informational.
	const selectable = rows.flatMap((row, i) =>
		"entry" in row && row.entry.kind === "bootable" ? [i] : [],
	);
	// Columns: marker(2) + name + runnable-status. Description lives behind Tab.
	const nameW = Math.max(...entries.map((entry) => entry.name.length)) + 2;
	const statusW =
		Math.max(...Object.values(STATUS).map((s) => s.glyph.length + 1 + s.label.length)) + 2;

	const picked = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		let sel = 0; // index into `selectable`
		let showDetail = false;
		const selectedEntry = (): SelectorEntry | null => {
			const row = rows[selectable[sel] ?? -1];
			return row && "entry" in row ? row.entry : null;
		};

		const entryLine = (entry: SelectorEntry, selected: boolean, w: number): string => {
			const status = STATUS[entry.kind];
			const bootable = entry.kind === "bootable";
			const marker = selected ? theme.fg("accent", "▸ ") : "  ";
			const name = selected
				? theme.bold(theme.fg("accent", entry.name.padEnd(nameW)))
				: theme.fg(bootable ? "text" : "dim", entry.name.padEnd(nameW));
			const badge = status.paint(theme, `${status.glyph} ${status.label}`.padEnd(statusW));
			// Non-selectable rows get their why-not as a dim trailing note.
			const note = bootable
				? ""
				: theme.fg("dim", truncate(entry.reason ?? "", Math.max(0, w - 4 - nameW - statusW)));
			return ` ${marker}${name}${badge}${note}`;
		};

		const table = {
			render: (w: number): string[] =>
				rows.flatMap((row, i) => {
					if ("header" in row) {
						const line = theme.bold(theme.fg("muted", `   ${row.header}`));
						return i === 0 ? [line] : ["", line];
					}
					return [entryLine(row.entry, selectable[sel] === i, w)];
				}),
			invalidate: () => {},
		};

		// Tab detail panel: full description of the selected agent.
		const detail = {
			render: (w: number): string[] => {
				const entry = selectedEntry();
				if (!showDetail || !entry) return [];
				const body = entry.description || "(no description)";
				return [
					"",
					theme.fg("muted", `   ${theme.bold(entry.name)} (${entry.source})`),
					...wrapText(body, Math.max(20, w - 6), 4).map((line) =>
						theme.fg("dim", `   ${line}`),
					),
				];
			},
			invalidate: () => {},
		};

		const footer = {
			render: (): string[] => {
				const hints =
					selectable.length === 0
						? "esc close"
						: `↑↓ move · enter boot · tab ${showDetail ? "hide" : "details"} · esc close`;
				return ["", theme.fg("dim", ` ${hints}`)];
			},
			invalidate: () => {},
		};

		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
		container.addChild(
			new Text(theme.fg("accent", theme.bold(" Agent bundles ")), 1, 0),
		);
		container.addChild(table);
		container.addChild(detail);
		container.addChild(footer);
		// Layer-level degradations as a dim annotation, not a warning notify.
		for (const warning of listing.warnings) {
			container.addChild(new Text(theme.fg("dim", `⚠ ${truncate(warning, 120)}`), 1, 0));
		}
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				const move = (d: number) => {
					if (selectable.length === 0) return;
					sel = (sel + d + selectable.length) % selectable.length;
				};
				if (data === "\x1b[A" || data === "k") move(-1);
				else if (data === "\x1b[B" || data === "j") move(1);
				else if (data === "\t") showDetail = !showDetail;
				else if (data === "\r" || data === "\n") {
					const entry = selectedEntry();
					if (entry) done(entry.name);
				} else if (data === "\x1b") done(null);
				tui.requestRender();
			},
		};
	});

	return picked ? (entries.find((entry) => entry.name === picked) ?? null) : null;
}

export function registerAgentCommands(pi: ExtensionAPI): void {
	// The one piece of session state: the active boot. Kept in this closure so
	// the command and the before_agent_start hook share it.
	let active: BootedAgent | null = null;
	// Manifest tool policy of the active bundle. Interactive pi sessions keep
	// their built-in tools (the spawn pipeline's tool scoping never runs), so
	// `disallowedTools` is enforced here by blocking — reads stay available,
	// mutations route through the bundle's own tools.
	let activeDisallowed: ReadonlySet<string> = new Set();
	let activeName = "";

	pi.on("before_agent_start", () => {
		if (!active) return;
		// PHASE 2 SEAM (state-loop.ts): re-render ③ here each turn — rebuild
		// sections.state from the live transcript via the bundle's state module
		// and return assembleSystemPrompt(sections) instead of the cached copy.
		return { systemPrompt: active.systemPrompt };
	});

	pi.on("tool_call", (event: { toolName: string }) => {
		if (!activeDisallowed.has(event.toolName)) return;
		return {
			block: true,
			reason:
				`${event.toolName} is disabled while ${activeName} is active ` +
				"(manifest disallowedTools). Make changes through the agent's " +
				"bundle tools; reading is unrestricted.",
		};
	});

	async function bootByName(
		ctx: ExtensionCommandContext,
		name: string,
		fixtureId: string | undefined,
	): Promise<void> {
		const resolved = await resolveAgentDetailed(name, ctx.cwd);
		if (resolved.status === "app-hosted") {
			ctx.ui.notify(`${name} (${resolved.source}) — ${resolved.reason}`, "info");
			return;
		}
		if (resolved.status === "unavailable") {
			ctx.ui.notify(`${name} (${resolved.source}) — ${resolved.reason}`, "error");
			return;
		}
		if (resolved.status === "not-found") {
			ctx.ui.notify(
				`No agent bundle named "${name}". Run /kernel to list what resolves from here.`,
				"error",
			);
			return;
		}

		const booted = await bootAgent(resolved.def, resolved.source, {
			cwd: ctx.cwd,
			fixtureId,
		});
		const tools = await bindBundleTools(pi, resolved.def);
		active = booted;
		activeName = booted.name;
		activeDisallowed = new Set(resolved.def.manifest.disallowedTools);

		// Make the session's JSONL kernel-traceable: the binding marker gives
		// transcript-recovery its container/run identity; the meta marker gives
		// the ingest CLI the target kernel root (ownership: cwd's repo) plus the
		// identity-row fields. Re-booting appends a fresh binding — the mapper
		// binds subsequent events to the latest marker.
		const markers = buildSessionBindingMarkers({
			agentName: booted.name,
			source: booted.source,
			cwd: ctx.cwd,
		});
		pi.appendEntry(SESSION_BINDING_CUSTOM_TYPE, markers.binding);
		pi.appendEntry(TUI_SESSION_META_CUSTOM_TYPE, markers.meta);

		const lines = [
			`Booted ${booted.name} (${booted.source}) — system prompt ${booted.systemPrompt.length} chars`,
			booted.fixtureId ? `state fixture: ${booted.fixtureId}` : null,
			tools.toolNames.length > 0 ? `tools: ${tools.toolNames.join(", ")}` : null,
			activeDisallowed.size > 0
				? `built-ins disabled: ${[...activeDisallowed].join(", ")} (manifest disallowedTools)`
				: null,
			tools.notice,
			...booted.warnings.map((warning) => `warning: ${warning}`),
		].filter((line): line is string => line != null);
		ctx.ui.notify(lines.join("\n"), "info");
		if (ctx.hasUI) ctx.ui.setStatus("agent-kernel", `agent: ${booted.name}`);
	}

	pi.registerCommand("kernel", {
		description:
			"Boot an agent-kernel bundle into this session (/kernel opens the agent picker)",
		handler: async (args, ctx) => {
			const { name, fixtureId } = parseAgentArgs(args ?? "");

			if (name) {
				await bootByName(ctx, name, fixtureId);
				return;
			}

			const listing = await listAgentsDetailed(ctx.cwd);
			const empty =
				listing.agents.length === 0 &&
				listing.appHosted.length === 0 &&
				listing.unavailable.length === 0;
			if (empty) {
				ctx.ui.notify(
					[
						"No agent bundles resolvable from this directory.",
						...listing.warnings.map((warning) => `warning: ${warning}`),
					].join("\n"),
					listing.warnings.length > 0 ? "warning" : "info",
				);
				return;
			}

			// Non-interactive contexts (RPC, -p): plain text, info severity —
			// degradations stay per-line prefixed instead of painting the block.
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify(
					plainListLines(listing).join("\n"),
					listing.warnings.length > 0 ? "warning" : "info",
				);
				return;
			}

			const entry = await pickAgent(ctx, listing);
			if (!entry) return;
			if (entry.kind === "bootable") {
				await bootByName(ctx, entry.name, undefined);
			} else {
				ctx.ui.notify(
					`${entry.name} (${entry.source}) — ${entry.reason}`,
					entry.kind === "app-harness" ? "info" : "error",
				);
			}
		},
	});
}
