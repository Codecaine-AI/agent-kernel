import {
	createAgentRunEndEvent,
	createAgentRunStartEvent,
	createAgentSessionEndEvent,
	createAgentSessionStartEvent,
	createAssistantMessageEvent,
	createContainerEndEvent,
	createContainerStartEvent,
	createContextBuildCompletedEvent,
	createContextBuildStartedEvent,
	createContextInputResolvedEvent,
	createPhaseEndEvent,
	createPhaseStartEvent,
	createSystemPromptResolvedEvent,
	createToolCallEndEvent,
	createToolCallStartEvent,
	createUserMessageEvent,
	SYSTEM_USER_ID,
	TraceSource,
	type TraceEvent as ProtocolTraceEvent
} from "@agent-kernel/protocol";
import { createKernel, type KernelInstance } from "@agent-kernel/kernel";
import {
	buildContext,
	createDefaultCatalog,
	type AgentContextResolver,
	type ContextLifecycleEmitter,
	type Loader,
	type LoaderDeclaration,
	type LoaderResult,
	type SpawnContext
} from "@agent-kernel/kernel/context";
import type {
	AgentRun,
	KernelContainerSummary,
	KernelTraceSessionDetail,
	KernelTraceSessionListResponse,
	PiSessionWithCount,
	TraceEventRow
} from "@agent-kernel/viewer-core";

const APP_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ROOT_CONTAINER_ID = "basic-demo";
const PHASE = "kernel_demo";
const MODEL = "demo-model";

type DemoRunResult = {
	responseText: string;
	session: { sessionId: string; messages: unknown[]; steer(message: string): Promise<void> };
	aborted: boolean;
};

type DemoRunOptions = {
	prompt?: string;
};

type MemoryLoaderDeclaration = LoaderDeclaration & {
	kind: "memory";
	key: string;
};

function isMemoryDecl(decl: LoaderDeclaration): decl is MemoryLoaderDeclaration {
	return decl.kind === "memory" && typeof (decl as { key?: unknown }).key === "string";
}

const memoryLoader: Loader<MemoryLoaderDeclaration> = {
	kind: "memory",
	async resolve(decl): Promise<LoaderResult> {
		const value = demoKnowledge[decl.key] ?? "";
		return {
			status: value.length > 0 ? "ok" : "empty",
			content: value,
			bytes: Buffer.byteLength(value, "utf8"),
			hash: await sha256(value)
		};
	}
};

const demoKnowledge: Record<string, string> = {
	kernel_principles:
		"Kernel owns runtime, protocol, storage, tailer, read API, and viewer primitives. Apps own workflow state and domain tools."
};

