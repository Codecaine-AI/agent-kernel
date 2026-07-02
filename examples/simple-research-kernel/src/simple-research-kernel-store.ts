import { createHash, randomUUID } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

import {
	createKernel,
	getRunContext,
	type AgentDefinition,
	type KernelExtensionContext,
	type KernelInstance
} from "@agent-kernel/kernel";
import type { Loader, LoaderDeclaration, LoaderResult } from "@agent-kernel/kernel/context";
import { updateContainerStatus, type KernelDatabase } from "@agent-kernel/db";
import { createContainerStartEvent, createPhaseStartEvent } from "@agent-kernel/protocol";
import type { KernelTraceSessionSummary } from "@agent-kernel/viewer-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PromptDocument } from "@codecaine-ai/prompt-kit";
import type { SimpleResearchToolRuntime, ToolResponse } from "./agent-catalog/tool-runtime";

export const KERNEL_ID = "simple-research-kernel";
export const PHASE = "research";
export const EXAMPLE_ROOT = resolve(import.meta.dir, "..");
const AGENT_CATALOG_DIR = join(import.meta.dir, "agent-catalog");
export const WORKING_MEMORY_DIR = join(EXAMPLE_ROOT, "research-memory");
export const RESEARCH_SESSION_ROOT = join(EXAMPLE_ROOT, ".agent-kernel", "research-sessions");
const RESEARCH_MEMORY_REL_PATH = "research-memory";
const SCOUT_REPORTS_REL_PATH = join(RESEARCH_MEMORY_REL_PATH, "scout-reports");
const REPORTS_REL_PATH = join(RESEARCH_MEMORY_REL_PATH, "reports");
const PI_AGENT_DIR = Bun.env.AGENT_KERNEL_PI_AGENT_DIR ?? join(EXAMPLE_ROOT, ".pi-agent");
const DEFAULT_PI_SESSIONS_DIR = join(EXAMPLE_ROOT, ".agent-kernel", "pi-sessions");
const DEFAULT_RESEARCH_MODEL = "codex-lb/gpt-5.5";
/** Manifest model alias — resolved to the live model via kernel config. */
const RESEARCH_MODEL_ALIAS = "research-default";

type ResearchHarnessInfo = {
	kernelId: string;
	concurrency: { maxBackgroundAgents: number };
	memoryDir: string;
	agents: ResearchAgentSummary[];
	activeRuns: ResearchRunSummary[];
	trace: {
		label: string;
		piSessionCount: number;
		eventCount: number;
		latestEventAt: string | null;
	};
	artifacts: {
		scoutReports: ResearchArtifactSummary[];
		reports: ResearchArtifactSummary[];
	};
	latestReport: string;
};

type ResearchAgentSummary = {
	name: string;
	description: string;
	model: string;
	tools: string[];
	disallowedTools: string[];
	extensions: true | string[] | false;
	canSpawnSubagent: boolean;
	variables: Array<{ name: string; defaultValue: unknown; description: string | null }>;
	maxTurns: number | null;
	thinking: string | null;
	runInBackground: boolean;
	hasContext: boolean;
	contextModule: string | null;
	agentFile: string;
	source: "typed" | "markdown";
	promptDocument: PromptDocument | null;
	promptTemplate: string;
	warnings: string[];
};

type ResearchArtifactSummary = {
	path: string;
	bytes: number;
	updatedAt: string;
};

type ResearchRunSummary = {
	id: string;
	/** The session container (kind "session") this run's trace lives under. */
	containerId: string;
	sessionSlug: string;
	prompt: string;
	status: "running" | "completed" | "error";
	startedAt: string;
	completedAt: string | null;
	error: string | null;
};

type ArtifactSnapshot = {
	scoutReports: number;
	finalReports: number;
};

type WorkingMemoryLoaderDeclaration = LoaderDeclaration & {
	kind: "working-memory";
	path?: string;
	scope?: string;
};

type ResearchStoreOptions = {
	db: KernelDatabase;
	piSessionsDir?: string;
	model?: string;
};

function hashContent(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

function safeSlug(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 54) || "note";
}

function collectFiles(dir: string, extensions: Set<string>): string[] {
	if (!existsSync(dir)) return [];

	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectFiles(fullPath, extensions));
		} else if (entry.isFile() && extensions.has(extname(entry.name))) {
			out.push(fullPath);
		}
	}
	return out.sort();
}

