/**
 * Trace doctor — executable linkage-invariant checker for one kernel database.
 *
 * Implements invariants 1-7 from docs/10-system-design/15-identity-model.md:
 *
 *   1. Every trace_events.container_id exists in containers
 *   2. Every agent_runs.container_id and .pi_session_id resolve
 *   3. Every child session's parent_session_id resolves and carries
 *      parent_tool_use_id
 *   4. Every run reaches a terminal status, or its session is still active
 *   5. Every tool_call_start has a matching end, or its run ended abnormally
 *   6. The container tree has no cycles; every container has a kind
 *   7. Every trace_events.run_id resolves to an existing run
 *   8. Usage consistency: the sum of run usage per session equals the
 *      session rollup, and the sum per container equals the container
 *      rollup. Rows written before Phase 2 carry all-zero usage on both
 *      sides and pass trivially.
 */

import { relative } from "node:path";

import {
	agentRuns,
	containers,
	piAgentSessions,
	traceEvents,
	type KernelDatabase,
} from "@agent-kernel/db";

import {
	bundleSections,
	collectBundleDirs,
	resolveBundleLayout,
	type BundleEntryForm,
	type BundleSection,
} from "./agent-registry/registry/bundle-layout";

const SAMPLE_LIMIT = 10;

export interface DoctorViolation {
	invariant: number;
	name: string;
	description: string;
	count: number;
	/** Up to 10 offending row ids (event/run/session/container ids). */
	sampleIds: string[];
}

export interface DoctorSkippedCheck {
	invariant: number;
	reason: string;
}

export interface DoctorReport {
	checkedAt: string;
	counts: {
		containers: number;
		piAgentSessions: number;
		agentRuns: number;
		traceEvents: number;
	};
	violations: DoctorViolation[];
	skipped: DoctorSkippedCheck[];
	ok: boolean;
}

const TERMINAL_RUN_STATUSES = new Set(["done", "error", "aborted", "turn-limit"]);
const ABNORMAL_RUN_STATUSES = new Set(["error", "aborted", "turn-limit"]);

interface ViolationCollector {
	invariant: number;
	name: string;
	description: string;
	ids: string[];
}

function collect(
	violations: DoctorViolation[],
	collector: ViolationCollector,
): void {
	if (collector.ids.length === 0) return;
	violations.push({
		invariant: collector.invariant,
		name: collector.name,
		description: collector.description,
		count: collector.ids.length,
		sampleIds: collector.ids.slice(0, SAMPLE_LIMIT),
	});
}

