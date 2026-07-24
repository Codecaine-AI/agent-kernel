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
	getTraceBlob,
	listSessionContainersWithStats,
	listTraceEventsForRun,
	type Container,
	type KernelDatabase,
	type KernelTraceReadRows,
} from "@agent-kernel/db";
import { EventType, type PiRequestSnapshotData } from "@agent-kernel/protocol";

import type {
	KernelTraceBlobPayload,
	KernelTraceReadQuery,
	KernelTraceReadService,
} from "./read-api";

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
	usageInputTokens: number;
	usageOutputTokens: number;
	usageCacheRead: number;
	usageCacheWrite: number;
	usageCostEstimate: number | null;
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
	usageInputTokens: number;
	usageOutputTokens: number;
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
	usageInputTokens: number;
	usageOutputTokens: number;
	usageCacheRead: number;
	usageCacheWrite: number;
	usageCostEstimate: number | null;
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

/**
 * Resolved per-turn request snapshot: the exact context sent to the model for
 * one turn of one run, with blob references resolved into their payloads.
 * `messages` holds the sanitized pi message JSON, parsed, in context order —
 * image content blocks stay by-reference as
 * `{type: "image", blob_hash, mimeType, byte_length}` (fetch bytes via the
 * blob route). A missing message blob is tolerated: its slot becomes
 * `{missing_blob: <hash>}` and a note lands in `warnings`.
 */
export interface KernelRunTurnContext {
	run_id: string;
	turn_number: number;
	prompt_hash: string | null;
	/** Resolved from the system-prompt blob (utf-8); null when absent. */
	system_prompt: string | null;
	message_count: number;
	messages: unknown[];
	refs: PiRequestSnapshotData["message_refs"];
	totals: { text_chars: number; image_count: number };
	/** Present only when blob resolution was partial. */
	warnings?: string[];
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
	getBlob: (hash: string) => Promise<KernelTraceBlobPayload | null>;
	getRunTurnContext: (
		runId: string,
		turnNumber: number,
	) => Promise<KernelRunTurnContext | null>;
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
		usageInputTokens: row.usageInputTokens,
		usageOutputTokens: row.usageOutputTokens,
		usageCacheRead: row.usageCacheRead,
		usageCacheWrite: row.usageCacheWrite,
		usageCostEstimate: row.usageCostEstimate ?? null,
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
		usageInputTokens: row.usageInputTokens,
		usageOutputTokens: row.usageOutputTokens,
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
		usageInputTokens: row.usageInputTokens,
		usageOutputTokens: row.usageOutputTokens,
		usageCacheRead: row.usageCacheRead,
		usageCacheWrite: row.usageCacheWrite,
		usageCostEstimate: row.usageCostEstimate ?? null,
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

		async getBlob(hash: string): Promise<KernelTraceBlobPayload | null> {
			await beforeRead?.();
			const row = await getTraceBlob(db, hash);
			if (!row) return null;
			return { data: row.data, mimeType: row.mimeType, byteLength: row.byteLength };
		},

		async getRunTurnContext(
			runId: string,
			turnNumber: number,
		): Promise<KernelRunTurnContext | null> {
			await beforeRead?.();

			const snapshotEvents = await listTraceEventsForRun(db, runId, {
				typeFilter: [EventType.PI_REQUEST_SNAPSHOT],
				limit: 1000,
			});
			// Events come back in timestamp order; take the latest snapshot for
			// the turn in case one was ever re-emitted.
			const snapshot = snapshotEvents
				.map((event) => event.eventData as Partial<PiRequestSnapshotData> | null)
				.filter(
					(data): data is PiRequestSnapshotData =>
						data != null &&
						data.turn_number === turnNumber &&
						Array.isArray(data.message_refs),
				)
				.at(-1);
			if (!snapshot) return null;

			const warnings: string[] = [];
			const decode = (bytes: Uint8Array): string =>
				new TextDecoder().decode(bytes);

			let systemPrompt: string | null = null;
			if (snapshot.system_prompt_blob_hash) {
				const blob = await getTraceBlob(db, snapshot.system_prompt_blob_hash);
				if (blob) {
					systemPrompt = decode(blob.data);
				} else {
					warnings.push(
						`missing system prompt blob ${snapshot.system_prompt_blob_hash}`,
					);
				}
			}

			const refs = [...snapshot.message_refs].sort((a, b) => a.index - b.index);
			const messages: unknown[] = [];
			for (const ref of refs) {
				const blob = await getTraceBlob(db, ref.blob_hash);
				if (!blob) {
					messages.push({ missing_blob: ref.blob_hash });
					warnings.push(`missing message blob ${ref.blob_hash} (index ${ref.index})`);
					continue;
				}
				try {
					messages.push(JSON.parse(decode(blob.data)));
				} catch {
					messages.push({ missing_blob: ref.blob_hash });
					warnings.push(
						`message blob ${ref.blob_hash} (index ${ref.index}) is not valid JSON`,
					);
				}
			}

			return {
				run_id: runId,
				turn_number: turnNumber,
				prompt_hash: snapshot.prompt_hash ?? null,
				system_prompt: systemPrompt,
				message_count: snapshot.message_count,
				messages,
				refs,
				totals: {
					text_chars: snapshot.total_text_chars,
					image_count: snapshot.total_image_count,
				},
				...(warnings.length > 0 ? { warnings } : {}),
			};
		},
	};
}