function copySeedPath(source: string, target: string): void {
	if (!existsSync(source)) return;

	const stats = statSync(source);
	if (stats.isDirectory()) {
		mkdirSync(target, { recursive: true });
		for (const entry of readdirSync(source, { withFileTypes: true })) {
			copySeedPath(join(source, entry.name), join(target, entry.name));
		}
		return;
	}

	if (stats.isFile() && !existsSync(target)) {
		mkdirSync(resolve(target, ".."), { recursive: true });
		cpSync(source, target, { force: false });
	}
}

const workingMemoryLoader: Loader<WorkingMemoryLoaderDeclaration> = {
	kind: "working-memory",
	async resolve(decl, ctx): Promise<LoaderResult> {
		const relPath = typeof decl.path === "string" ? decl.path : "research-memory";
		const root = resolve(ctx.cwd, relPath);
		mkdirSync(root, { recursive: true });

		const files = collectFiles(root, new Set([".md"]));
		if (files.length === 0) {
			return { status: "empty", content: "", bytes: 0, hash: hashContent("") };
		}

		const content = files
			.map((file) => {
				const rel = relative(ctx.cwd, file);
				return `<working_memory path="${rel}">\n${readFileSync(file, "utf8")}\n</working_memory>`;
			})
			.join("\n\n");

		return {
			status: "ok",
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			hash: hashContent(content)
		};
	}
};

export class SimpleResearchKernelStore {
	readonly kernel: KernelInstance<SimpleResearchToolRuntime>;

	private readonly db: KernelDatabase;
	private readonly piSessionsDir: string;
	private readonly model: string;
	/** Session dir per session container, for runs started in this process. */
	private readonly sessionDirsByContainer = new Map<string, string>();
	private artifactCounter = 0;
	private latestReportText = "";
	private readonly researchRuns = new Map<string, ResearchRunSummary>();

	constructor(options: ResearchStoreOptions) {
		this.db = options.db;
		this.piSessionsDir = options.piSessionsDir ?? DEFAULT_PI_SESSIONS_DIR;
		this.model = options.model ?? Bun.env.AGENT_KERNEL_RESEARCH_MODEL ?? DEFAULT_RESEARCH_MODEL;
		this.ensureWorkingMemory();
		mkdirSync(PI_AGENT_DIR, { recursive: true });
		mkdirSync(this.piSessionsDir, { recursive: true });

		// The whole former adapter bundle (registry building, spawn pipeline
		// assembly, trace writer, read service, prompt-revision registration)
		// is now kernel config + instance methods.
		this.kernel = createKernel<SimpleResearchToolRuntime>({
			id: KERNEL_ID,
			db: this.db,
			concurrency: { maxBackgroundAgents: 3 },
			catalog: { roots: [AGENT_CATALOG_DIR] },
			models: { aliases: { [RESEARCH_MODEL_ALIAS]: this.model } },
			loaders: [workingMemoryLoader],
			toolRuntime: this.createToolRuntime(),
			appContext: ({ cwd }) => ({
				sessionData: {
					workingMemoryDir: join(cwd ?? EXAMPLE_ROOT, RESEARCH_MEMORY_REL_PATH)
				}
			}),
			piSessionsDir: this.piSessionsDir,
			piAgentDir: PI_AGENT_DIR,
			piLifecycleCustomType: "agent-kernel:pi-lifecycle",
			logger: console
		});
	}

	async getResearchInfo(traces: KernelTraceSessionSummary[] = []): Promise<ResearchHarnessInfo> {
		const registry = await this.kernel.registry();
		const trace = traces[0] ?? {
			label: "Simple Research Kernel",
			piSessionCount: 0,
			eventCount: 0,
			latestEventAt: null
		};
		const artifactSessionDir =
			"containerId" in trace ? this.sessionDirForTrace(trace) : null;
		return {
			kernelId: this.kernel.id,
			concurrency: this.kernel.concurrency,
			memoryDir: relative(
				EXAMPLE_ROOT,
				artifactSessionDir
					? this.workingMemoryDirForSession(artifactSessionDir)
					: RESEARCH_SESSION_ROOT
			),
			agents: registry.list().map((agent) => this.summarizeAgent(agent)),
			activeRuns: [...this.researchRuns.values()].filter((run) => run.status === "running"),
			trace: {
				label: trace.label,
				piSessionCount: trace.piSessionCount,
				eventCount: trace.eventCount,
				latestEventAt: trace.latestEventAt
			},
			artifacts: {
				scoutReports: artifactSessionDir
					? this.summarizeArtifacts(this.listScoutReportFiles(artifactSessionDir))
					: [],
				reports: artifactSessionDir ? this.summarizeArtifacts(this.listReportFiles(artifactSessionDir)) : []
			},
			latestReport: this.latestReportText
		};
	}