export async function runTraceDoctor(db: KernelDatabase): Promise<DoctorReport> {
	const containerRows = await db
		.select({
			id: containers.id,
			kind: containers.kind,
			parentContainerId: containers.parentContainerId,
			usageInputTokens: containers.usageInputTokens,
			usageOutputTokens: containers.usageOutputTokens,
			usageCacheRead: containers.usageCacheRead,
			usageCacheWrite: containers.usageCacheWrite,
			usageCostEstimate: containers.usageCostEstimate,
		})
		.from(containers);
	const sessionRows = await db
		.select({
			id: piAgentSessions.id,
			parentSessionId: piAgentSessions.parentSessionId,
			parentToolUseId: piAgentSessions.parentToolUseId,
			status: piAgentSessions.status,
			usageInputTokens: piAgentSessions.usageInputTokens,
			usageOutputTokens: piAgentSessions.usageOutputTokens,
		})
		.from(piAgentSessions);
	const runRows = await db
		.select({
			id: agentRuns.id,
			containerId: agentRuns.containerId,
			piSessionId: agentRuns.piSessionId,
			status: agentRuns.status,
			usageInputTokens: agentRuns.usageInputTokens,
			usageOutputTokens: agentRuns.usageOutputTokens,
			usageCacheRead: agentRuns.usageCacheRead,
			usageCacheWrite: agentRuns.usageCacheWrite,
			usageCostEstimate: agentRuns.usageCostEstimate,
		})
		.from(agentRuns);
	const eventRows = await db
		.select({
			eventId: traceEvents.eventId,
			containerId: traceEvents.containerId,
			runId: traceEvents.runId,
			type: traceEvents.type,
			eventData: traceEvents.eventData,
		})
		.from(traceEvents);

	const containerIds = new Set(containerRows.map((c) => c.id));
	const sessionById = new Map(sessionRows.map((s) => [s.id, s]));
	const runById = new Map(runRows.map((r) => [r.id, r]));

	const violations: DoctorViolation[] = [];

	// 1. Every trace_events.container_id exists in containers.
	collect(violations, {
		invariant: 1,
		name: "event-container-resolves",
		description: "trace_events.container_id must exist in containers",
		ids: eventRows
			.filter((e) => !containerIds.has(e.containerId))
			.map((e) => e.eventId),
	});

	// 2. Every agent_runs.container_id and .pi_session_id resolve.
	collect(violations, {
		invariant: 2,
		name: "run-linkage-resolves",
		description: "agent_runs.container_id and .pi_session_id must resolve",
		ids: runRows
			.filter(
				(r) => !containerIds.has(r.containerId) || !sessionById.has(r.piSessionId),
			)
			.map((r) => r.id),
	});

	// 3. Child sessions: parent resolves and parent_tool_use_id is carried.
	collect(violations, {
		invariant: 3,
		name: "child-session-linkage",
		description:
			"child pi_agent_sessions.parent_session_id must resolve and carry parent_tool_use_id",
		ids: sessionRows
			.filter(
				(s) =>
					s.parentSessionId != null &&
					(!sessionById.has(s.parentSessionId) || !s.parentToolUseId),
			)
			.map((s) => s.id),
	});

	// 4. Every run reaches a terminal status, or its session is still active.
	collect(violations, {
		invariant: 4,
		name: "run-terminal-or-session-active",
		description:
			"non-terminal runs are only allowed while their session is still active",
		ids: runRows
			.filter((r) => {
				if (TERMINAL_RUN_STATUSES.has(r.status)) return false;
				const session = sessionById.get(r.piSessionId);
				return !session || session.status !== "active";
			})
			.map((r) => r.id),
	});

	// 5. Every tool_call_start has a matching end, or its run ended abnormally.
	const endedToolUseIds = new Set<string>();
	for (const e of eventRows) {
		if (e.type !== "tool_call_end") continue;
		const toolUseId = toolUseIdOf(e.eventData);
		if (toolUseId) endedToolUseIds.add(toolUseId);
	}
	collect(violations, {
		invariant: 5,
		name: "tool-call-pairing",
		description:
			"tool_call_start events must pair with a tool_call_end unless the run is still running or ended abnormally",
		ids: eventRows
			.filter((e) => {
				if (e.type !== "tool_call_start") return false;
				const toolUseId = toolUseIdOf(e.eventData);
				if (toolUseId && endedToolUseIds.has(toolUseId)) return false;
				const run = e.runId ? runById.get(e.runId) : undefined;
				if (run && (run.status === "running" || ABNORMAL_RUN_STATUSES.has(run.status))) {
					return false;
				}
				return true;
			})
			.map((e) => e.eventId),
	});

	// 6. Container tree has no cycles; every container has a kind.
	collect(violations, {
		invariant: 6,
		name: "container-kind-present",
		description: "every container must carry a non-empty kind",
		ids: containerRows.filter((c) => !c.kind).map((c) => c.id),
	});
	const parentOf = new Map(
		containerRows.map((c) => [c.id, c.parentContainerId ?? null]),
	);
	const inCycle: string[] = [];
	const acyclic = new Set<string>();
	for (const c of containerRows) {
		const path = new Set<string>();
		let cursor: string | null = c.id;
		let cyclic = false;
		while (cursor != null && parentOf.has(cursor) && !acyclic.has(cursor)) {
			if (path.has(cursor)) {
				cyclic = true;
				break;
			}
			path.add(cursor);
			cursor = parentOf.get(cursor) ?? null;
		}
		if (cyclic) {
			inCycle.push(c.id);
		} else {
			for (const id of path) acyclic.add(id);
		}
	}
	collect(violations, {
		invariant: 6,
		name: "container-tree-acyclic",
		description: "the container parent tree must not contain cycles",
		ids: inCycle,
	});

	// 7. Every trace_events.run_id resolves to an existing run.
	collect(violations, {
		invariant: 7,
		name: "event-run-resolves",
		description: "trace_events.run_id must resolve to an existing agent_runs row",
		ids: eventRows
			.filter((e) => e.runId != null && !runById.has(e.runId))
			.map((e) => e.eventId),
	});

	// 8. Usage consistency: run sums per session == session rollup; run sums
	// per container == container rollup. Pre-Phase-2 rows carry zero usage on
	// both sides and pass trivially; only actual drift is reported.
	const COST_EPSILON = 1e-6;
	const sessionSums = new Map<string, { input: number; output: number }>();
	const containerSums = new Map<
		string,
		{ input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null }
	>();
	for (const r of runRows) {
		const s = sessionSums.get(r.piSessionId) ?? { input: 0, output: 0 };
		s.input += r.usageInputTokens;
		s.output += r.usageOutputTokens;
		sessionSums.set(r.piSessionId, s);

		const c = containerSums.get(r.containerId) ?? {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: null,
		};
		c.input += r.usageInputTokens;
		c.output += r.usageOutputTokens;
		c.cacheRead += r.usageCacheRead;
		c.cacheWrite += r.usageCacheWrite;
		if (r.usageCostEstimate != null) c.cost = (c.cost ?? 0) + r.usageCostEstimate;
		containerSums.set(r.containerId, c);
	}
	collect(violations, {
		invariant: 8,
		name: "session-usage-rollup",
		description:
			"sum of run usage per session must equal the pi_agent_sessions usage rollup",
		ids: sessionRows
			.filter((s) => {
				const sums = sessionSums.get(s.id) ?? { input: 0, output: 0 };
				return (
					sums.input !== s.usageInputTokens || sums.output !== s.usageOutputTokens
				);
			})
			.map((s) => s.id),
	});
	collect(violations, {
		invariant: 8,
		name: "container-usage-rollup",
		description:
			"sum of run usage per container must equal the containers usage rollup",
		ids: containerRows
			.filter((c) => {
				const sums = containerSums.get(c.id) ?? {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: null,
				};
				if (
					sums.input !== c.usageInputTokens ||
					sums.output !== c.usageOutputTokens ||
					sums.cacheRead !== c.usageCacheRead ||
					sums.cacheWrite !== c.usageCacheWrite
				) {
					return true;
				}
				return Math.abs((sums.cost ?? 0) - (c.usageCostEstimate ?? 0)) > COST_EPSILON;
			})
			.map((c) => c.id),
	});

	const skipped: DoctorSkippedCheck[] = [];

	return {
		checkedAt: new Date().toISOString(),
		counts: {
			containers: containerRows.length,
			piAgentSessions: sessionRows.length,
			agentRuns: runRows.length,
			traceEvents: eventRows.length,
		},
		violations,
		skipped,
		ok: violations.length === 0,
	};
}

