/**
 * Container-backed default read service (Phase 4b) — the standard
 * KernelTraceReadService implementation over the kernel's local trace db:
 *
 *   - getContainerTrace   → getKernelTraceReadRows (one container subtree)
 *   - listSessionContainers → containers of kind "session" with stats
 *
 * Payload shapes are plain data mirroring the viewer contract (structurally
 * compatible with @agent-kernel/viewer-core's KernelTraceSessionDetail /
 * KernelTraceSessionListResponse) without a viewer dependency.
 */
import {
	getKernelTraceReadRows,
	listSessionContainersWithStats,
	type Container,
	type KernelDatabase,
	type KernelTraceReadRows,
} from "@agent-kernel/db";

import type { KernelTraceReadQuery, KernelTraceReadService } from "./read-api";

export interface KernelContainerSummaryPayload {
	id: string;
	kind: string;
	parentContainerId: string | null;
	label: string | null;
	status: string;
	workingDir: string | null;
	phase: string | null;
	phaseVocabulary: string[] | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
	startedAt: string | null;
	endedAt: string | null;
}

export interface KernelPiSessionPayload {
	id: string;
	containerId: string;
	parentSessionId: string | null;
	parentToolUseId: string | null;
	agentName: string;
	displayLabel: string | null;
	model: string | null;
	promptHash: string | null;
	status: string;
	phase: string | null;
	createdAt: string;
	endedAt: string | null;
	eventCount: number;
}

export interface KernelAgentRunPayload {
	id: string;
	piSessionId: string;
	containerId: string;
	parentRunId: string | null;
	parentToolUseId: string | null;
	agentName: string;
	trigger: string;
	inboundEventId: string | null;
	outboundEventId: string | null;
	displayLabel: string | null;
	phase: string | null;
	status: string;
	startedAt: string;
	endedAt: string | null;
}

export interface KernelTraceEventPayload {
	eventId: string;
	containerId: string;
	runId: string | null;
	piSessionId: string | null;
	agentId: string | null;
	userId: string | null;
	type: string;
	source: string;
	traceLevel: number;
	eventData: unknown;
	spanId: string | null;
	parentEventId: string | null;
	timestamp: string;
}