	async startResearchRun(
		prompt: string,
		options: { variant?: string } = {}
	): Promise<ResearchRunSummary> {
		const id = randomUUID();
		const sessionSlug = `research-${safeSlug(prompt)}-${id.slice(0, 8)}`.slice(0, 90);
		const sessionDir = this.ensureResearchSessionDir(join(RESEARCH_SESSION_ROOT, sessionSlug));
		const startedAt = new Date().toISOString();

		// One research request = one root container of kind "session".
		// Identity is derived, never minted: same (kind, key) upserts the same row.
		const container = await this.kernel.container({
			kind: "session",
			key: [id],
			label: `Research: ${prompt.slice(0, 72)}`,
			phase: PHASE,
			phaseVocabulary: [PHASE],
			workingDir: EXAMPLE_ROOT,
			metadata: {
				app: KERNEL_ID,
				topic: prompt,
				prompt,
				sessionSlug,
				sessionDir,
				description:
					"A simple research kernel that fans out to scouts, reads their reports, optionally spawns follow-up scouts, and queues a final report writer."
			}
		});
		this.sessionDirsByContainer.set(container.id, sessionDir);
		await updateContainerStatus(this.db, container.id, "active", { startedAt });
		this.seedLifecycle(container.id, container.label ?? prompt);

		const artifactSnapshot = this.snapshotArtifacts(sessionDir);
		const run: ResearchRunSummary = {
			id,
			containerId: container.id,
			sessionSlug,
			prompt,
			status: "running",
			startedAt,
			completedAt: null,
			error: null
		};
		this.researchRuns.set(id, run);

		void this.kernel
			.spawnAgent("research-coordinator", prompt, null, {
				variables: this.variablesFor("research-coordinator", prompt),
				containerId: container.id,
				trigger: "operator",
				sessionDir,
				workingDir: sessionDir,
				phase: PHASE,
				// With a manifest variant selected, its displayLabel (and model/
				// thinking/maxTurns overrides) resolve inside the kernel.
				...(options.variant
					? { variant: options.variant }
					: { displayLabel: this.displayLabel("research-coordinator") })
			})
			.then(() => {
				const artifactError = this.validateCompletedRun(sessionDir, artifactSnapshot);
				if (artifactError) throw new Error(artifactError);
				run.status = "completed";
				run.completedAt = new Date().toISOString();
				this.markSessionContainer(container.id, "done", run.completedAt);
			})
			.catch((err) => {
				run.status = "error";
				run.completedAt = new Date().toISOString();
				run.error = err instanceof Error ? err.message : String(err);
				this.markSessionContainer(container.id, "error", run.completedAt);
				console.error("Failed to run Simple Research Kernel", err);
			});

		return run;
	}

	private variablesFor(agentName: string, prompt: string): Record<string, unknown> {
		const common = {
			researchMemoryDir: "research-memory",
			phase: PHASE
		};
		if (agentName === "research-coordinator") {
			return {
				...common,
				userPrompt: prompt
			};
		}
		return {
			...common,
			focus: prompt
		};
	}

	private createToolRuntime(): SimpleResearchToolRuntime {
		return {
			readContextSnapshot: (paths) => this.readContextSnapshot(paths),
			spawnScoutAssignments: (pi, ctx, toolCallId, assignments, signal) =>
				this.spawnScoutAssignments(pi, ctx, toolCallId, assignments, signal),
			spawnReportWriter: (pi, ctx, toolCallId, focus, signal) =>
				this.spawnReportWriter(pi, ctx, toolCallId, focus, signal),
			reviewResearchReports: (question) => this.reviewResearchReports(question),
			writeResearchReport: (title, content) => this.writeResearchReport(title, content),
			writeFinalReport: (title, content) => this.writeFinalReport(title, content)
		};
	}

