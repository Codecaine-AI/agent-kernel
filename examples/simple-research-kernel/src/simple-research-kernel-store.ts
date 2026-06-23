import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	AgentManager,
	buildRegistry,
	createKernel,
	getRunContext,
	type AgentDefinition,
	type AgentRegistry,
	type KernelExtensionContext,
	type KernelInstance
} from "@agent-kernel/kernel";
import {
	createSpawnContext,
	createDefaultCatalog,
	type AgentContextResolver,
	type Loader,
	type LoaderDeclaration,
	type LoaderResult,
	type SpawnContext
} from "@agent-kernel/kernel/context";
import {
	createSpawnAgent,
	type KernelSpawnAgent,
	type KernelSpawnAgentResult,
	type KernelSpawnOptions
} from "@agent-kernel/kernel/spawn-pipeline";
import {
	createContainerStartEvent,
	createPhaseStartEvent,
	SYSTEM_USER_ID,
	TraceSource,
	type TraceEvent as ProtocolTraceEvent
} from "@agent-kernel/protocol";
import type {
	AgentRun,
	KernelContainerSummary,
	KernelTraceSessionDetail,
	KernelTraceSessionListResponse,
	PiSessionWithCount,
	TraceEventRow
} from "@agent-kernel/viewer-core";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type {
	SimpleResearchAgentRegisterFn,
	SimpleResearchToolRuntime,
	ToolResponse
} from "./agent-catalog/tool-runtime";

export const APP_SESSION_ID = "11111111-1111-4111-8111-111111111111";
export const ROOT_CONTAINER_ID = "simple-research-kernel";
export const PHASE = "research";
export const APP_SESSION_SLUG = "simple-research-kernel";
export const EXAMPLE_ROOT = resolve(import.meta.dir, "..");
const AGENT_CATALOG_DIR = join(import.meta.dir, "agent-catalog");
export const WORKING_MEMORY_DIR = join(EXAMPLE_ROOT, "research-memory");
const SCOUT_REPORTS_DIR = join(WORKING_MEMORY_DIR, "scout-reports");
const REPORTS_DIR = join(WORKING_MEMORY_DIR, "reports");
const PI_AGENT_DIR = Bun.env.AGENT_KERNEL_PI_AGENT_DIR ?? join(EXAMPLE_ROOT, ".pi-agent");
const DEFAULT_PI_SESSIONS_DIR = join(EXAMPLE_ROOT, ".agent-kernel", "pi-sessions");
const DEFAULT_RESEARCH_MODEL = "codex-lb/gpt-5.5";
const DEFAULT_RESEARCH_PROMPT =
	"Research how the Simple Research Kernel should present agents, context loading, subagents, and working memory.";

type ResearchHarnessInfo = {
	kernelId: string;
	concurrency: { maxBackgroundAgents: number };
	memoryDir: string;
	agents: ResearchAgentSummary[];
	activeRuns: ResearchRunSummary[];
	dummySession: {
		id: string;
		label: string;
		description: string;
	};
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
	appSessionId: string;
	appSessionSlug: string;
	containerId: string;
	prompt: string;
	kind: "dummy" | "user";
	status: "running" | "completed" | "error";
	startedAt: string;
	completedAt: string | null;
	error: string | null;
};