function toolUseIdOf(eventData: unknown): string | undefined {
	if (eventData && typeof eventData === "object") {
		const value = (eventData as Record<string, unknown>).tool_use_id;
		if (typeof value === "string") return value;
	}
	return undefined;
}

/* ------------------------------------------------------------------------ *
 * Catalog doctor — bundle layout hygiene.
 *
 * The registry resolves each bundle section file-first, folder-second, and
 * when both forms exist the file wins *silently* so a migration can leave a
 * re-export shim at the old path. Silence is right for resolution and wrong
 * for review: doctor is where a shim that outlived its migration surfaces.
 * ------------------------------------------------------------------------ */

/** One bundle section that exists in both the file and the folder form. */
export interface BundleLayoutWarning {
	/** Absolute path of the bundle directory. */
	agentDir: string;
	section: BundleSection;
	/** The path discovery actually uses (always the file form here). */
	resolvedPath: string;
	/** The path discovery ignores. */
	shadowedPath: string;
	message: string;
}

export interface CatalogBundleSummary {
	agentDir: string;
	/** Resolved form per section; null where the section is absent. */
	forms: Record<BundleSection, BundleEntryForm | null>;
}

export interface CatalogDoctorReport {
	checkedAt: string;
	roots: string[];
	counts: {
		bundles: number;
		fileForm: number;
		folderForm: number;
	};
	bundles: CatalogBundleSummary[];
	warnings: BundleLayoutWarning[];
	ok: boolean;
}

/**
 * Scan catalog roots for bundle-layout problems. Purely a filesystem check —
 * it does not import sidecars or validate prompts, so it is safe to run
 * against a catalog that would fail registry boot.
 */
export function runCatalogDoctor(roots: string[]): CatalogDoctorReport {
	const warnings: BundleLayoutWarning[] = [];
	const bundles: CatalogBundleSummary[] = [];
	let fileForm = 0;
	let folderForm = 0;

	for (const root of roots) {
		for (const agentDir of collectBundleDirs(root)) {
			const layout = resolveBundleLayout(agentDir);
			const forms = {
				prompt: layout.prompt.form,
				context: layout.context.form,
				tools: layout.tools.form,
				state: layout.state.form,
			} satisfies Record<BundleSection, BundleEntryForm | null>;
			for (const [section, entry] of bundleSections(layout)) {
				if (entry.form === "file") fileForm += 1;
				if (entry.form === "folder") folderForm += 1;
				if (!entry.shadowedPath || !entry.path) continue;
				warnings.push({
					agentDir,
					section,
					resolvedPath: entry.path,
					shadowedPath: entry.shadowedPath,
					message:
						`${section}: both bundle forms present — the registry loads ` +
						`${relative(agentDir, entry.path)} and ignores ` +
						`${relative(agentDir, entry.shadowedPath)}. ` +
						"Keep the file only while it is a re-export shim for the folder; " +
						"delete it once the migration lands.",
				});
			}
			bundles.push({ agentDir, forms });
		}
	}

	return {
		checkedAt: new Date().toISOString(),
		roots: [...roots],
		counts: { bundles: bundles.length, fileForm, folderForm },
		bundles,
		warnings,
		ok: warnings.length === 0,
	};
}