	private reviewResearchReports(question?: string): ToolResponse {
		const sessionDir = this.currentRunSessionDir();
		const files = this.listScoutReportFiles(sessionDir);
		const reports = files.map((file) => ({
			path: relative(sessionDir, file),
			content: readFileSync(file, "utf8")
		}));
		const reportList =
			reports.length > 0
				? reports
						.map((report) => `<scout_report path="${report.path}">\n${report.content}\n</scout_report>`)
						.join("\n\n")
				: "No scout reports are available yet.";
		const text = [
			`Review question: ${question ?? "Assess whether coverage is sufficient for final synthesis."}`,
			`Scout reports found: ${reports.length}`,
			reportList,
			reports.length < 2
				? "Coverage note: fewer than two scout reports are present. Consider spawning more scouts unless the request is trivial."
				: "Coverage note: at least two scout reports are present. Decide from their substance whether follow-up is needed."
		].join("\n\n");
		return {
			text,
			details: {
				reportCount: reports.length,
				reports: reports.map((report) => ({ path: report.path }))
			}
		};
	}

	private async spawnReportWriter(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		toolCallId: string,
		focus: string,
		signal?: AbortSignal
	) {
		const runCtx = getRunContext();
		const sessionDir = this.currentRunSessionDir();
		// Subagent identity is inherited from the parent run context: same
		// containerId, parentRunId = the coordinator's run, trigger defaults to
		// "parent-tool", and parentToolUseId flows from toolCallId.
		return this.kernel.agentManager.spawnAndWait(
			pi,
			ctx as unknown as KernelExtensionContext,
			"report-writer",
			focus,
			{
				description: "Write the final research report",
				workingDir: sessionDir,
				containerId: runCtx.containerId,
				sessionDir,
				phase: runCtx.phase,
				displayLabel: this.displayLabel("report-writer"),
				parentRunId: runCtx.runId,
				parentPiSessionUuid: runCtx.piSessionUuid,
				toolCallId,
				parentPi: pi,
				signal,
				variables: this.variablesFor("report-writer", focus)
			}
		);
	}

	private writeResearchReport(title: string | undefined, content: string): ToolResponse {
		const sessionDir = this.currentRunSessionDir();
		const reportPath = this.writeArtifact(
			this.scoutReportsDirForSession(sessionDir),
			title ?? "scout-report",
			content
		);
		return {
			text: `Wrote scout report to ${relative(sessionDir, reportPath)}.`,
			details: {
				path: relative(sessionDir, reportPath)
			}
		};
	}

	private writeFinalReport(title: string | undefined, content: string): ToolResponse {
		const sessionDir = this.currentRunSessionDir();
		const reportPath = this.writeArtifact(
			this.reportsDirForSession(sessionDir),
			title ?? "research-report",
			content
		);
		this.latestReportText = content;
		return {
			text: `Wrote final report to ${relative(sessionDir, reportPath)}.`,
			details: {
				path: relative(sessionDir, reportPath)
			}
		};
	}

	private async spawnScoutAssignments(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		toolCallId: string,
		assignments: Array<{ focus: string; prompt: string }>,
		signal?: AbortSignal
	) {
		const runCtx = getRunContext();
		const sessionDir = this.currentRunSessionDir();
		return Promise.all(
			assignments.map((assignment) =>
				this.kernel.agentManager.spawnAndWait(
					pi,
					ctx as unknown as KernelExtensionContext,
					"source-scout",
					assignment.prompt,
					{
						description: assignment.focus,
						workingDir: sessionDir,
						containerId: runCtx.containerId,
						sessionDir,
						phase: runCtx.phase,
						displayLabel: this.displayLabel("source-scout"),
						parentRunId: runCtx.runId,
						parentPiSessionUuid: runCtx.piSessionUuid,
						toolCallId,
						parentPi: pi,
						signal,
						variables: this.variablesFor("source-scout", assignment.prompt)
					}
				)
			)
		);
	}

	private snapshotArtifacts(sessionDir: string): ArtifactSnapshot {
		return {
			scoutReports: this.listScoutReportFiles(sessionDir).length,
			finalReports: this.listReportFiles(sessionDir).length
		};
	}