type ResearchTraceIdentity = {
	appSessionId: string;
	appSessionSlug: string;
	containerId: string;
	label: string;
	topic: string;
	kind: ResearchRunSummary["kind"];
	prompt: string;
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

export interface SimpleResearchKernelPersistence {
	upsertContainer?(container: KernelContainerSummary): Promise<void>;
	upsertPiSession?(session: PiSessionWithCount): Promise<void>;
	upsertAgentRun?(run: AgentRun): Promise<void>;
	insertTraceEvent?(event: ProtocolTraceEvent): Promise<void>;
}

type ResearchStoreOptions = {
	persistence?: SimpleResearchKernelPersistence;
	db?: unknown;
	piSessionsDir?: string;
	model?: string;
};

function hashContent(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

function nowRounded(): number {
	return Math.floor(Date.now() / 1000) * 1000;
}

function safeSlug(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 54) || "note";
}

function traceMetadata(trace: ResearchTraceIdentity): Record<string, unknown> {
	return {
		kernelId: "simple-research-kernel",
		app: "simple-research-kernel",
		appSessionId: trace.appSessionId,
		appSessionSlug: trace.appSessionSlug,
		appSessionType: "example",
		topic: trace.topic,
		prompt: trace.prompt,
		kind: trace.kind,
		description:
			"A simple research kernel that fans out to scouts, reads their reports, optionally spawns follow-up scouts, and queues a final report writer."
	};
}

function isSeedTrace(trace: { appSessionId?: string; containerId?: string }): boolean {
	return trace.appSessionId === APP_SESSION_ID || trace.containerId === ROOT_CONTAINER_ID;
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
	readonly kernel: KernelInstance<
		KernelExtensionContext | null,
		KernelSpawnOptions,
		KernelSpawnAgentResult,
		AgentManager
	>;

	private readonly persistence?: SimpleResearchKernelPersistence;
	private readonly db?: unknown;
	private readonly piSessionsDir: string;
	private readonly model: string;
	private readonly toolRuntime: SimpleResearchToolRuntime;
	private persistenceTail: Promise<void> = Promise.resolve();
	private readonly registryPromise: Promise<AgentRegistry>;
	private liveSpawnAgentPromise: Promise<KernelSpawnAgent> | null = null;
	private readonly startedAt = nowRounded() - 90_000;
	private readonly containers = new Map<string, KernelContainerSummary>();
	private readonly traceIdentities = new Map<string, ResearchTraceIdentity>();
	private readonly piSessions: PiSessionWithCount[] = [];
	private readonly agentRuns: AgentRun[] = [];
	private readonly events: TraceEventRow[] = [];
	private eventCounter = 0;
	private artifactCounter = 0;
	private latestReportText = "";
	private readonly researchRuns = new Map<string, ResearchRunSummary>();

	constructor(options: ResearchStoreOptions = {}) {
		this.persistence = options.persistence;
		this.db = options.db;
		this.piSessionsDir = options.piSessionsDir ?? DEFAULT_PI_SESSIONS_DIR;
		this.model = options.model ?? Bun.env.AGENT_KERNEL_RESEARCH_MODEL ?? DEFAULT_RESEARCH_MODEL;
		this.ensureWorkingMemory();
		mkdirSync(PI_AGENT_DIR, { recursive: true });
		mkdirSync(this.piSessionsDir, { recursive: true });
		this.toolRuntime = this.createToolRuntime();
		this.registryPromise = buildRegistry({ catalogRoot: AGENT_CATALOG_DIR });

		this.kernel = createKernel<
			KernelExtensionContext | null,
			KernelSpawnOptions,
			KernelSpawnAgentResult,
			AgentManager
		>({
			id: "simple-research-kernel",
			concurrency: { maxBackgroundAgents: 3 },
			spawnAgent: (name, prompt, ctx, opts) => this.runLiveResearchAgent(name, prompt, ctx, opts),
			createAgentManager: ({ maxConcurrentBackgroundAgents, spawnAgent }) =>
				new AgentManager(undefined, maxConcurrentBackgroundAgents, undefined, {
					spawnAgent: (name, prompt, ctx, opts) => spawnAgent(name, prompt, ctx, opts)
				})
		});
	}

	listTraceSessions(): KernelTraceSessionListResponse {
		return {
			trace_sessions: [...this.traceIdentities.values()]
				.map((trace) => {
					const container = this.containers.get(trace.containerId);
					if (!container) return null;
					const piSessions = this.piSessions.filter(
						(session) =>
							session.appSessionId === trace.appSessionId ||
							session.containerId === trace.containerId
					);
					const events = this.events.filter(
						(event) =>
							event.appSessionId === trace.appSessionId ||
							event.containerId === trace.containerId
					);
					return {
						id: trace.appSessionId,
						containerId: trace.containerId,
						label: container.label,
						appSessionSlug: trace.appSessionSlug,
						topic: trace.topic,
						status: container.status,
						appSessionType: "example",
						phase: container.phase ?? PHASE,
						createdAt: container.createdAt,
						updatedAt: container.updatedAt,
						piSessionCount: piSessions.length,
						eventCount: events.length,
						latestEventAt: events.at(-1)?.timestamp ?? null,
						metadata: container.metadata
					};
				})
				.filter((trace) => trace !== null)
				.sort((a, b) => {
					const seedDelta = Number(isSeedTrace(a)) - Number(isSeedTrace(b));
					if (seedDelta !== 0) return seedDelta;
					return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
				}),
			unlinked: null
		};
	}

	getTraceSessionDetail(id = APP_SESSION_ID): KernelTraceSessionDetail | null {
		const trace = this.resolveTraceIdentity(id);
		if (!trace) return null;
		const container = this.containers.get(trace.containerId);
		if (!container) return null;
		const piSessions = this.piSessions.filter(
			(session) =>
				session.appSessionId === trace.appSessionId ||
				session.containerId === trace.containerId
		);
		const agentRuns = this.agentRuns.filter(
			(run) =>
				run.containerId === trace.containerId ||
				piSessions.some((session) => session.id === run.piSessionId)
		);
		const events = this.events.filter(
			(event) =>
				event.appSessionId === trace.appSessionId ||
				event.containerId === trace.containerId
		);
		return {
			session: {
				id: trace.appSessionId,
				containerId: trace.containerId,
				appSessionSlug: trace.appSessionSlug,
				topic: trace.topic,
				status: container.status,
				appSessionType: "example",
				createdAt: container.createdAt,
				updatedAt: events.at(-1)?.timestamp ?? container.updatedAt
			},
			container,
			containers: [container],
			pi_sessions: piSessions,
			agent_runs: agentRuns,
			events
		};
	}

	async getResearchInfo(): Promise<ResearchHarnessInfo> {
		const registry = await this.registryPromise;
		const traces = this.listTraceSessions().trace_sessions;
		const trace = traces[0] ?? {
			label: "Simple Research Kernel",
			piSessionCount: 0,
			eventCount: 0,
			latestEventAt: null
		};
		return {
			kernelId: this.kernel.id,
			concurrency: this.kernel.concurrency,
			memoryDir: relative(EXAMPLE_ROOT, WORKING_MEMORY_DIR),
			agents: registry.list().map((agent) => this.summarizeAgent(agent)),
			activeRuns: [...this.researchRuns.values()].filter((run) => run.status === "running"),
			dummySession: {
				id: APP_SESSION_ID,
				label: "No seed research session",
				description:
					"Research traces are created only when a user starts a run."
			},
			trace: {
				label: trace.label,
				piSessionCount: trace.piSessionCount,
				eventCount: trace.eventCount,
				latestEventAt: trace.latestEventAt
			},
			artifacts: {
				scoutReports: this.summarizeArtifacts(this.listScoutReportFiles()),
				reports: this.summarizeArtifacts(this.listReportFiles())
			},
			latestReport: this.latestReportText
		};
	}

	async startResearchRun(
		prompt: string,
		kind: ResearchRunSummary["kind"] = "user"
	): Promise<ResearchRunSummary> {
		const id = randomUUID();
		const trace = this.createTraceIdentity(id, prompt, kind);
		this.ensureTraceContainer(trace, {
			startedAt: kind === "dummy" ? iso(this.startedAt) : new Date().toISOString()
		});
		this.seedLifecycle(trace);
		const artifactSnapshot = this.snapshotArtifacts();
		const run: ResearchRunSummary = {
			id,
			appSessionId: trace.appSessionId,
			appSessionSlug: trace.appSessionSlug,
			containerId: trace.containerId,
			prompt,
			kind,
			status: "running",
			startedAt: new Date().toISOString(),
			completedAt: null,
			error: null
		};
		this.researchRuns.set(id, run);

		void this.kernel
			.spawnAgent("research-coordinator", prompt, null, {
				variables: this.variablesFor("research-coordinator", prompt),
				appSessionId: trace.appSessionId,
				appSessionSlug: trace.appSessionSlug,
				appSessionDir: WORKING_MEMORY_DIR,
				piSessionsDir: this.piSessionsDir,
				piAgentDir: PI_AGENT_DIR,
				workingDir: EXAMPLE_ROOT,
				containerId: trace.containerId,
				phase: PHASE,
				displayLabel: this.displayLabel("research-coordinator"),
				traceWriter: this.createTraceWriter(trace)
			})
			.then(() => {
				const artifactError = this.validateCompletedRun(artifactSnapshot);
				if (artifactError) throw new Error(artifactError);
				run.status = "completed";
				run.completedAt = new Date().toISOString();
				this.markTraceContainer(trace.containerId, "completed", run.completedAt);
			})
			.catch((err) => {
				run.status = "error";
				run.completedAt = new Date().toISOString();
				run.error = err instanceof Error ? err.message : String(err);
				this.markTraceContainer(trace.containerId, "error", run.completedAt);
				console.error("Failed to run Simple Research Kernel", err);
			});

		return run;
	}

	private async runLiveResearchAgent(
		agentName: string,
		prompt: string,
		ctx?: KernelExtensionContext | null,
		opts: KernelSpawnOptions = {}
	): Promise<KernelSpawnAgentResult> {
		const spawnAgent = await this.getLiveSpawnAgent();
		return spawnAgent(agentName, prompt, ctx as unknown as ExtensionContext | null | undefined, {
			...opts,
			workingDir: opts.workingDir ?? EXAMPLE_ROOT,
			appSessionDir: opts.appSessionDir ?? WORKING_MEMORY_DIR,
			piSessionsDir: opts.piSessionsDir ?? this.piSessionsDir,
			piAgentDir: opts.piAgentDir ?? PI_AGENT_DIR,
			displayLabel: opts.displayLabel ?? this.displayLabel(agentName),
			variables: {
				...this.variablesFor(agentName, prompt),
				...(opts.variables ?? {})
			}
		});
	}

	private async getLiveSpawnAgent(): Promise<KernelSpawnAgent> {
		if (this.liveSpawnAgentPromise) return this.liveSpawnAgentPromise;
		this.liveSpawnAgentPromise = this.registryPromise.then((registry) =>
			createSpawnAgent({
				loadAgent: (name) => {
					const agent = registry.get(name);
					return {
						...agent.parsed,
						frontmatter: {
							...agent.parsed.frontmatter,
							model: this.model
						}
					};
				},
				loadAgentResolver: async (name) => {
					const agent = registry.get(name);
					return agent.contextModulePath ? this.loadContextResolver(agent) : null;
				},
				buildPrivateRegisterFactory: async (name) => {
					const agent = registry.get(name);
					return this.loadPrivateRegisterFactory(agent);
				},
				buildToolFactories: () => [],
				createContextCatalog: () => {
					const catalog = createDefaultCatalog();
					catalog.register(workingMemoryLoader);
					return catalog;
				},
				createSpawnContext: (params) =>
					createSpawnContext({
						...params,
						sessionData: {
							workingMemoryDir: WORKING_MEMORY_DIR
						}
					}),
				getDb: () => {
					if (!this.db) {
						throw new Error("Simple Research Kernel requires a database-backed spawn adapter.");
					}
					return this.db;
				},
				createAppSessionBinding: (opts) =>
					opts.appSessionId
						? {
								customType: "agent-kernel:session-binding",
								data: {
									appSessionId: opts.appSessionId,
									appSessionSlug: opts.appSessionSlug,
									appSessionDir: opts.appSessionDir,
									containerId: opts.containerId,
									phase: opts.phase
								}
							}
						: undefined,
				piLifecycleCustomType: "agent-kernel:pi-lifecycle",
				logger: console,
				lifecycleLogger: console
			})
		);
		return this.liveSpawnAgentPromise;
	}

	private variablesFor(agentName: string, prompt: string): Record<string, unknown> {
		const common = {
			research_memory_dir: "research-memory",
			phase: PHASE
		};
		if (agentName === "research-coordinator") {
			return {
				...common,
				user_prompt: prompt
			};
		}
		return {
			...common,
			focus: prompt
		};
	}

	private createTraceWriter(trace: ResearchTraceIdentity) {
		return {
			submit: (event: ProtocolTraceEvent) => {
				const timestamp = Date.parse(event.timestamp);
				this.addEvent(
					{
						...event,
						containerId: event.containerId ?? trace.containerId
					},
					Number.isFinite(timestamp) ? timestamp : Date.now(),
					{
						piSessionId: event.piSessionUuid,
						containerId: event.containerId ?? trace.containerId
					}
				);
			}
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

	private async loadPrivateRegisterFactory(agent: AgentDefinition): Promise<ExtensionFactory | null> {
		if (!agent.indexModulePath) return null;
		const imported = (await import(pathToFileURL(agent.indexModulePath).href)) as {
			default?: { register?: SimpleResearchAgentRegisterFn };
			register?: SimpleResearchAgentRegisterFn;
		};
		const register = imported.default?.register ?? imported.register;
		if (!register) return null;
		return (pi) => register(pi, this.toolRuntime);
	}

	private reviewResearchReports(question?: string): ToolResponse {
		const files = this.listScoutReportFiles();
		const reports = files.map((file) => ({
			path: relative(EXAMPLE_ROOT, file),
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
		return this.kernel.agentManager.spawnAndWait(
			pi,
			ctx as unknown as KernelExtensionContext,
			"report-writer",
			focus,
			{
				description: "Write the final research report",
				workingDir: EXAMPLE_ROOT,
				appSessionId: runCtx.appSessionId,
				appSessionSlug: runCtx.appSessionSlug,
				appSessionDir: WORKING_MEMORY_DIR,
				piSessionsDir: this.piSessionsDir,
				containerId: runCtx.containerId,
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
		const reportPath = this.writeArtifact(SCOUT_REPORTS_DIR, title ?? "scout-report", content);
		return {
			text: `Wrote scout report to ${relative(EXAMPLE_ROOT, reportPath)}.`,
			details: {
				path: relative(EXAMPLE_ROOT, reportPath)
			}
		};
	}

	private writeFinalReport(title: string | undefined, content: string): ToolResponse {
		const reportPath = this.writeArtifact(REPORTS_DIR, title ?? "research-report", content);
		this.latestReportText = content;
		return {
			text: `Wrote final report to ${relative(EXAMPLE_ROOT, reportPath)}.`,
			details: {
				path: relative(EXAMPLE_ROOT, reportPath)
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
		return Promise.all(
			assignments.map((assignment) =>
				this.kernel.agentManager.spawnAndWait(
					pi,
					ctx as unknown as KernelExtensionContext,
					"source-scout",
					assignment.prompt,
					{
						description: assignment.focus,
						workingDir: EXAMPLE_ROOT,
						appSessionId: runCtx.appSessionId,
						appSessionSlug: runCtx.appSessionSlug,
						appSessionDir: WORKING_MEMORY_DIR,
						piSessionsDir: this.piSessionsDir,
						containerId: runCtx.containerId,
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

	private snapshotArtifacts(): ArtifactSnapshot {
		return {
			scoutReports: this.listScoutReportFiles().length,
			finalReports: this.listReportFiles().length
		};
	}

	private validateCompletedRun(snapshot: ArtifactSnapshot): string | null {
		const scoutReportsWritten = this.listScoutReportFiles().length - snapshot.scoutReports;
		const finalReportsWritten = this.listReportFiles().length - snapshot.finalReports;
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
		const files = this.resolveContextFiles(paths);
		const fileSummaries: Array<{ path: string; bytes: number; truncated: boolean }> = [];
		let remainingBytes = 60_000;
		const blocks = files.map((file) => {
			const raw = readFileSync(file, "utf8");
			const bytes = Buffer.byteLength(raw, "utf8");
			const budget = Math.max(0, Math.min(remainingBytes, 14_000));
			const content = raw.slice(0, budget);
			remainingBytes -= Buffer.byteLength(content, "utf8");
			const truncated = content.length < raw.length;
			const relPath = relative(EXAMPLE_ROOT, file);
			fileSummaries.push({ path: relPath, bytes, truncated });
			return `<file path="${relPath}" bytes="${bytes}" truncated="${truncated}">\n${content}\n</file>`;
		});
		return {
			text: blocks.length > 0 ? blocks.join("\n\n") : "No matching context files were found.",
			files: fileSummaries
		};
	}

	private resolveContextFiles(paths?: string[]): string[] {
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
			const fullPath = this.resolveExamplePath(requestedPath);
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

	private resolveExamplePath(requestedPath: string): string {
		const fullPath = resolve(EXAMPLE_ROOT, requestedPath);
		if (fullPath !== EXAMPLE_ROOT && !fullPath.startsWith(`${EXAMPLE_ROOT}/`)) {
			throw new Error(`Path escapes the example workspace: ${requestedPath}`);
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

	private readMarkdownSummaries(files: string[]): Array<{ path: string; bytes: number; title: string }> {
		return files.map((file) => {
			const content = readFileSync(file, "utf8");
			const title =
				content
					.split("\n")
					.find((line) => line.startsWith("# "))
					?.replace(/^#\s+/, "")
					.trim() || basename(file, extname(file));
			return {
				path: relative(EXAMPLE_ROOT, file),
				bytes: Buffer.byteLength(content, "utf8"),
				title
			};
		});
	}

	private async loadContextResolver(agent: AgentDefinition): Promise<AgentContextResolver> {
		if (!agent.contextModulePath) {
			return {
				loaders: [],
				assemble: () => ""
			};
		}

		const imported = await import(pathToFileURL(agent.contextModulePath).href);
		const candidate = (imported.default ?? imported) as Partial<AgentContextResolver>;
		if (!Array.isArray(candidate.loaders) || typeof candidate.assemble !== "function") {
			throw new Error(`Context sidecar must export loaders and assemble(): ${agent.contextModulePath}`);
		}

		return {
			loaders: candidate.loaders,
			assemble: candidate.assemble
		};
	}

	private seedLifecycle(trace: ResearchTraceIdentity): void {
		const container = this.containers.get(trace.containerId);
		const base = Date.parse(container?.startedAt ?? new Date().toISOString());
		this.addEvent(createPhaseStartEvent(trace.appSessionId, SYSTEM_USER_ID, PHASE), base + 100, {
			containerId: trace.containerId
		});
		this.addEvent(
			createContainerStartEvent(trace.appSessionId, SYSTEM_USER_ID, {
				container_id: trace.containerId,
				level: "foundation",
				checkpoint_id: null,
				task_group_id: null,
				parent_container_id: null,
				label: container?.label ?? trace.label,
				producer_stage: "docs",
				phase: PHASE
			}),
			base + 200,
			{ containerId: trace.containerId }
		);
	}

	private createTraceIdentity(
		runId: string,
		prompt: string,
		kind: ResearchRunSummary["kind"]
	): ResearchTraceIdentity {
		if (kind === "dummy") {
			const trace = {
				appSessionId: APP_SESSION_ID,
				appSessionSlug: APP_SESSION_SLUG,
				containerId: ROOT_CONTAINER_ID,
				label: "Seed Research Trace",
				topic: "Simple Research Kernel demo",
				kind,
				prompt
			};
			this.traceIdentities.set(trace.appSessionId, trace);
			return trace;
		}

		const slug = safeSlug(prompt);
		const suffix = runId.slice(0, 8);
		const trace = {
			appSessionId: runId,
			appSessionSlug: `research-${slug}-${suffix}`.slice(0, 90),
			containerId: `simple-research-kernel-${suffix}`,
			label: `Research: ${prompt.slice(0, 72)}`,
			topic: prompt,
			kind,
			prompt
		};
		this.traceIdentities.set(trace.appSessionId, trace);
		return trace;
	}

	private resolveTraceIdentity(id: string | null | undefined): ResearchTraceIdentity | null {
		if (!id) return null;
		for (const trace of this.traceIdentities.values()) {
			if (trace.appSessionId === id || trace.appSessionSlug === id || trace.containerId === id) {
				return trace;
			}
		}
		return null;
	}

	private ensureTraceContainer(
		trace: ResearchTraceIdentity,
		opts: { startedAt: string }
	): KernelContainerSummary {
		const existing = this.containers.get(trace.containerId);
		if (existing) return existing;

		const container: KernelContainerSummary = {
			id: trace.containerId,
			parentContainerId: null,
			label: trace.label,
			status: "running",
			workingDir: EXAMPLE_ROOT,
			worktreePath: null,
			phase: PHASE,
			phaseVocabulary: [PHASE],
			metadata: traceMetadata(trace),
			startedAt: opts.startedAt,
			completedAt: null,
			createdAt: opts.startedAt,
			updatedAt: opts.startedAt
		};
		this.containers.set(container.id, container);
		this.persistContainer(container);
		return container;
	}

	private touchTraceContainer(containerId: string, updatedAt: string): void {
		const container = this.containers.get(containerId);
		if (!container) return;
		container.updatedAt = updatedAt;
		this.persistContainer(container);
	}

	private markTraceContainer(containerId: string, status: string, completedAt: string): void {
		const container = this.containers.get(containerId);
		if (!container) return;
		container.status = status;
		container.completedAt = completedAt;
		container.updatedAt = completedAt;
		this.persistContainer(container);
	}

	private ensureWorkingMemory(): void {
		mkdirSync(SCOUT_REPORTS_DIR, { recursive: true });
		mkdirSync(REPORTS_DIR, { recursive: true });
	}

	private listScoutReportFiles(): string[] {
		return collectFiles(SCOUT_REPORTS_DIR, new Set([".md"])).filter(
			(file) => basename(file) !== "README.md"
		);
	}

	private listReportFiles(): string[] {
		return collectFiles(REPORTS_DIR, new Set([".md"])).filter((file) => basename(file) !== "README.md");
	}

	private summarizeAgent(agent: AgentDefinition): ResearchAgentSummary {
		const fm = agent.parsed.frontmatter;
		return {
			name: agent.name,
			description: fm.description,
			model: this.model,
			tools: fm.tools,
			disallowedTools: fm.disallowed_tools ?? [],
			extensions: fm.extensions ?? true,
			canSpawnSubagent: fm.can_spawn_subagent ?? false,
			variables: Object.entries(fm.variables).map(([name, decl]) => ({
				name,
				defaultValue: decl.default,
				description: decl.description ?? null
			})),
			maxTurns: fm.max_turns ?? null,
			thinking: fm.thinking ?? null,
			runInBackground: fm.run_in_background ?? false,
			hasContext: agent.contextModulePath !== null,
			contextModule: agent.contextModulePath ? relative(EXAMPLE_ROOT, agent.contextModulePath) : null,
			agentFile: relative(EXAMPLE_ROOT, agent.agentFile),
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

	async flushPersistence(): Promise<void> {
		let tail = this.persistenceTail;
		await tail;
		while (tail !== this.persistenceTail) {
			tail = this.persistenceTail;
			await tail;
		}
	}

	private persist(operation: () => Promise<void> | void): void {
		if (!this.persistence) return;
		this.persistenceTail = this.persistenceTail
			.then(async () => {
				await operation();
			})
			.catch((error) => {
				console.error(
					"Simple Research Kernel persistence failed:",
					error instanceof Error ? error.message : String(error)
				);
			});
	}

	private persistContainer(container: KernelContainerSummary): void {
		if (!this.persistence?.upsertContainer) return;
		this.persist(() => this.persistence!.upsertContainer!({ ...container }));
	}

	private persistPiSession(session: PiSessionWithCount): void {
		if (!this.persistence?.upsertPiSession) return;
		this.persist(() => this.persistence!.upsertPiSession!({ ...session }));
	}

	private persistAgentRun(run: AgentRun): void {
		if (!this.persistence?.upsertAgentRun) return;
		this.persist(() => this.persistence!.upsertAgentRun!({ ...run }));
	}

	private persistTraceEvent(row: TraceEventRow, event: ProtocolTraceEvent): void {
		if (!this.persistence?.insertTraceEvent) return;
		const persistedEvent: ProtocolTraceEvent = {
			...event,
			source: row.source,
			timestamp: row.timestamp,
			...(row.containerId ? { containerId: row.containerId } : {}),
			...(row.piSessionId ? { piSessionUuid: row.piSessionId } : {})
		};
		this.persist(() => this.persistence!.insertTraceEvent!(persistedEvent));
	}

	private addEvent(
		event: ProtocolTraceEvent,
		timestampMs: number,
		opts: { piSessionId?: string; containerId?: string | null } = {}
	): void {
		this.eventCounter += 1;
		const row: TraceEventRow = {
			id: `event-${String(this.eventCounter).padStart(4, "0")}`,
			eventId: event.eventId,
			appSessionId: event.appSessionId,
			containerId: opts.containerId ?? event.containerId ?? null,
			userId: event.userId,
			type: event.type,
			source: event.source ?? TraceSource.KERNEL,
			traceLevel: event.traceLevel,
			eventData: event.eventData,
			spanId: event.spanId ?? null,
			parentEventId: event.parentEventId ?? null,
			timestamp: iso(timestampMs),
			piSessionId: opts.piSessionId ?? null,
			agentId: event.agentId ?? null
		};
		this.events.push(row);
		this.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
		this.persistTraceEvent(row, event);
	}
}