/** Human-readable catalog report for the CLI. */
export function formatCatalogDoctorReport(report: CatalogDoctorReport): string {
	const lines: string[] = [];
	lines.push(`agent-kernel doctor — catalog: ${report.roots.join(", ")}`);
	lines.push(`checked at ${report.checkedAt}`);
	lines.push(
		`bundles: ${report.counts.bundles} ` +
			`(${report.counts.fileForm} file-form section(s), ` +
			`${report.counts.folderForm} folder-form section(s))`,
	);
	lines.push("");
	if (report.warnings.length === 0) {
		lines.push("OK — no bundle layout warnings.");
	} else {
		lines.push(`WARN — ${report.warnings.length} bundle layout warning(s):`);
		for (const w of report.warnings) {
			lines.push("");
			lines.push(`  ${w.agentDir}`);
			lines.push(`    ${w.message}`);
			lines.push(`    resolved: ${w.resolvedPath}`);
			lines.push(`    shadowed: ${w.shadowedPath}`);
		}
	}
	return lines.join("\n");
}

/* ------------------------------------------------------------------------ *
 * Host portability doctor — `host: "any"` bundles must actually load
 * standalone.
 *
 * A bundle declaring `host: "any"` promises its sidecars evaluate without
 * the owning app harness. The TUI harness (and future spawn_agent gates)
 * trust the declaration instead of crash-discovering, so doctor is where a
 * false declaration surfaces: each sidecar module is imported in a Node
 * subprocess through jiti — the same loader pi runs extensions with — and a
 * failure flags the bundle. `host: "app"` bundles are skipped by design.
 * ------------------------------------------------------------------------ */

export interface HostPortabilityWarning {
	agentDir: string;
	name: string;
	/** Absolute path of the failing sidecar module. */
	sidecar: string;
	message: string;
}

export interface HostPortabilityReport {
	checkedAt: string;
	roots: string[];
	counts: {
		/** Bundles declaring host:"any". */
		anyBundles: number;
		checkedSidecars: number;
	};
	warnings: HostPortabilityWarning[];
	skipped: { reason: string }[];
	ok: boolean;
}

/** First meaningful stderr line of a failed sidecar import. */
function firstFailureLine(stderr: string, exitCode: number | null): string {
	const lines = stderr
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.length > 0 &&
				!line.startsWith("(node:") &&
				!line.startsWith("at ") &&
				!line.startsWith("(Use `node") &&
				!line.includes("ExperimentalWarning"),
		);
	const errorLine = lines.find((line) => /error|cannot find|throw/i.test(line));
	return errorLine ?? lines[0] ?? `sidecar import failed (exit ${exitCode})`;
}