	private validateCompletedRun(sessionDir: string, snapshot: ArtifactSnapshot): string | null {
		const scoutReportsWritten = this.listScoutReportFiles(sessionDir).length - snapshot.scoutReports;
		const finalReportsWritten = this.listReportFiles(sessionDir).length - snapshot.finalReports;
		if (scoutReportsWritten < 2) {
			return [
				"Research coordinator finished without completing the required scout fan-out.",
				`Expected at least 2 new scout reports, saw ${Math.max(0, scoutReportsWritten)}.`,
				"The model must call spawn_research_scouts and the source scouts must call write_research_report."
			].join(" ");
		}
		if (finalReportsWritten < 1) {
			return [
				"Research coordinator finished without a final report.",
				"The model must review scout reports, queue the report writer, and the report writer must call write_report."
			].join(" ");
		}
		return null;
	}

	private readContextSnapshot(paths?: string[]): {
		text: string;
		files: Array<{ path: string; bytes: number; truncated: boolean }>;
	} {
		const sessionDir = this.currentRunSessionDir();
		const files = this.resolveContextFiles(sessionDir, paths);
		const fileSummaries: Array<{ path: string; bytes: number; truncated: boolean }> = [];
		let remainingBytes = 60_000;
		const blocks = files.map((file) => {
			const raw = readFileSync(file, "utf8");
			const bytes = Buffer.byteLength(raw, "utf8");
			const budget = Math.max(0, Math.min(remainingBytes, 14_000));
			const content = raw.slice(0, budget);
			remainingBytes -= Buffer.byteLength(content, "utf8");
			const truncated = content.length < raw.length;
			const relPath = relative(sessionDir, file);
			fileSummaries.push({ path: relPath, bytes, truncated });
			return `<file path="${relPath}" bytes="${bytes}" truncated="${truncated}">\n${content}\n</file>`;
		});
		return {
			text: blocks.length > 0 ? blocks.join("\n\n") : "No matching context files were found.",
			files: fileSummaries
		};
	}

	private resolveContextFiles(sessionDir: string, paths?: string[]): string[] {
		const requested =
			paths && paths.length > 0
				? paths
				: [
						"research-memory/brief.md",
						"research-memory/sources",
						"research-memory/scout-reports",
						"research-memory/reports"
					];
		const files: string[] = [];
		for (const requestedPath of requested) {
			const fullPath = this.resolveSessionPath(sessionDir, requestedPath);
			if (!existsSync(fullPath)) continue;
			const stats = statSync(fullPath);
			if (stats.isDirectory()) {
				files.push(...collectFiles(fullPath, new Set([".md"])));
			} else if (stats.isFile() && extname(fullPath) === ".md") {
				files.push(fullPath);
			}
		}
		return [...new Set(files)].sort();
	}

	private resolveSessionPath(sessionDir: string, requestedPath: string): string {
		const fullPath = resolve(sessionDir, requestedPath);
		if (fullPath !== sessionDir && !fullPath.startsWith(`${sessionDir}/`)) {
			throw new Error(`Path escapes the research session: ${requestedPath}`);
		}
		return fullPath;
	}

	private writeArtifact(dir: string, title: string, content: string): string {
		mkdirSync(dir, { recursive: true });
		this.artifactCounter += 1;
		const fileName = `${String(this.artifactCounter).padStart(2, "0")}-${safeSlug(title)}.md`;
		const target = join(dir, fileName);
		const normalized = content.endsWith("\n") ? content : `${content}\n`;
		writeFileSync(target, normalized);
		return target;
	}

	/**
	 * Seed the viewer's phase + pipeline-container grouping for a fresh
	 * session container. These are app-level trace events keyed by the
	 * session container id, written through the kernel's default trace sink.
	 */
	private seedLifecycle(containerId: string, label: string): void {
		const ids = { containerId };
		this.kernel.traceWriter.submit(createPhaseStartEvent(ids, PHASE));
		this.kernel.traceWriter.submit(
			createContainerStartEvent(ids, {
				container_id: containerId,
				level: "research",
				checkpoint_id: null,
				task_group_id: null,
				parent_container_id: null,
				label,
				producer_stage: "docs",
				phase: PHASE
			})
		);
	}

