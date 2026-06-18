import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	AgentManager,
	buildRegistry,
	createKernel,
	runWithContext,
	type AgentDefinition,
	type AgentRegistry,
	type KernelExtensionAPI,
	type KernelExtensionContext,
	type KernelInstance
} from "@agent-kernel/kernel";
import {
	buildContext,
	createDefaultCatalog,
	type AgentContextResolver,
	type BuildContextResult,
	type ContextLifecycleEmitter,
	type Loader,
	type LoaderDeclaration,
	type LoaderResult,
	type RuntimeState,
	type SpawnContext
} from "@agent-kernel/kernel/context";
import { resolveSystemPrompt } from "@agent-kernel/kernel/spawn-pipeline/system-prompt-resolver";
import type { AgentSpawnOptions } from "@agent-kernel/kernel/subagents";
import {
	createAgentRunEndEvent,
	createAgentRunStartEvent,
	createAgentSessionEndEvent,
	createAgentSessionStartEvent,
	createAssistantMessageEvent,
	createContainerStartEvent,
	createContextBuildCompletedEvent,
	createContextBuildStartedEvent,
	createContextInputResolvedEvent,
	createPhaseStartEvent,
	createSystemPromptResolvedEvent,
	createToolCallEndEvent,
	createToolCallStartEvent,
	createUserMessageEvent,
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

export const APP_SESSION_ID = "11111111-1111-4111-8111-111111111111";
export const ROOT_CONTAINER_ID = "simple-research-kernel";
export const PHASE = "research";
export const APP_SESSION_SLUG = "simple-research-kernel";
export const EXAMPLE_ROOT = resolve(import.meta.dir, "..");
const AGENT_CATALOG_DIR = join(import.meta.dir, "agent-catalog");
export const WORKING_MEMORY_DIR = join(EXAMPLE_ROOT, "research-memory");
const SCOUT_REPORTS_DIR = join(WORKING_MEMORY_DIR, "scout-reports");
const REPORTS_DIR = join(WORKING_MEMORY_DIR, "reports");
const DEFAULT_RESEARCH_PROMPT =
	"Research how the Simple Research Kernel should present agents, context loading, subagents, and working memory.";

type DemoRunResult = {
	responseText: string;
	session: { sessionId: string; messages: unknown[]; steer(message: string): Promise<void> };
	aborted: boolean;
};

type DemoRunOptions = AgentSpawnOptions & {
	prompt?: string;
	focus?: string;
};

type ResearchHarnessInfo = {
	kernelId: string;
	concurrency: { maxBackgroundAgents: number };
	memoryDir: string;
	agents: { name: string; description: string; model: string; hasContext: boolean }[];
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
	latestReport: string;
};

type ResearchRunSummary = {
	id: string;
	prompt: string;
	kind: "dummy" | "user";
	status: "running" | "completed" | "error";
	startedAt: string;
	completedAt: string | null;
	error: string | null;
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

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
		DemoRunOptions,
		DemoRunResult,
		AgentManager
	>;

	private readonly persistence?: SimpleResearchKernelPersistence;
	private persistenceTail: Promise<void> = Promise.resolve();
	private readonly registryPromise: Promise<AgentRegistry>;
	private readonly startedAt = nowRounded() - 90_000;
	private readonly container: KernelContainerSummary;
	private readonly piSessions: PiSessionWithCount[] = [];
	private readonly agentRuns: AgentRun[] = [];
	private readonly events: TraceEventRow[] = [];
	private eventCounter = 0;
	private runCounter = 0;
	private reportCounter = 0;
	private latestReportText = "";
	private readonly researchRuns = new Map<string, ResearchRunSummary>();

	constructor(options: { persistence?: SimpleResearchKernelPersistence } = {}) {
		this.persistence = options.persistence;
		this.ensureWorkingMemory();
		this.registryPromise = buildRegistry({ catalogRoot: AGENT_CATALOG_DIR });
		this.container = {
			id: ROOT_CONTAINER_ID,
			parentContainerId: null,
			label: "Simple Research Kernel",
			status: "running",
			workingDir: EXAMPLE_ROOT,
			worktreePath: null,
			phase: PHASE,
			phaseVocabulary: [PHASE],
			metadata: {
				description:
					"A simple research kernel that fans out to scouts, reads their reports, optionally spawns follow-up scouts, and queues a final report writer."
			},
			startedAt: iso(this.startedAt),
			completedAt: null,
			createdAt: iso(this.startedAt),
			updatedAt: iso(this.startedAt)
		};
		this.persistContainer(this.container);

		this.kernel = createKernel<
			KernelExtensionContext | null,
			DemoRunOptions,
			DemoRunResult,
			AgentManager
		>({
			id: "simple-research-kernel",
			concurrency: { maxBackgroundAgents: 3 },
			spawnAgent: (name, prompt, ctx, opts) => this.runResearchAgent(name, prompt, ctx, opts),
			createAgentManager: ({ maxConcurrentBackgroundAgents, spawnAgent }) =>
				new AgentManager(undefined, maxConcurrentBackgroundAgents, undefined, {
					spawnAgent: (name, prompt, ctx, opts) => spawnAgent(name, prompt, ctx, opts)
				})
		});

		this.seedLifecycle();
		this.startResearchRun(DEFAULT_RESEARCH_PROMPT, "dummy");
	}

	listTraceSessions(): KernelTraceSessionListResponse {
		return {
			trace_sessions: [
				{
					id: APP_SESSION_ID,
					containerId: ROOT_CONTAINER_ID,
					label: this.container.label,
					appSessionSlug: APP_SESSION_SLUG,
					topic: "Simple Research Kernel demo",
					status: this.container.status,
					appSessionType: "example",
					phase: PHASE,
					createdAt: this.container.createdAt,
					updatedAt: this.container.updatedAt,
					piSessionCount: this.piSessions.length,
					eventCount: this.events.length,
					latestEventAt: this.events.at(-1)?.timestamp ?? null,
					metadata: this.container.metadata
				}
			],
			unlinked: null
		};
	}

	getTraceSessionDetail(): KernelTraceSessionDetail {
		return {
			session: {
				id: APP_SESSION_ID,
				containerId: ROOT_CONTAINER_ID,
				appSessionSlug: APP_SESSION_SLUG,
				topic: "Simple Research Kernel demo",
				status: this.container.status,
				appSessionType: "example",
				createdAt: this.container.createdAt,
				updatedAt: this.events.at(-1)?.timestamp ?? this.container.updatedAt
			},
			container: this.container,
			containers: [this.container],
			pi_sessions: this.piSessions,
			agent_runs: this.agentRuns,
			events: this.events
		};
	}

	async getResearchInfo(): Promise<ResearchHarnessInfo> {
		const registry = await this.registryPromise;
		const trace = this.listTraceSessions().trace_sessions[0]!;
		return {
			kernelId: this.kernel.id,
			concurrency: this.kernel.concurrency,
			memoryDir: relative(EXAMPLE_ROOT, WORKING_MEMORY_DIR),
			agents: registry.list().map((agent) => ({
				name: agent.name,
				description: agent.parsed.frontmatter.description,
				model: agent.parsed.frontmatter.model,
				hasContext: agent.contextModulePath !== null
			})),
			activeRuns: [...this.researchRuns.values()].filter((run) => run.status === "running"),
			dummySession: {
				id: APP_SESSION_ID,
				label: "Dummy Simple Research Kernel session",
				description:
					"Seeded on server start so the viewer always has a complete research-agent trace."
			},
			trace: {
				label: trace.label,
				piSessionCount: trace.piSessionCount,
				eventCount: trace.eventCount,
				latestEventAt: trace.latestEventAt
			},
			latestReport: this.latestReportText
		};
	}

	startResearchRun(prompt: string, kind: ResearchRunSummary["kind"] = "user"): ResearchRunSummary {
		const id = randomUUID();
		const run: ResearchRunSummary = {
			id,
			prompt,
			kind,
			status: "running",
			startedAt: new Date().toISOString(),
			completedAt: null,
			error: null
		};
		this.researchRuns.set(id, run);

		void this.kernel
			.spawnAgent("research-coordinator", prompt, null, { prompt })
			.then(() => {
				run.status = "completed";
				run.completedAt = new Date().toISOString();
			})
			.catch((err) => {
				run.status = "error";
				run.completedAt = new Date().toISOString();
				run.error = err instanceof Error ? err.message : String(err);
				console.error("Failed to run Simple Research Kernel", err);
			});

		return run;
	}

	async runResearchAgent(
		agentName: string,
		prompt: string,
		ctx?: KernelExtensionContext | null,
		opts: DemoRunOptions = {}
	): Promise<DemoRunResult> {
		const registry = await this.registryPromise;
		const agent = registry.get(agentName);
		const runNumber = ++this.runCounter;
		const base = nowRounded() + runNumber * 1500;
		const piSessionId = randomUUID();
		const runId = randomUUID();
		const parentPiSessionId = ctx?.sessionManager.getSessionId() ?? null;
		const phase = opts.phase ?? PHASE;
		const containerId = opts.containerId ?? ROOT_CONTAINER_ID;
		const model = agent.parsed.frontmatter.model;
		const modelAlias = model.replace(/^demo-/, "");
		const focus = opts.focus ?? prompt;
		const runtime: RuntimeState = {
			cwd: EXAMPLE_ROOT,
			appSessionId: APP_SESSION_ID,
			platform: "simple-research-kernel-demo",
			topic: "Simple Research Kernel demo",
			phase,
			status: "running",
			appSessionDir: WORKING_MEMORY_DIR
		};
		const resolved = resolveSystemPrompt({
			parsed: agent.parsed,
			callerVariables: {
				focus,
				phase,
				research_memory_dir: "research-memory",
				user_prompt: prompt
			},
			runtime
		});

		const piSession: PiSessionWithCount = {
			id: piSessionId,
			appSessionId: APP_SESSION_ID,
			parentId: parentPiSessionId,
			agentName,
			model,
			modelAlias,
			status: "running",
			phase,
			containerId,
			displayLabel: this.displayLabel(agentName),
			startedAt: iso(base),
			completedAt: null,
			createdAt: iso(base),
			updatedAt: iso(base),
			eventCount: 0
		};
		this.piSessions.push(piSession);
		this.persistPiSession(piSession);

		const run: AgentRun = {
			id: runId,
			piSessionId,
			runNumber: 1,
			agentName,
			status: "running",
			parentRunId: opts.parentRunId ?? null,
			containerId,
			phase,
			displayLabel: this.displayLabel(agentName),
			parentToolUseId: opts.parentToolUseId ?? null,
			startedAt: iso(base + 100),
			completedAt: null,
			createdAt: iso(base + 100),
			updatedAt: iso(base + 100)
		};
		this.agentRuns.push(run);
		this.persistAgentRun(run);

		const session = {
			sessionId: piSessionId,
			messages: [],
			async steer() {}
		};
		opts.onSessionCreated?.(session);

		this.addEvent(
			createAgentSessionStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, agentName, model, {
				modelAlias
			}),
			base + 50,
			{ piSessionId, containerId }
		);
		this.addEvent(
			createAgentRunStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, agentName, runId, {
				containerId,
				phase,
				displayLabel: this.displayLabel(agentName),
				parentRunId: opts.parentRunId,
				parentToolUseId: opts.parentToolUseId,
				piSessionUuid: piSessionId
			}),
			base + 100,
			{ piSessionId, containerId }
		);
		this.addEvent(
			createSystemPromptResolvedEvent(
				APP_SESSION_ID,
				SYSTEM_USER_ID,
				{
					agent_name: agentName,
					rendered_prompt: resolved.systemPrompt,
					tools_allowlist: agent.parsed.frontmatter.tools,
					tools_disallowlist: agent.parsed.frontmatter.disallowed_tools ?? [],
					extensions: agent.parsed.frontmatter.extensions ?? true,
					domain_rules_installed: false,
					variables_resolved: resolved.variables
				},
				{ piSessionUuid: piSessionId }
			),
			base + 180,
			{ piSessionId, containerId }
		);
		await delay(160);

		const context = await this.buildAgentContext({
			agent,
			agentName,
			prompt,
			piSessionId,
			runtime,
			variables: resolved.variables,
			baseTime: base + 260
		});

		this.addEvent(createUserMessageEvent(APP_SESSION_ID, SYSTEM_USER_ID, prompt, phase), base + 620, {
			piSessionId,
			containerId
		});
		await delay(160);

		let responseText: string;
		if (agentName === "research-coordinator") {
			responseText = await this.runCoordinatorFlow({
				prompt,
				piSessionId,
				runId,
				base,
				context
			});
		} else if (agentName === "source-scout") {
			responseText = await this.runSourceScoutFlow({ prompt, runNumber, piSessionId, base, context });
		} else if (agentName === "report-writer") {
			responseText = await this.runSynthesisWriterFlow({ prompt, runNumber, piSessionId, base, context });
		} else {
			responseText = `${this.displayLabel(agentName)} completed the local demo run.`;
		}

		const endBase = Math.max(this.latestEventTimeMsForPi(piSessionId), base + 1040);
		this.addEvent(
			createAssistantMessageEvent(APP_SESSION_ID, SYSTEM_USER_ID, responseText, "markdown"),
			endBase + 100,
			{ piSessionId, containerId }
		);
		this.addEvent(
			createAgentRunEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, agentName, runId, "ok", {
				piSessionUuid: piSessionId
			}),
			endBase + 180,
			{ piSessionId, containerId }
		);
		this.addEvent(
			createAgentSessionEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, "completed", {
				inputTokens: 720 + context.totalBytes,
				outputTokens: Math.ceil(responseText.length / 4),
				cost: 0
			}),
			endBase + 240,
			{ piSessionId, containerId }
		);

		piSession.status = "completed";
		piSession.completedAt = iso(endBase + 240);
		piSession.updatedAt = iso(endBase + 240);
		piSession.eventCount = this.events.filter((event) => event.piSessionId === piSessionId).length;
		run.status = "completed";
		run.completedAt = iso(endBase + 180);
		run.updatedAt = iso(endBase + 180);
		this.container.updatedAt = iso(endBase + 240);
		this.persistPiSession(piSession);
		this.persistAgentRun(run);
		this.persistContainer(this.container);

		return { responseText, session, aborted: false };
	}

	private async runCoordinatorFlow(input: {
		prompt: string;
		piSessionId: string;
		runId: string;
		base: number;
		context: BuildContextResult;
	}): Promise<string> {
		const dispatchToolUseId = randomUUID();
		this.addEvent(
			createToolCallStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, "spawn_research_scouts", dispatchToolUseId, {
				toolInput: {
					agents: ["source-scout", "source-scout"],
					contextBytes: input.context.totalBytes
				},
				spanId: dispatchToolUseId
			}),
			input.base + 760,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		await delay(220);

		const fakePi = this.createParentPi();
		const fakeCtx = this.createParentContext(input.piSessionId);
		const initialScoutPrompts = [
			`Scout the kernel architecture and context-loading setup for: ${input.prompt}`,
			`Scout the working-memory and demo-product angle for: ${input.prompt}`
		];

		const scoutRecords = await this.spawnScoutBatch({
			prompts: initialScoutPrompts,
			parentRunId: input.runId,
			toolCallId: dispatchToolUseId,
			fakePi,
			fakeCtx
		});

		const afterScouts = this.latestEventTimeMs();
		this.addEvent(
			createToolCallEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, "spawn_research_scouts", dispatchToolUseId, {
				toolOutput: `Completed ${scoutRecords.length} source-scout reports.`,
				durationMs: Math.max(1, afterScouts - (input.base + 760)),
				spanId: dispatchToolUseId
			}),
			afterScouts + 120,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		await delay(180);

		const reviewToolUseId = randomUUID();
		this.addEvent(
			createToolCallStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, "review_research_reports", reviewToolUseId, {
				toolInput: {
					reports: scoutRecords.map((record) => record.result ?? record.status),
					reportDirectory: "research-memory/scout-reports"
				},
				spanId: reviewToolUseId
			}),
			afterScouts + 240,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		await delay(180);

		const review = this.reviewScoutReports(input.prompt, scoutRecords.length);
		const afterReview = Math.max(this.latestEventTimeMs(), afterScouts + 360);
		this.addEvent(
			createToolCallEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, "review_research_reports", reviewToolUseId, {
				toolOutput: review.summary,
				durationMs: 120,
				spanId: reviewToolUseId
			}),
			afterReview,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		await delay(160);

		if (review.needsFollowup) {
			const followupToolUseId = randomUUID();
			this.addEvent(
				createToolCallStartEvent(
					APP_SESSION_ID,
					SYSTEM_USER_ID,
					"spawn_followup_scouts",
					followupToolUseId,
					{
						toolInput: {
							gap: review.gap,
							agents: ["source-scout"]
						},
						spanId: followupToolUseId
					}
				),
				afterReview + 120,
				{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
			);
			await delay(180);

			const followupRecords = await this.spawnScoutBatch({
				prompts: [
					`Follow up on this research gap before final synthesis: ${review.gap}. Original request: ${input.prompt}`
				],
				parentRunId: input.runId,
				toolCallId: followupToolUseId,
				fakePi,
				fakeCtx
			});
			scoutRecords.push(...followupRecords);

			const afterFollowup = this.latestEventTimeMs();
			this.addEvent(
				createToolCallEndEvent(
					APP_SESSION_ID,
					SYSTEM_USER_ID,
					"spawn_followup_scouts",
					followupToolUseId,
					{
						toolOutput: `Completed ${followupRecords.length} follow-up source-scout report.`,
						durationMs: Math.max(1, afterFollowup - (afterReview + 120)),
						spanId: followupToolUseId
					}
				),
				afterFollowup + 120,
				{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
			);
			await delay(160);
		}

		const queueToolUseId = randomUUID();
		const queueStart = this.latestEventTimeMs() + 160;
		this.addEvent(
			createToolCallStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, "queue_report_writer", queueToolUseId, {
				toolInput: {
					agent: "report-writer",
					scoutReportCount: this.listScoutReportFiles().length,
					scoutResults: scoutRecords.map((record) => record.status)
				},
				spanId: queueToolUseId
			}),
			queueStart,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		await delay(180);

		const synthesisId = await runWithContext(
			this.createRunContext(input.runId, "research-coordinator"),
			async () => {
				const id = this.kernel.agentManager.spawn(
					fakePi,
					fakeCtx,
					"report-writer",
					`Read all scout reports and write the final report for: ${input.prompt}`,
					{
						description: "Queue the final report writer after scout report review",
						workingDir: EXAMPLE_ROOT,
						appSessionId: APP_SESSION_ID,
						appSessionSlug: APP_SESSION_SLUG,
						appSessionDir: WORKING_MEMORY_DIR,
						parentRunId: input.runId,
						toolCallId: queueToolUseId,
						isBackground: true
					}
				);
				await this.kernel.agentManager.waitForAll();
				return id;
			}
		);

		const afterSynthesis = this.latestEventTimeMs();
		this.addEvent(
			createToolCallEndEvent(
				APP_SESSION_ID,
				SYSTEM_USER_ID,
				"queue_report_writer",
				queueToolUseId,
				{
					toolOutput: "Report writer completed the final synthesis.",
					durationMs: Math.max(1, afterSynthesis - queueStart),
					spanId: queueToolUseId
				}
			),
			afterSynthesis + 120,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);

		return this.kernel.agentManager.getRecord(synthesisId)?.result || this.latestReportText;
	}

	private async spawnScoutBatch(input: {
		prompts: string[];
		parentRunId: string;
		toolCallId: string;
		fakePi: KernelExtensionAPI;
		fakeCtx: KernelExtensionContext;
	}) {
		return runWithContext(this.createRunContext(input.parentRunId, "research-coordinator"), () =>
			Promise.all(
				input.prompts.map((scoutPrompt) =>
					this.kernel.agentManager.spawnAndWait(
						input.fakePi,
						input.fakeCtx,
						"source-scout",
						scoutPrompt,
						{
							description: scoutPrompt,
							workingDir: EXAMPLE_ROOT,
							appSessionId: APP_SESSION_ID,
							appSessionSlug: APP_SESSION_SLUG,
							appSessionDir: WORKING_MEMORY_DIR,
							parentRunId: input.parentRunId,
							toolCallId: input.toolCallId
						}
					)
				)
			)
		);
	}

	private reviewScoutReports(prompt: string, currentScoutReportCount: number): {
		needsFollowup: boolean;
		gap: string;
		summary: string;
	} {
		const reports = this.listScoutReportFiles();
		const lowerPrompt = prompt.toLowerCase();
		const wantsDepth = /\b(deep|deeper|thorough|complete|architecture|risk|risks|compare|comparison|production|follow[- ]?up)\b/.test(
			lowerPrompt
		);
		const needsFollowup = wantsDepth && currentScoutReportCount < 3;
		const gap = needsFollowup
			? "Add a follow-up scout report covering production gaps, risks, and the next implementation step."
			: "No follow-up scout required; the initial scout reports cover architecture and demo-product behavior.";
		const reportList =
			reports.length > 0
				? reports.map((file) => `- ${relative(EXAMPLE_ROOT, file)}`).join("\n")
				: "- No scout reports are available yet.";

		return {
			needsFollowup,
			gap,
			summary: [
				`Reviewed ${currentScoutReportCount} scout report(s) from the current batch.`,
				reportList,
				needsFollowup ? `Gap found: ${gap}` : gap
			].join("\n")
		};
	}

	private async runSourceScoutFlow(input: {
		prompt: string;
		runNumber: number;
		piSessionId: string;
		base: number;
		context: BuildContextResult;
	}): Promise<string> {
		const toolUseId = randomUUID();
		this.addEvent(
			createToolCallStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, "write_research_report", toolUseId, {
				toolInput: {
					target: "research-memory/scout-reports",
					contextBytes: input.context.totalBytes
				},
				spanId: toolUseId
			}),
			input.base + 760,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		await delay(220);

		const report = this.buildScoutReport(input.prompt, input.context);
		const reportPath = join(
			SCOUT_REPORTS_DIR,
			`${String(input.runNumber).padStart(2, "0")}-${safeSlug(input.prompt)}.md`
		);
		writeFileSync(reportPath, report);

		this.addEvent(
			createToolCallEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, "write_research_report", toolUseId, {
				toolOutput: relative(EXAMPLE_ROOT, reportPath),
				durationMs: 220,
				spanId: toolUseId
			}),
			input.base + 980,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);

		return `Source scout wrote ${relative(EXAMPLE_ROOT, reportPath)}.`;
	}

	private async runSynthesisWriterFlow(input: {
		prompt: string;
		runNumber: number;
		piSessionId: string;
		base: number;
		context: BuildContextResult;
	}): Promise<string> {
		const toolUseId = randomUUID();
		this.addEvent(
			createToolCallStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, "write_report", toolUseId, {
				toolInput: {
					target: "research-memory/reports",
					contextBytes: input.context.totalBytes
				},
				spanId: toolUseId
			}),
			input.base + 760,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		await delay(240);

		const report = this.buildReport(input.prompt);
		this.reportCounter += 1;
		const reportPath = join(
			REPORTS_DIR,
			`${String(this.reportCounter).padStart(2, "0")}-research-report.md`
		);
		writeFileSync(reportPath, report);
		this.latestReportText = report;

		this.addEvent(
			createToolCallEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, "write_report", toolUseId, {
				toolOutput: relative(EXAMPLE_ROOT, reportPath),
				durationMs: 260,
				spanId: toolUseId
			}),
			input.base + 1020,
			{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
		);

		return report;
	}

	private async buildAgentContext(input: {
		agent: AgentDefinition;
		agentName: string;
		prompt: string;
		piSessionId: string;
		runtime: RuntimeState;
		variables: Record<string, unknown>;
		baseTime: number;
	}): Promise<BuildContextResult> {
		const resolver = await this.loadContextResolver(input.agent);
		const spanId = randomUUID();
		let tick = 0;
		const nextTime = () => input.baseTime + tick++ * 80;
		const emitter: ContextLifecycleEmitter = {
			contextBuildStarted: (data) => {
				this.addEvent(
					createContextBuildStartedEvent(APP_SESSION_ID, SYSTEM_USER_ID, data, {
						spanId,
						piSessionUuid: input.piSessionId
					}),
					nextTime(),
					{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
				);
			},
			contextInputResolved: (data) => {
				this.addEvent(
					createContextInputResolvedEvent(APP_SESSION_ID, SYSTEM_USER_ID, data, {
						piSessionUuid: input.piSessionId
					}),
					nextTime(),
					{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
				);
			},
			contextBuildCompleted: (data) => {
				this.addEvent(
					createContextBuildCompletedEvent(APP_SESSION_ID, SYSTEM_USER_ID, data, {
						spanId,
						piSessionUuid: input.piSessionId
					}),
					nextTime(),
					{ piSessionId: input.piSessionId, containerId: ROOT_CONTAINER_ID }
				);
			}
		};
		const catalog = createDefaultCatalog();
		catalog.register(workingMemoryLoader);
		const spawnContext: SpawnContext = {
			agentName: input.agentName,
			variables: input.variables,
			caller: { kind: "user", id: SYSTEM_USER_ID },
			runtime: input.runtime,
			paths: {
				workingDir: EXAMPLE_ROOT,
				activeSessionDir: WORKING_MEMORY_DIR
			},
			sessionData: {
				workingMemoryDir: WORKING_MEMORY_DIR,
				prompt: input.prompt
			}
		};

		return buildContext({ resolver, spawnContext, catalog, emitter });
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

	private buildScoutReport(prompt: string, context: BuildContextResult): string {
		const topic = prompt.includes("working-memory")
			? "Working memory and demo product shape"
			: prompt.includes("Follow up")
				? "Follow-up risks and production gaps"
			: "Kernel architecture and context loading";
		return [
			`# ${topic}`,
			"",
			`Prompt: ${prompt}`,
			"",
			"## Scope",
			prompt.includes("working-memory")
				? "- Investigated how durable scout reports, final reports, and run ergonomics make the demo feel like a product workflow."
				: prompt.includes("Follow up")
					? "- Investigated whether the initial scout reports left production-readiness gaps before final synthesis."
				: "- Investigated how the kernel-facing architecture is exposed through catalog files, context sidecars, and trace events.",
			"- Left final cross-scout synthesis to the report writer.",
			"",
			"## Observations",
			"- Agent definitions are loaded from `src/agent-catalog/*/agent.md`, which mirrors the host-owned catalog pattern used by larger harnesses.",
			"- Each agent colocates a `context.ts` sidecar with its prompt, so context loading is visible and editable per role.",
			"- The app registers a `working-memory` loader locally, preserving the boundary that kernel packages stay product-neutral.",
			"- Subagents run through the kernel `AgentManager`; their Pi sessions carry parent IDs and parent tool-use IDs so the viewer can nest them under coordinator dispatch calls.",
			"- Working memory makes the demo inspectable outside the trace because scout reports and final reports are normal markdown files on disk.",
			"",
			"## Evidence",
			`- Loaded ${context.loaded.length} context inputs (${context.totalBytes} rendered bytes).`,
			"- Seed brief: `research-memory/brief.md`.",
			"- Source notes: `research-memory/sources/kernel-architecture.md` and `research-memory/sources/demo-positioning.md`.",
			"- Agent catalog: `examples/simple-research-kernel/src/agent-catalog`.",
			"- Generated artifacts: `research-memory/scout-reports` and `research-memory/reports`.",
			"",
			"## Recommendation",
			"Use the Simple Research Kernel as the base demo because it is small enough to understand quickly while still exercising the contracts a real Agent Harness needs: agent definitions, context loading, subagents, working memory, report review, optional follow-up, trace reading, and final report delivery.",
			"",
			"## Residual Questions",
			"- The current runtime is deterministic; a production host should replace the simulated model/tool execution with real model calls and durable persistence.",
			""
		].join("\n");
	}

	private buildReport(prompt: string): string {
		const scoutReportFiles = this.listScoutReportFiles();
		const scoutReportList =
			scoutReportFiles.length > 0
				? scoutReportFiles.map((file) => `- ${relative(EXAMPLE_ROOT, file)}`).join("\n")
				: "- No scout reports were written yet.";

		return [
			"# Research Report",
			"",
			"## Request",
			prompt.replace(/^Write the final report for:\s*/i, ""),
			"",
			"## Executive Summary",
			"The Simple Research Kernel is a complete local research-agent demo. A coordinator receives the request, loads context, dispatches focused source scouts, waits for their reports, reviews those reports for gaps, optionally spawns a follow-up scout, queues a report writer, and returns a markdown report. That gives the Agent Kernel a base demo that is simple to understand but still representative of real multi-agent harness work.",
			"",
			"## What The Harness Demonstrates",
			"- Agent definitions live in `examples/simple-research-kernel/src/agent-catalog/*/agent.md` instead of being hardcoded into the store.",
			"- Context sidecars live beside each prompt and declare the loader inputs each role needs.",
			"- The host app registers a `working-memory` loader while the kernel remains generic.",
			"- The coordinator uses `AgentManager` to spawn source scouts and queue a report writer as nested subagents.",
			"- Intermediate scout reports and final reports are normal files under `research-memory/`.",
			"- The read API and viewer can inspect prompt resolution, context loading, tool calls, subagent links, and assistant outputs in one trace.",
			"",
			"## Agent Roles",
			"- `research-coordinator`: owns the top-level request, decomposes the work, dispatches subagents, reads their reports, decides whether follow-up is needed, queues the writer, and returns the synthesis report.",
			"- `source-scout`: investigates one narrow angle and writes a durable markdown research report.",
			"- `report-writer`: reads scout reports, working memory, and source context, then writes the final report.",
			"",
			"## Working Memory",
			"- `research-memory/brief.md` explains the intended harness workflow.",
			"- `research-memory/sources/` contains durable source notes used by all roles.",
			"- `research-memory/scout-reports/` receives generated source-scout reports.",
			"- `research-memory/reports/` receives generated synthesis reports.",
			"",
			"## Evidence From This Run",
			"Scout reports considered:",
			scoutReportList,
			"",
			"Additional seed sources:",
			"- research-memory/sources/kernel-architecture.md",
			"- research-memory/sources/demo-positioning.md",
			"",
			"## Why This Is The Base Demo",
			"Research is a strong base demo because the user value is familiar: send off a request and receive a report. It also naturally exercises the kernel behaviors that matter most: agent definitions, context loading, fan-out, waiting for subagents, reading subagent reports, optional follow-up work, artifact persistence, observability, and a final deliverable.",
			"",
			"## Limitations",
			"- This example is local and deterministic so it runs without model credentials or Postgres.",
			"- The tool calls are simulated by the demo store, but the trace shape mirrors the runtime contracts a live app would use.",
			"- A production harness should add durable storage, real model execution, richer domain tools, and app-specific viewer panels.",
			"",
			"## Recommended Next Steps",
			"- Replace the deterministic agent bodies with live model calls through the full spawn pipeline.",
			"- Continue treating `@agent-kernel/db` as the observability substrate for registered kernels.",
			"- Add real research tools, such as repository readers, web search, or document ingestion.",
			"- Add a custom viewer panel for working-memory artifacts.",
			""
		].join("\n");
	}

	private seedLifecycle(): void {
		this.addEvent(createPhaseStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, PHASE), this.startedAt + 100, {
			containerId: ROOT_CONTAINER_ID
		});
		this.addEvent(
			createContainerStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, {
				container_id: ROOT_CONTAINER_ID,
				level: "foundation",
				checkpoint_id: null,
				task_group_id: null,
				parent_container_id: null,
				label: this.container.label,
				producer_stage: "docs",
				phase: PHASE
			}),
			this.startedAt + 200,
			{ containerId: ROOT_CONTAINER_ID }
		);
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

	private displayLabel(agentName: string): string {
		return agentName
			.split("-")
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}

	private createParentPi(): KernelExtensionAPI {
		return {
			appendEntry() {
				return undefined;
			}
		};
	}

	private createParentContext(piSessionId: string): KernelExtensionContext {
		return {
			cwd: EXAMPLE_ROOT,
			sessionManager: {
				getSessionId: () => piSessionId
			}
		};
	}

	private createRunContext(runId: string, agentName: string) {
		return {
			appSessionId: APP_SESSION_ID,
			appSessionSlug: APP_SESSION_SLUG,
			appSessionDir: WORKING_MEMORY_DIR,
			runId,
			agentName,
			traceWriter: {
				submit: (event: ProtocolTraceEvent) => {
					this.addEvent(event, Date.now(), { containerId: ROOT_CONTAINER_ID });
				}
			},
			piSessionsDir: WORKING_MEMORY_DIR,
			workingDir: EXAMPLE_ROOT,
			containerId: ROOT_CONTAINER_ID,
			phase: PHASE
		};
	}

	async flushPersistence(): Promise<void> {
		let tail = this.persistenceTail;
		await tail;
		while (tail !== this.persistenceTail) {
			tail = this.persistenceTail;
			await tail;
		}
	}

	private latestEventTimeMs(): number {
		return this.events.reduce((max, event) => Math.max(max, Date.parse(event.timestamp)), this.startedAt);
	}

	private latestEventTimeMsForPi(piSessionId: string): number {
		return this.events
			.filter((event) => event.piSessionId === piSessionId)
			.reduce((max, event) => Math.max(max, Date.parse(event.timestamp)), this.startedAt);
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