export async function runHostPortabilityDoctor(
	roots: string[],
): Promise<HostPortabilityReport> {
	const { createRequire } = await import("node:module");
	const { pathToFileURL } = await import("node:url");
	const { spawnSync } = await import("node:child_process");
	const { readFileSync } = await import("node:fs");

	const warnings: HostPortabilityWarning[] = [];
	const skipped: { reason: string }[] = [];
	let anyBundles = 0;
	let checkedSidecars = 0;

	// Resolve the jiti pi actually loads extensions with — the copy nested
	// under pi-coding-agent (2.x, `createJiti`). A hoisted top-level jiti can
	// be an unrelated 1.x with a different API, so prefer pi's.
	let jitiUrl: string | null = null;
	const req = createRequire(import.meta.url);
	try {
		// package.json, not the bare specifier: bun's createRequire.resolve
		// rejects the exports-mapped entry but answers the manifest path.
		const piManifest = req.resolve(
			"@earendil-works/pi-coding-agent/package.json",
		);
		jitiUrl = pathToFileURL(createRequire(piManifest).resolve("jiti")).href;
	} catch {
		try {
			jitiUrl = pathToFileURL(req.resolve("jiti")).href;
		} catch {
			jitiUrl = null;
		}
	}
	if (!jitiUrl) {
		skipped.push({
			reason:
				"jiti is not resolvable from the kernel package — host portability not checked",
		});
	}

	if (jitiUrl) {
		for (const root of roots) {
			for (const agentDir of collectBundleDirs(root)) {
				let manifest: { name?: unknown; host?: unknown };
				try {
					manifest = JSON.parse(
						readFileSync(`${agentDir}/agent.json`, "utf8"),
					) as { name?: unknown; host?: unknown };
				} catch {
					continue; // unreadable manifest is the registry's problem
				}
				if (manifest.host !== "any") continue;
				anyBundles += 1;
				const name =
					typeof manifest.name === "string" ? manifest.name : agentDir;

				const layout = resolveBundleLayout(agentDir);
				const sidecars = [
					layout.context.path,
					layout.tools.path,
					layout.state.path,
				].filter((path): path is string => path != null);
				for (const sidecar of sidecars) {
					checkedSidecars += 1;
					const script = [
						"const m = await import(process.env.AK_JITI_URL);",
						"const createJiti = m.createJiti ?? m.default?.createJiti;",
						"const jiti = createJiti(process.env.AK_BASE_URL, { moduleCache: false });",
						"await jiti.import(process.env.AK_SIDECAR);",
					].join("\n");
					let result: ReturnType<typeof spawnSync>;
					try {
						result = spawnSync("node", ["--input-type=module", "-e", script], {
							env: {
								...process.env,
								AK_JITI_URL: jitiUrl,
								AK_BASE_URL: pathToFileURL(sidecar).href,
								AK_SIDECAR: sidecar,
							},
							encoding: "utf8",
							timeout: 30_000,
						});
					} catch (err) {
						skipped.push({
							reason: `node subprocess unavailable (${err instanceof Error ? err.message : String(err)}) — host portability not checked`,
						});
						break;
					}
					if (result.error) {
						skipped.push({
							reason: `node subprocess unavailable (${result.error.message}) — host portability not checked`,
						});
						break;
					}
					if (result.status !== 0) {
						warnings.push({
							agentDir,
							name,
							sidecar,
							message: `declared host:"any" but sidecars fail under Node: ${firstFailureLine(String(result.stderr ?? ""), result.status)}`,
						});
					}
				}
			}
		}
	}

	return {
		checkedAt: new Date().toISOString(),
		roots: [...roots],
		counts: { anyBundles, checkedSidecars },
		warnings,
		skipped,
		ok: warnings.length === 0,
	};
}

/** Human-readable host portability report for the CLI. */
export function formatHostPortabilityReport(
	report: HostPortabilityReport,
): string {
	const lines: string[] = [];
	lines.push(
		`host portability: ${report.counts.anyBundles} host:"any" bundle(s), ` +
			`${report.counts.checkedSidecars} sidecar(s) checked under Node`,
	);
	for (const entry of report.skipped) {
		lines.push(`  skipped: ${entry.reason}`);
	}
	if (report.warnings.length === 0) {
		lines.push("OK — every host:\"any\" bundle loads standalone.");
	} else {
		lines.push(`WARN — ${report.warnings.length} host portability warning(s):`);
		for (const w of report.warnings) {
			lines.push("");
			lines.push(`  ${w.name} (${w.agentDir})`);
			lines.push(`    ${w.message}`);
			lines.push(`    sidecar: ${w.sidecar}`);
		}
	}
	return lines.join("\n");
}

/** Human-readable report for the CLI. */
export function formatDoctorReport(report: DoctorReport, dbPath?: string): string {
	const lines: string[] = [];
	lines.push(`agent-kernel doctor${dbPath ? ` — ${dbPath}` : ""}`);
	lines.push(`checked at ${report.checkedAt}`);
	lines.push(
		`rows: ${report.counts.containers} containers, ` +
			`${report.counts.piAgentSessions} sessions, ` +
			`${report.counts.agentRuns} runs, ` +
			`${report.counts.traceEvents} events`,
	);
	lines.push("");
	if (report.violations.length === 0) {
		lines.push("OK — no linkage invariant violations found.");
	} else {
		lines.push(`FAIL — ${report.violations.length} violation kind(s):`);
		for (const v of report.violations) {
			lines.push("");
			lines.push(`  [invariant ${v.invariant}] ${v.name} — ${v.count} row(s)`);
			lines.push(`    ${v.description}`);
			lines.push(`    samples: ${v.sampleIds.join(", ")}`);
		}
	}
	for (const s of report.skipped) {
		lines.push("");
		lines.push(`  (skipped invariant ${s.invariant}: ${s.reason})`);
	}
	return lines.join("\n");
}