	private markSessionContainer(containerId: string, status: string, endedAt: string): void {
		void updateContainerStatus(this.db, containerId, status, { endedAt }).catch((error) => {
			console.error(
				"Simple Research Kernel container status update failed:",
				error instanceof Error ? error.message : String(error)
			);
		});
	}

	private ensureWorkingMemory(): void {
		mkdirSync(WORKING_MEMORY_DIR, { recursive: true });
		mkdirSync(RESEARCH_SESSION_ROOT, { recursive: true });
		this.ensureResearchSessionDir(this.defaultResearchSessionDir());
	}

	private defaultResearchSessionDir(): string {
		return join(RESEARCH_SESSION_ROOT, KERNEL_ID);
	}

	private sessionDirForTrace(trace: KernelTraceSessionSummary): string | null {
		const local = this.sessionDirsByContainer.get(trace.containerId);
		if (local) return local;
		const fromMetadata = trace.metadata?.sessionDir;
		return typeof fromMetadata === "string" && fromMetadata.length > 0 ? fromMetadata : null;
	}

	private workingMemoryDirForSession(sessionDir: string): string {
		return join(sessionDir, RESEARCH_MEMORY_REL_PATH);
	}

	private scoutReportsDirForSession(sessionDir: string): string {
		return join(sessionDir, SCOUT_REPORTS_REL_PATH);
	}

	private reportsDirForSession(sessionDir: string): string {
		return join(sessionDir, REPORTS_REL_PATH);
	}

	private ensureResearchSessionDir(sessionDir: string): string {
		const workingMemoryDir = this.workingMemoryDirForSession(sessionDir);
		mkdirSync(workingMemoryDir, { recursive: true });
		copySeedPath(join(WORKING_MEMORY_DIR, "brief.md"), join(workingMemoryDir, "brief.md"));
		copySeedPath(join(WORKING_MEMORY_DIR, "sources"), join(workingMemoryDir, "sources"));
		mkdirSync(this.scoutReportsDirForSession(sessionDir), { recursive: true });
		mkdirSync(this.reportsDirForSession(sessionDir), { recursive: true });
		return sessionDir;
	}

	private currentRunSessionDir(): string {
		const runCtx = getRunContext();
		const sessionDir = runCtx.sessionDir ?? this.defaultResearchSessionDir();
		return this.ensureResearchSessionDir(sessionDir);
	}

	private listScoutReportFiles(sessionDir: string): string[] {
		return collectFiles(this.scoutReportsDirForSession(sessionDir), new Set([".md"])).filter(
			(file) => basename(file) !== "README.md"
		);
	}

	private listReportFiles(sessionDir: string): string[] {
		return collectFiles(this.reportsDirForSession(sessionDir), new Set([".md"])).filter(
			(file) => basename(file) !== "README.md"
		);
	}

	private summarizeAgent(agent: AgentDefinition): ResearchAgentSummary {
		const config = agent.parsed.config;
		return {
			name: agent.name,
			description: config.description,
			model: this.model,
			source: "typed",
			promptDocument: agent.promptDocument,
			tools: config.tools,
			disallowedTools: config.disallowedTools ?? [],
			extensions: config.extensions ?? true,
			canSpawnSubagent: config.canSpawnSubagent ?? false,
			variables: Object.entries(config.variables).map(([name, decl]) => ({
				name,
				defaultValue: decl.default,
				description: decl.description ?? null
			})),
			maxTurns: config.maxTurns ?? null,
			thinking: config.thinking ?? null,
			runInBackground: config.runInBackground ?? false,
			hasContext: agent.contextModulePath !== null,
			contextModule: agent.contextModulePath ? relative(EXAMPLE_ROOT, agent.contextModulePath) : null,
			agentFile: relative(EXAMPLE_ROOT, agent.manifestFile),
			promptTemplate: agent.parsed.body.trim(),
			warnings: agent.warnings
		};
	}

	private summarizeArtifacts(files: string[]): ResearchArtifactSummary[] {
		return files.map((file) => {
			const stats = statSync(file);
			return {
				path: relative(EXAMPLE_ROOT, file),
				bytes: stats.size,
				updatedAt: stats.mtime.toISOString()
			};
		});
	}

	private displayLabel(agentName: string): string {
		return agentName
			.split("-")
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}
}