async function sha256(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

function nowRounded(): number {
	return Math.floor(Date.now() / 1000) * 1000;
}

export class DemoKernelStore {
	readonly kernel: KernelInstance<unknown, DemoRunOptions, DemoRunResult>;

	private readonly startedAt = nowRounded() - 90_000;
	private readonly container: KernelContainerSummary;
	private readonly piSessions: PiSessionWithCount[] = [];
	private readonly agentRuns: AgentRun[] = [];
	private readonly events: TraceEventRow[] = [];
	private eventCounter = 0;
	private runCounter = 0;

	constructor() {
		this.container = {
			id: ROOT_CONTAINER_ID,
			parentContainerId: null,
			label: "Basic Kernel Workbench",
			status: "running",
			workingDir: process.cwd(),
			worktreePath: null,
			phase: PHASE,
			phaseVocabulary: [PHASE],
			metadata: {
				description: "In-memory demo wiring protocol, context loaders, read API, and viewer."
			},
			startedAt: iso(this.startedAt),
			completedAt: null,
			createdAt: iso(this.startedAt),
			updatedAt: iso(this.startedAt)
		};

		this.kernel = createKernel({
			id: "basic-kernel-workbench",
			spawnAgent: async (name, prompt, _ctx, opts) =>
				this.runDemoAgent(name, opts?.prompt ?? prompt)
		});

		this.seedLifecycle();
		void this.runDemoAgent("kernel-docs-scout", "Show me how the kernel pieces connect.");
	}

	listTraceSessions(): KernelTraceSessionListResponse {
		return {
			trace_sessions: [
				{
					id: APP_SESSION_ID,
					containerId: ROOT_CONTAINER_ID,
					label: this.container.label,
					appSessionSlug: "basic-kernel-workbench",
					topic: "Kernel workbench demo",
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
				appSessionSlug: "basic-kernel-workbench",
				topic: "Kernel workbench demo",
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

	async runDemoAgent(agentName: string, prompt: string): Promise<DemoRunResult> {
		const runNumber = ++this.runCounter;
		const base = nowRounded() + runNumber * 1500;
		const piSessionId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		const contextSpanId = crypto.randomUUID();
		const toolSpanId = crypto.randomUUID();

		const piSession: PiSessionWithCount = {
			id: piSessionId,
			appSessionId: APP_SESSION_ID,
			parentId: null,
			agentName,
			model: MODEL,
			modelAlias: "demo",
			status: "running",
			phase: PHASE,
			containerId: ROOT_CONTAINER_ID,
			displayLabel: agentName,
			startedAt: iso(base),
			completedAt: null,
			createdAt: iso(base),
			updatedAt: iso(base),
			eventCount: 0
		};
		this.piSessions.push(piSession);

		const run: AgentRun = {
			id: runId,
			piSessionId,
			runNumber: 1,
			agentName,
			status: "running",
			parentRunId: null,
			containerId: ROOT_CONTAINER_ID,
			phase: PHASE,
			displayLabel: agentName,
			parentToolUseId: null,
			startedAt: iso(base + 100),
			completedAt: null,
			createdAt: iso(base + 100),
			updatedAt: iso(base + 100)
		};
		this.agentRuns.push(run);

		this.addEvent(
			createAgentSessionStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, agentName, MODEL),
			base + 50,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		this.addEvent(
			createAgentRunStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, agentName, runId, {
				containerId: ROOT_CONTAINER_ID,
				phase: PHASE,
				displayLabel: agentName,
				piSessionUuid: piSessionId
			}),
			base + 100,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		this.addEvent(
			createSystemPromptResolvedEvent(
				APP_SESSION_ID,
				SYSTEM_USER_ID,
				{
					agent_name: agentName,
					rendered_prompt: `You are ${agentName}. Demonstrate the portable kernel runtime and viewer.`,
					tools_allowlist: ["read_context"],
					tools_disallowlist: [],
					extensions: true,
					domain_rules_installed: false,
					variables_resolved: { phase: PHASE }
				},
				{ piSessionUuid: piSessionId }
			),
			base + 180,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);

		const contextResult = await this.buildDemoContext(agentName, prompt, piSessionId, contextSpanId, base + 260);

		this.addEvent(
			createUserMessageEvent(APP_SESSION_ID, SYSTEM_USER_ID, prompt, PHASE),
			base + 620,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		this.addEvent(
			createToolCallStartEvent(APP_SESSION_ID, SYSTEM_USER_ID, "read_context", toolSpanId, {
				toolInput: { loaderCount: contextResult.loaded.length, totalBytes: contextResult.totalBytes },
				spanId: toolSpanId
			}),
			base + 720,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		this.addEvent(
			createToolCallEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, "read_context", toolSpanId, {
				toolOutput: `Loaded ${contextResult.loaded.length} context inputs.`,
				durationMs: 210,
				spanId: toolSpanId
			}),
			base + 930,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);

		const responseText =
			"Kernel workbench connected: createKernel -> context loader catalog -> protocol events -> read API -> viewer shell.";
		this.addEvent(
			createAssistantMessageEvent(APP_SESSION_ID, SYSTEM_USER_ID, responseText, "text"),
			base + 1040,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		this.addEvent(
			createAgentRunEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, agentName, runId, "ok", {
				piSessionUuid: piSessionId
			}),
			base + 1120,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);
		this.addEvent(
			createAgentSessionEndEvent(APP_SESSION_ID, SYSTEM_USER_ID, "completed", {
				inputTokens: 640,
				outputTokens: 180,
				cost: 0
			}),
			base + 1180,
			{ piSessionId, containerId: ROOT_CONTAINER_ID }
		);

		piSession.status = "completed";
		piSession.completedAt = iso(base + 1180);
		piSession.updatedAt = iso(base + 1180);
		piSession.eventCount = this.events.filter((event) => event.piSessionId === piSessionId).length;
		run.status = "completed";
		run.completedAt = iso(base + 1120);
		run.updatedAt = iso(base + 1120);
		this.container.updatedAt = iso(base + 1180);

		return {
			responseText,
			session: {
				sessionId: piSessionId,
				messages: [],
				async steer() {}
			},
			aborted: false
		};
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

	private async buildDemoContext(
		agentName: string,
		prompt: string,
		piSessionId: string,
		spanId: string,
		baseTime: number
	) {
		let tick = 0;
		const nextTime = () => baseTime + tick++ * 80;
		const emitter: ContextLifecycleEmitter = {
			contextBuildStarted: (data) => {
				this.addEvent(
					createContextBuildStartedEvent(APP_SESSION_ID, SYSTEM_USER_ID, data, {
						spanId,
						piSessionUuid: piSessionId
					}),
					nextTime(),
					{ piSessionId, containerId: ROOT_CONTAINER_ID }
				);
			},
			contextInputResolved: (data) => {
				this.addEvent(
					createContextInputResolvedEvent(APP_SESSION_ID, SYSTEM_USER_ID, data, {
						piSessionUuid: piSessionId
					}),
					nextTime(),
					{ piSessionId, containerId: ROOT_CONTAINER_ID }
				);
			},
			contextBuildCompleted: (data) => {
				this.addEvent(
					createContextBuildCompletedEvent(APP_SESSION_ID, SYSTEM_USER_ID, data, {
						spanId,
						piSessionUuid: piSessionId
					}),
					nextTime(),
					{ piSessionId, containerId: ROOT_CONTAINER_ID }
				);
			}
		};

		const catalog = createDefaultCatalog();
		catalog.register(memoryLoader);

		const resolver: AgentContextResolver = {
			loaders: [
				{
					kind: "text",
					label: "operator prompt",
					content: prompt
				},
				{
					kind: "memory",
					key: "kernel_principles"
				}
			],
			assemble(loaded) {
				return loaded
					.map((item) => {
						const label = isMemoryDecl(item.decl)
							? `memory:${item.decl.key}`
							: item.decl.kind;
						return `<context_input kind="${label}" status="${item.status}">\n${item.content}\n</context_input>`;
					})
					.join("\n\n");
			}
		};

		const spawnContext: SpawnContext = {
			agentName,
			variables: { phase: PHASE },
			caller: { kind: "user", id: SYSTEM_USER_ID },
			runtime: {
				cwd: process.cwd(),
				appSessionId: APP_SESSION_ID,
				platform: "basic-kernel-workbench",
				topic: "Kernel workbench demo",
				phase: PHASE,
				status: "running"
			},
			paths: {
				workingDir: process.cwd(),
				activeSessionDir: process.cwd()
			},
			sessionData: {
				_syntheticState: {
					containerId: ROOT_CONTAINER_ID,
					mode: "in-memory"
				}
			}
		};

		return buildContext({
			resolver,
			spawnContext,
			catalog,
			emitter
		});
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
	}
}