export interface KernelSessionMetaPayload {
	id: string;
	containerId: string;
	kind: string;
	label: string | null;
	topic: string | null;
	status: string;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface KernelContainerTraceDetail {
	session: KernelSessionMetaPayload;
	container: KernelContainerSummaryPayload;
	containers: KernelContainerSummaryPayload[];
	pi_sessions: KernelPiSessionPayload[];
	agent_runs: KernelAgentRunPayload[];
	events: KernelTraceEventPayload[];
}

export interface KernelSessionContainerSummary {
	id: string;
	containerId: string;
	kind: string;
	label: string;
	topic: string | null;
	status: string;
	phase: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	piSessionCount: number;
	eventCount: number;
	latestEventAt: string | null;
	metadata: Record<string, unknown>;
}

export interface KernelSessionContainerList {
	trace_sessions: KernelSessionContainerSummary[];
}

export type KernelReadApiService = KernelTraceReadService<
	KernelContainerTraceDetail,
	KernelSessionContainerList
> & {
	getContainerTrace: (
		containerId: string,
		query?: KernelTraceReadQuery,
	) => Promise<KernelContainerTraceDetail | null>;
	listSessionContainers: (
		query?: KernelTraceReadQuery,
	) => Promise<KernelSessionContainerList>;
};

export interface CreateContainerReadServiceOptions {
	db: KernelDatabase;
	/** Scope the trace-sessions list to one kernel's containers. */
	kernelId?: string;
	/** Awaited before every read — typically the trace writer's flush(). */
	beforeRead?: () => Promise<void>;
}

function metadataString(
	metadata: Record<string, unknown> | null | undefined,
	key: string,
): string | null {
	const value = metadata?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function toContainer(row: Container): KernelContainerSummaryPayload {
	return {
		id: row.id,
		kind: row.kind,
		parentContainerId: row.parentContainerId ?? null,
		label: row.label ?? null,
		status: row.status,
		workingDir: row.workingDir ?? null,
		phase: row.phase ?? null,
		phaseVocabulary: row.phaseVocabulary ?? null,
		metadata: (row.metadata as Record<string, unknown> | null) ?? null,
		createdAt: row.createdAt,
		startedAt: row.startedAt ?? null,
		endedAt: row.endedAt ?? null,
	};
}

function toPiSession(
	row: KernelTraceReadRows["piSessions"][number],
): KernelPiSessionPayload {
	return {
		id: row.id,
		containerId: row.containerId,
		parentSessionId: row.parentSessionId ?? null,
		parentToolUseId: row.parentToolUseId ?? null,
		agentName: row.agentName,
		displayLabel: row.displayLabel ?? null,
		model: row.model ?? null,
		promptHash: row.promptHash ?? null,
		status: row.status,
		phase: row.phase ?? null,
		createdAt: row.createdAt,
		endedAt: row.endedAt ?? null,
		eventCount: row.eventCount,
	};
}

function toAgentRun(
	row: KernelTraceReadRows["agentRuns"][number],
): KernelAgentRunPayload {
	return {
		id: row.id,
		piSessionId: row.piSessionId,
		containerId: row.containerId,
		parentRunId: row.parentRunId ?? null,
		parentToolUseId: row.parentToolUseId ?? null,
		agentName: row.agentName,
		trigger: row.trigger,
		inboundEventId: row.inboundEventId ?? null,
		outboundEventId: row.outboundEventId ?? null,
		displayLabel: row.displayLabel ?? null,
		phase: row.phase ?? null,
		status: row.status,
		startedAt: row.startedAt,
		endedAt: row.endedAt ?? null,
	};
}

function toTraceEvent(
	row: KernelTraceReadRows["events"][number],
): KernelTraceEventPayload {
	return {
		eventId: row.eventId,
		containerId: row.containerId,
		runId: row.runId ?? null,
		piSessionId: row.piSessionId ?? null,
		agentId: row.agentId ?? null,
		userId: row.userId ?? null,
		type: row.type,
		source: row.source,
		traceLevel: row.traceLevel,
		eventData: row.eventData,
		spanId: row.spanId ?? null,
		parentEventId: row.parentEventId ?? null,
		timestamp: row.timestamp,
	};
}

function toDetail(rows: KernelTraceReadRows): KernelContainerTraceDetail {
	const container = toContainer(rows.rootContainer);
	const events = rows.events.map(toTraceEvent);
	const latestEventAt =
		events.at(-1)?.timestamp ?? container.endedAt ?? container.createdAt;

	return {
		session: {
			id: container.id,
			containerId: container.id,
			kind: container.kind,
			label: container.label,
			topic: metadataString(container.metadata, "topic") ?? container.label,
			status: container.status,
			createdAt: container.createdAt,
			updatedAt: latestEventAt,
		},
		container,
		containers: rows.containers.map(toContainer),
		pi_sessions: rows.piSessions.map(toPiSession),
		agent_runs: rows.agentRuns.map(toAgentRun),
		events,
	};
}

export function createContainerReadService(
	opts: CreateContainerReadServiceOptions,
): KernelReadApiService {
	const { db, kernelId, beforeRead } = opts;

	return {
		async getContainerTrace(
			containerId: string,
			query: KernelTraceReadQuery = {},
		): Promise<KernelContainerTraceDetail | null> {
			await beforeRead?.();
			const rows = await getKernelTraceReadRows(db, containerId, {
				after: query.after,
				limit: query.limit,
			});
			return rows ? toDetail(rows) : null;
		},

		async listSessionContainers(
			query: KernelTraceReadQuery = {},
		): Promise<KernelSessionContainerList> {
			await beforeRead?.();
			const rows = await listSessionContainersWithStats(db, {
				kernelId,
				limit: query.limit ?? 100,
			});

			const traceSessions = rows.map(
				({ container, piSessionCount, eventCount, latestEventAt }) => ({
					id: container.id,
					containerId: container.id,
					kind: container.kind,
					label: container.label ?? container.id,
					topic:
						metadataString(
							container.metadata as Record<string, unknown> | null,
							"topic",
						) ?? container.label ?? null,
					status: container.status,
					phase: container.phase ?? null,
					createdAt: container.createdAt,
					updatedAt:
						latestEventAt ??
						container.endedAt ??
						container.startedAt ??
						container.createdAt,
					piSessionCount,
					eventCount,
					latestEventAt,
					metadata: (container.metadata as Record<string, unknown> | null) ?? {},
				}),
			);
			traceSessions.sort((a, b) =>
				(b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
			);

			return { trace_sessions: traceSessions };
		},
	};
}
